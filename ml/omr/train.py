"""Run the notebook's two-phase model locally with resumable epoch checkpoints.

python3 ml/omr/train.py --device mps --run-dir ml/data/training/runs/baseline
Use --smoke-batches 2 --epochs 1 --finetune-epochs 1 --random-init for a rehearsal.
Smoke artifacts are explicitly marked and must never be used as a model release.
"""

import argparse
import importlib.metadata
import json
import random
import subprocess
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.optim import AdamW
from torch.optim.lr_scheduler import CosineAnnealingLR
from torch.utils.data import DataLoader

from omr_model import DrumBarDataset, DrumOMRModel
from training_contract import (BEAT_GRID, DRUMS, DURATIONS, THRESHOLD, encode_target,
                               load_training_split, sha256_file)

ML_DIR = Path(__file__).resolve().parents[1]


def positive_weights(targets):
    positive = targets.sum(0).clamp(min=1)
    negative = (len(targets) - targets.sum(0)).clamp(min=1)
    return (negative / positive).clamp(max=50)


def run_epoch(model, loader, device, weights, optimizer=None, frozen=False):
    training = optimizer is not None
    model.train(training)
    if frozen:
        # Frozen ImageNet features include BatchNorm buffers, not just parameters.
        model.features.eval()
    drum_loss_fn = nn.BCEWithLogitsLoss(pos_weight=weights)
    duration_loss_fn = nn.CrossEntropyLoss()
    loss_sum, correct, count = 0.0, 0, 0
    last_log = time.monotonic()
    with torch.set_grad_enabled(training):
        for images, drums, durations in loader:
            images, drums, durations = images.to(device), drums.to(device), durations.to(device)
            drum_logits, duration_logits = model(images)
            hits = drums.view(-1, len(BEAT_GRID), len(DRUMS)).sum(2) > 0
            duration_loss = duration_logits.sum() * 0
            if hits.any():
                duration_loss = duration_loss_fn(
                    duration_logits.view(-1, len(BEAT_GRID), len(DURATIONS))[hits], durations[hits])
            loss = drum_loss_fn(drum_logits, drums) + 0.5 * duration_loss
            if not torch.isfinite(loss):
                raise RuntimeError('Non-finite training loss; refusing to save this epoch')
            if training:
                optimizer.zero_grad(set_to_none=True)
                loss.backward()
                optimizer.step()
            size = len(images)
            loss_sum += float(loss.detach()) * size
            correct += int(((drum_logits.sigmoid() > THRESHOLD) == drums).all(1).sum())
            count += size
            if time.monotonic() - last_log >= 30:
                print(f'  {"train" if training else "validation"}: {count}/{len(loader.dataset)} bars', flush=True)
                last_log = time.monotonic()
    return {'loss': loss_sum / count, 'exact_drum_bar_accuracy': correct / count, 'bars': count}


def rng_state(device):
    numpy_state = np.random.get_state()
    state = {'python': random.getstate(), 'torch': torch.get_rng_state(),
             'numpy': [numpy_state[0], numpy_state[1].tolist(), *numpy_state[2:]]}
    if device.type == 'mps':
        state['mps'] = torch.mps.get_rng_state()
    elif device.type == 'cuda':
        state['cuda'] = torch.cuda.get_rng_state_all()
    return state


def restore_rng(state, device):
    random.setstate(state['python'])
    torch.set_rng_state(state['torch'])
    value = state['numpy']
    np.random.set_state((value[0], np.array(value[1], dtype=np.uint32), *value[2:]))
    if device.type == 'mps':
        torch.mps.set_rng_state(state['mps'])
    elif device.type == 'cuda':
        torch.cuda.set_rng_state_all(state['cuda'])


def save_checkpoint(state, path):
    temporary = path.with_suffix('.tmp')
    torch.save(state, temporary)
    temporary.replace(path)


def train(args):
    torch.set_num_threads(args.threads)
    device_name = args.device
    if device_name == 'auto':
        device_name = ('cuda' if torch.cuda.is_available() else
                       'mps' if torch.backends.mps.is_available() else 'cpu')
    device = torch.device(device_name)
    if device.type == 'mps' and not torch.backends.mps.is_available():
        raise ValueError('Apple GPU is unavailable in this process; use GPU-capable execution')
    if args.random_init and not args.smoke_batches:
        raise ValueError('--random-init is only allowed for a smoke run')
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    if device.type == 'mps':
        torch.mps.manual_seed(args.seed)
    elif device.type == 'cuda':
        torch.cuda.manual_seed_all(args.seed)
        torch.backends.cudnn.benchmark = False
        torch.backends.cudnn.deterministic = True

    print('Verifying the training dataset...', flush=True)
    groups, report = load_training_split(args.dataset)
    local_model = Path(__file__).with_name('omr_model.py')
    if sha256_file(local_model) != report['model_source_sha256']:
        raise ValueError('Local model differs from the packaged model; rebuild the package')
    config = {
        'schema_version': 1, 'seed': args.seed, 'batch_size': args.batch_size,
        'epochs': args.epochs, 'finetune_epochs': args.finetune_epochs,
        'learning_rate': args.lr, 'duration_weight': 0.5,
        'smoke_batches': args.smoke_batches, 'random_init': args.random_init,
        'training_manifest_sha256': report['training_manifest_sha256'],
        'training_contract_sha256': report['training_contract_sha256'],
        'model_source_sha256': report['model_source_sha256'],
        'trainer_sha256': sha256_file(Path(__file__)),
        'torch_version': str(torch.__version__),
        'torchvision_version': importlib.metadata.version('torchvision'),
        'numpy_version': np.__version__, 'pillow_version': importlib.metadata.version('Pillow'),
        'device': str(device),
        'workers': args.workers, 'threads': args.threads,
    }
    args.run_dir.mkdir(parents=True, exist_ok=True)
    config_file = args.run_dir / 'run_config.json'
    checkpoint_file = args.run_dir / 'last.pt'
    if config_file.exists():
        if not args.resume:
            raise ValueError('Run already exists; use --resume or choose a new run directory')
        if json.loads(config_file.read_text()) != config:
            raise ValueError('Resume configuration/code/dataset differs from the saved run')
        saved = (torch.load(checkpoint_file, map_location='cpu', weights_only=True)
                 if checkpoint_file.exists() else None)
        if saved is not None and saved['config'] != config:
            raise ValueError('Checkpoint configuration does not match this run')
    else:
        if args.resume:
            raise ValueError('No run exists to resume')
        saved = None
        config_file.write_text(json.dumps(config, indent=2) + '\n')
    try:
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        commit = None
    if not saved:
        (args.run_dir / 'provenance.json').write_text(json.dumps(
            {'git_commit': commit, 'dataset_report': report}, indent=2) + '\n')

    loaders = {}
    for split in ('train', 'validation'):
        items = groups[split]
        if args.smoke_batches:
            items = items[:args.batch_size * args.smoke_batches]
        dataset = DrumBarDataset([item[0] for item in items], [item[1] for item in items],
                                 augment=split == 'train')
        loaders[split] = DataLoader(dataset, batch_size=args.batch_size,
                                    shuffle=split == 'train', num_workers=args.workers)
    labels = loaders['train'].dataset.labels
    targets = torch.tensor([encode_target(json.loads(Path(path).read_text()))[0] for path in labels])
    weights = positive_weights(targets).to(device)
    torch.hub.set_dir(str(args.dataset.parent / 'torch-cache'))
    model = DrumOMRModel(pretrained=not args.random_init and saved is None).to(device)
    history = saved['history'] if saved else []
    if saved:
        model.load_state_dict(saved['model'])
    print(f'Device: {device}; parameters: {sum(p.numel() for p in model.parameters()):,}; '
          f'train bars: {len(labels)}; smoke: {bool(args.smoke_batches)}', flush=True)

    completed_here = 0
    for phase, epochs in enumerate((args.epochs, args.finetune_epochs)):
        if saved and phase < saved['phase']:
            continue
        same_phase = saved is not None and phase == saved['phase']
        if phase == 1 and not same_phase:
            best_heads = torch.load(args.run_dir / 'heads_best.pt', map_location='cpu', weights_only=True)
            model.load_state_dict(best_heads)
        frozen = phase == 0
        for parameter in model.features.parameters():
            parameter.requires_grad = not frozen
        optimizer = AdamW(filter(lambda p: p.requires_grad, model.parameters()),
                          lr=args.lr if frozen else args.lr / 10, weight_decay=1e-4)
        scheduler = CosineAnnealingLR(optimizer, T_max=epochs)
        best_loss, first_epoch = float('inf'), 1
        if same_phase:
            optimizer.load_state_dict(saved['optimizer'])
            scheduler.load_state_dict(saved['scheduler'])
            best_loss, first_epoch = saved['best_loss'], saved['epoch'] + 1
            restore_rng(saved['rng'], device)
        phase_name = 'heads' if frozen else 'finetune'
        for epoch in range(first_epoch, epochs + 1):
            started = time.monotonic()
            training = run_epoch(model, loaders['train'], device, weights, optimizer, frozen)
            validation = run_epoch(model, loaders['validation'], device, weights)
            scheduler.step()
            if validation['loss'] < best_loss:
                best_loss = validation['loss']
                save_checkpoint(model.state_dict(), args.run_dir / f'{phase_name}_best.pt')
            record = {'phase': phase_name, 'epoch': epoch, 'train': training,
                      'validation': validation, 'seconds': time.monotonic() - started}
            history.append(record)
            save_checkpoint({'config': config, 'phase': phase, 'epoch': epoch,
                             'model': model.state_dict(), 'optimizer': optimizer.state_dict(),
                             'scheduler': scheduler.state_dict(), 'best_loss': best_loss,
                             'history': history, 'rng': rng_state(device)}, checkpoint_file)
            (args.run_dir / 'history.json').write_text(json.dumps(history, indent=2) + '\n')
            print(json.dumps(record), flush=True)
            completed_here += 1
            if args.stop_after_epochs and completed_here >= args.stop_after_epochs:
                print('Stopped at the requested epoch boundary; --resume continues this run.', flush=True)
                return
    marker = 'smoke_complete.json' if args.smoke_batches else 'training_complete.json'
    best_file = args.run_dir / 'finetune_best.pt'
    (args.run_dir / marker).write_text(json.dumps({
        'checkpoint': best_file.name, 'checkpoint_sha256': sha256_file(best_file),
        'training_manifest_sha256': report['training_manifest_sha256'],
        'smoke': bool(args.smoke_batches), 'evaluated_on_test': False,
    }, indent=2) + '\n')
    print(f'Completed: {args.run_dir / marker}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset', type=Path, default=ML_DIR / 'data' / 'training' / 'dataset')
    parser.add_argument('--run-dir', type=Path, required=True)
    parser.add_argument('--device', choices=('auto', 'cpu', 'mps', 'cuda'), default='auto')
    parser.add_argument('--epochs', type=int, default=15)
    parser.add_argument('--finetune-epochs', type=int, default=25)
    parser.add_argument('--batch-size', type=int, default=32)
    parser.add_argument('--lr', type=float, default=3e-4)
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--workers', type=int, default=0)
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--smoke-batches', type=int, default=0)
    parser.add_argument('--random-init', action='store_true')
    parser.add_argument('--resume', action='store_true')
    parser.add_argument('--stop-after-epochs', type=int, default=0)
    args = parser.parse_args()
    if min(args.epochs, args.finetune_epochs, args.batch_size, args.threads) < 1 or args.lr <= 0:
        parser.error('Epoch counts, batch size, threads, and learning rate must be positive')
    if min(args.workers, args.smoke_batches, args.stop_after_epochs) < 0:
        parser.error('Workers, smoke batches, and stop-after-epochs cannot be negative')
    train(args)


if __name__ == '__main__':
    main()
