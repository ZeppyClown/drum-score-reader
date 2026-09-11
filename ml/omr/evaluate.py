"""Evaluate a completed non-smoke run on its unchanged held-out song subset."""

import argparse
import datetime
import json
import platform
import subprocess
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from omr_model import DrumBarDataset, DrumOMRModel
from training_contract import (BEAT_GRID, DRUMS, DURATIONS, THRESHOLD,
                               load_training_split, sha256_file)

ML_DIR = Path(__file__).resolve().parents[1]


def ordered_events(drum_grid, duration_grid):
    return [(tuple(i for i, hit in enumerate(row) if hit), int(duration_grid[position]))
            for position, row in enumerate(drum_grid.tolist()) if any(row)]


def metrics(predicted_drums, predicted_durations, target_drums, target_durations):
    """Match the notebook metrics, with explicit support and empty-set handling."""
    predicted = predicted_drums.bool().reshape(-1, len(BEAT_GRID), len(DRUMS))
    target = target_drums.bool().reshape_as(predicted)
    if not len(target):
        raise ValueError('Cannot evaluate an empty test split')
    sequence_matches = sum(ordered_events(p, pd) == ordered_events(t, td)
                           for p, pd, t, td in zip(predicted, predicted_durations,
                                                 target, target_durations))
    hits = target.any(2)
    duration_correct = (predicted_durations == target_durations) & hits
    predicted_presence, target_presence = predicted.any(1), target.any(1)
    per_drum, per_duration = {}, {}
    for i, drum in enumerate(DRUMS):
        positive, actual = predicted_presence[:, i], target_presence[:, i]
        tp = int((positive & actual).sum())
        fp = int((positive & ~actual).sum())
        fn = int((~positive & actual).sum())
        denominator = 2 * tp + fp + fn
        per_drum[drum] = {'f1': 2 * tp / denominator if denominator else 0.0,
                          'true_positive_bars': tp, 'false_positive_bars': fp,
                          'false_negative_bars': fn, 'support_bars': int(actual.sum())}
    for i, duration in enumerate(DURATIONS):
        support = hits & (target_durations == i)
        count = int(support.sum())
        correct = int((support & duration_correct).sum())
        per_duration[duration] = {'support': count, 'correct': correct,
                                 'accuracy': correct / count if count else None}
    return {
        'sequence_accuracy': sequence_matches / len(target),
        'exact_bar_accuracy': float((predicted == target).flatten(1).all(1).float().mean()),
        'cell_accuracy': float((predicted == target).float().mean()),
        'duration_accuracy_at_hits': (float(duration_correct.sum() / hits.sum())
                                      if hits.any() else None),
        'per_drum_f1': {drum: result['f1'] for drum, result in per_drum.items()},
        'per_drum_counts': per_drum, 'per_duration': per_duration,
        'nonempty_prediction_bars': int(predicted.flatten(1).any(1).sum()),
        'test_bars': len(target),
    }


def verified_run(run_dir, dataset):
    config = json.loads((run_dir / 'run_config.json').read_text())
    if config['smoke_batches'] or config['random_init']:
        raise ValueError('Smoke/random-initialization runs cannot be evaluated as a release')
    completed = json.loads((run_dir / 'training_complete.json').read_text())
    if completed.get('smoke') is not False:
        raise ValueError('Missing non-smoke completion evidence')
    checkpoint = run_dir / 'finetune_best.pt'
    if sha256_file(checkpoint) != completed['checkpoint_sha256']:
        raise ValueError('Completed checkpoint hash mismatch')
    groups, report = load_training_split(dataset)
    for key in ('training_manifest_sha256', 'training_contract_sha256', 'model_source_sha256'):
        if config[key] != report[key]:
            raise ValueError(f'Training/evaluation provenance mismatch: {key}')
    if completed['training_manifest_sha256'] != report['training_manifest_sha256']:
        raise ValueError('Completion marker refers to a different dataset')
    if sha256_file(Path(__file__).with_name('omr_model.py')) != config['model_source_sha256']:
        raise ValueError('Local model implementation differs from the trained model')
    model = DrumOMRModel(pretrained=False)
    model.load_state_dict(torch.load(checkpoint, map_location='cpu', weights_only=True))
    return model.eval(), groups, report, checkpoint


def evaluate(run_dir, dataset, output, batch_size=32):
    torch.set_num_threads(4)
    print('Verifying completed run and held-out split...', flush=True)
    model, groups, report, checkpoint = verified_run(run_dir, dataset)
    items = groups['test']
    loader = DataLoader(DrumBarDataset([row[0] for row in items], [row[1] for row in items]),
                        batch_size=batch_size, shuffle=False)
    predictions, durations, targets, target_durations = [], [], [], []
    with torch.inference_mode():
        for index, (images, drums, rhythm) in enumerate(loader):
            drum_logits, duration_logits = model(images)
            predictions.append(drum_logits.sigmoid() > THRESHOLD)
            durations.append(duration_logits.reshape(-1, len(BEAT_GRID), len(DURATIONS)).argmax(2))
            targets.append(drums)
            target_durations.append(rhythm)
            if index % 20 == 0:
                print(f'Evaluated {min((index + 1) * batch_size, len(items))}/{len(items)} bars', flush=True)
    predicted, duration = torch.cat(predictions), torch.cat(durations)
    target, target_duration = torch.cat(targets), torch.cat(target_durations)
    measured = metrics(predicted, duration, target, target_duration)
    try:
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        commit = None
    result = {
        'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'git_commit': commit, 'evaluation_source_sha256': sha256_file(Path(__file__)),
        'checkpoint': checkpoint.name, 'checkpoint_sha256': sha256_file(checkpoint),
        'device': 'cpu', 'torch_version': str(torch.__version__), 'platform': platform.platform(),
        'threshold': THRESHOLD,
        'dataset': {'scope': 'strict supported subset',
                    'training_manifest_sha256': report['training_manifest_sha256'],
                    'source_manifest_sha256': report['source_manifest_sha256'],
                    'test_songs': len({row[2] for row in items}),
                    'test_bars': len(items),
                    'test_source_bars': report['splits']['test']['source_bars'],
                    'test_excluded_bars': report['splits']['test']['excluded_bars']},
        'metric_definitions': {
            'sequence_accuracy': 'Ordered (drums, duration) hit events; silent slots omitted, as in the notebook.',
            'exact_bar_accuracy': 'Every drum grid cell matches; durations scored separately.',
            'per_drum_f1': 'Per-bar presence of each drum, matching the notebook definition.',
            'duration_accuracy_at_hits': 'Duration correctness at ground-truth hit positions only.',
        },
        'metrics': measured,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
    print(json.dumps({key: measured[key] for key in (
        'sequence_accuracy', 'exact_bar_accuracy', 'duration_accuracy_at_hits',
        'nonempty_prediction_bars', 'test_bars')}, indent=2), flush=True)
    print(f'Saved {output}', flush=True)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-dir', type=Path, required=True)
    parser.add_argument('--dataset', type=Path, default=ML_DIR / 'data' / 'training' / 'dataset')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    evaluate(args.run_dir, args.dataset, args.output or args.run_dir / 'eval_results.json')


if __name__ == '__main__':
    main()
