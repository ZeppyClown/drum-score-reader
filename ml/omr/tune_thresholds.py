"""Offline experiment only: independently maximize validation per-bar drum F1.

Grid: 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9 (strict sigmoid > threshold).
This also maximizes macro per-drum F1, since each drum is independent. Exact
F1 ties prefer 0.5, then the closest threshold to 0.5, then the lower value.
Freeze thresholds before one test inference pass; reuse its probabilities for
baseline and tuned metrics. Sequence/exact-bar accuracy are reporting metrics,
not selection objectives. No training, export, runtime configuration or network.

env -u PYTHONPATH PYTHONDONTWRITEBYTECODE=1 python3 ml/omr/tune_thresholds.py \
    --output /tmp/drumhub-thresholds.json
"""

import argparse
import datetime
import json
import platform
import subprocess
from fractions import Fraction
from pathlib import Path

import torch
import torchvision
from torch.utils.data import DataLoader

from evaluate import metrics
from omr_model import DrumBarDataset, DrumOMRModel
from training_contract import (BEAT_GRID, DRUMS, DURATIONS, THRESHOLD,
                               load_training_split, sha256_file)

WORKTREE = Path(__file__).resolve().parents[2]
GRID = (0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9)


def verified_release(checkpoint, dataset):
    """Check released evidence and authoritative, content-hashed song splits."""
    folder = checkpoint.parent
    manifest_path = folder / 'release_manifest.json'
    manifest = json.loads(manifest_path.read_text())
    evidence = {}
    for path in (checkpoint, folder / 'run_config.json',
                 folder / 'training_complete.json', folder / 'omr_config.json'):
        entry = manifest['files'][path.name]
        if sha256_file(path) != entry['sha256'] or path.stat().st_size != entry['bytes']:
            raise ValueError(f'Release manifest mismatch: {path.name}')
        if path != checkpoint:
            evidence[path.name] = json.loads(path.read_text())
    config, completed = evidence['run_config.json'], evidence['training_complete.json']
    runtime = evidence['omr_config.json']
    if config['smoke_batches'] or config['random_init'] or completed.get('smoke') is not False:
        raise ValueError('A completed non-smoke release is required')
    if completed['checkpoint_sha256'] != sha256_file(checkpoint):
        raise ValueError('Completion checkpoint hash mismatch')
    if runtime['DRUMS'] != DRUMS or runtime['THRESHOLD'] != THRESHOLD:
        raise ValueError('Release runtime threshold/drum contract differs')
    groups, report = load_training_split(dataset)
    for key in ('training_manifest_sha256', 'training_contract_sha256', 'model_source_sha256'):
        if config[key] != report[key]:
            raise ValueError(f'Training split provenance mismatch: {key}')
    if completed['training_manifest_sha256'] != report['training_manifest_sha256']:
        raise ValueError('Completion dataset mismatch')
    if sha256_file(Path(__file__).with_name('omr_model.py')) != config['model_source_sha256']:
        raise ValueError('Local model differs from released model')
    model = DrumOMRModel(pretrained=False)  # Never downloads pretrained weights.
    model.load_state_dict(torch.load(checkpoint, map_location='cpu', weights_only=True))
    return model.eval(), groups, report, {
        'release': manifest['release'], 'release_git_commit': manifest['git_commit'],
        'release_manifest_sha256': sha256_file(manifest_path),
        'checkpoint_sha256': sha256_file(checkpoint),
        'runtime_config_sha256': sha256_file(folder / 'omr_config.json'),
        **{key: config[key] for key in (
            'training_manifest_sha256', 'training_contract_sha256', 'model_source_sha256')},
    }


def predict(model, items, batch_size, split):
    loader = DataLoader(DrumBarDataset([row[0] for row in items], [row[1] for row in items]),
                        batch_size=batch_size, shuffle=False, num_workers=0)
    probabilities, durations, targets, rhythms = [], [], [], []
    with torch.inference_mode():
        for index, (images, drums, rhythm) in enumerate(loader):
            drum_logits, duration_logits = model(images)
            probabilities.append(drum_logits.sigmoid().reshape(-1, len(BEAT_GRID), len(DRUMS)))
            durations.append(duration_logits.reshape(-1, len(BEAT_GRID), len(DURATIONS)).argmax(2))
            targets.append(drums)
            rhythms.append(rhythm)
            if index % 20 == 0:
                print(f'{split}: {min((index + 1) * batch_size, len(items))}/{len(items)} bars',
                      flush=True)
    return tuple(torch.cat(values) for values in (probabilities, durations, targets, rhythms))


def apply_thresholds(probabilities, thresholds):
    """Broadcast the named mapping in the trained model's drum order."""
    return probabilities.reshape(-1, len(BEAT_GRID), len(DRUMS)) > probabilities.new_tensor(
        [thresholds[drum] for drum in DRUMS])


def measure(data, thresholds):
    probabilities, durations, targets, rhythms = data
    result = metrics(apply_thresholds(probabilities, thresholds), durations, targets, rhythms)
    result['bars'] = result.pop('test_bars')
    for counts in result['per_drum_counts'].values():
        tp, fp, support = (counts[key] for key in (
            'true_positive_bars', 'false_positive_bars', 'support_bars'))
        counts['recall'] = tp / support if support else None
        counts['precision'] = tp / (tp + fp) if tp + fp else None
    result['macro_per_drum_f1'] = sum(result['per_drum_f1'].values()) / len(DRUMS)
    return result


def tune_validation(validation):
    candidates = {value: measure(validation, dict.fromkeys(DRUMS, value)) for value in GRID}

    def rank(value, drum):
        counts = candidates[value]['per_drum_counts'][drum]
        tp = counts['true_positive_bars']
        denominator = 2 * tp + counts['false_positive_bars'] + counts['false_negative_bars']
        f1 = Fraction(2 * tp, denominator) if denominator else Fraction(0)
        return f1, -abs(Fraction(str(value)) - Fraction(1, 2)), -value

    thresholds = {drum: max(GRID, key=lambda value: rank(value, drum)) for drum in DRUMS}
    return thresholds, candidates


def comparison(baseline, tuned):
    tradeoffs = {}
    for drum in DRUMS:
        before, after = (result['per_drum_counts'][drum] for result in (baseline, tuned))
        tradeoffs[drum] = {key + '_delta': after[key] - before[key] for key in (
            'false_positive_bars', 'false_negative_bars', 'f1')}
        tradeoffs[drum]['recall_delta'] = (after['recall'] - before['recall']
                                           if before['recall'] is not None else None)
    return {'baseline': baseline, 'tuned': tuned, 'per_drum_tradeoffs': tradeoffs}


def experiment(dataset, checkpoint, output, batch_size=32):
    dataset, checkpoint, output = (Path(path).resolve() for path in (dataset, checkpoint, output))
    # Reports are new files only; never write into inputs, releases, or the original repo.
    allowed = output.is_relative_to(Path('/tmp').resolve()) or output.is_relative_to(WORKTREE)
    main_checkout = Path(subprocess.check_output(
        ['git', '-C', str(WORKTREE), 'rev-parse', '--path-format=absolute', '--git-common-dir'],
        text=True).strip()).resolve().parent
    protected = (dataset, checkpoint.parent, (WORKTREE / 'ml/releases').resolve(),
                 (WORKTREE / 'ml/data/releases').resolve())
    if main_checkout != WORKTREE:
        protected += (main_checkout,)
    if not allowed or any(output.is_relative_to(root) for root in protected):
        raise ValueError('Output must be in /tmp or this worktree, outside input/release folders')
    if output.exists():
        raise FileExistsError(f'Refusing to overwrite existing file: {output}')
    if batch_size < 1:
        raise ValueError('Batch size must be positive')
    torch.set_num_threads(4)
    torch.manual_seed(0)
    torch.use_deterministic_algorithms(True)
    print('Verifying release and training split provenance...', flush=True)
    model, groups, report, provenance = verified_release(checkpoint, dataset)
    baseline_thresholds = dict.fromkeys(DRUMS, THRESHOLD)
    validation = predict(model, groups['validation'], batch_size, 'validation')
    thresholds, candidates = tune_validation(validation)
    validation_result = comparison(candidates[THRESHOLD], measure(validation, thresholds))
    print(f'Frozen validation thresholds: {json.dumps(thresholds)}', flush=True)
    # The sole test pass happens after selection; no test inputs reach tune_validation.
    test = predict(model, groups['test'], batch_size, 'test')
    test_result = comparison(measure(test, baseline_thresholds), measure(test, thresholds))
    result = {
        'schema_version': 1, 'experiment_only': True, 'runtime_config_changed': False,
        'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'git_commit': subprocess.check_output(
            ['git', '-C', str(WORKTREE), 'rev-parse', 'HEAD'], text=True).strip(),
        'experiment_source_sha256': sha256_file(Path(__file__)),
        'evaluation_source_sha256': sha256_file(Path(__file__).with_name('evaluate.py')),
        'device': 'cpu', 'seed': 0, 'threads': 4, 'batch_size': batch_size,
        'torch_version': str(torch.__version__), 'torchvision_version': str(torchvision.__version__),
        'platform': platform.platform(),
        'provenance': {**provenance, 'checkpoint': str(checkpoint), 'dataset': str(dataset),
                       'training_report_sha256': sha256_file(dataset / 'training_report.json'),
                       'source_manifest_sha256': report['source_manifest_sha256']},
        'dataset': {'scope': 'strict supported subset', 'splits': {
            split: {**report['splits'][split], 'measured_bars': len(groups[split]),
                    'measured_songs': len({row[2] for row in groups[split]})}
            for split in ('validation', 'test')}, 'limitations': report['limitations']},
        'selection': {
            'split': 'validation', 'objective': 'macro per-drum per-bar presence F1',
            'method': 'independent per-drum maximization', 'candidate_grid': list(GRID),
            'tie_break': 'Exact F1 ties: prefer 0.5, then closest to 0.5, then lower.',
            'comparison': 'sigmoid > threshold', 'baseline_threshold': THRESHOLD,
            'thresholds': thresholds, 'candidate_per_drum_f1': {
                str(value): candidate['per_drum_f1'] for value, candidate in candidates.items()},
        },
        'metric_definitions': {
            'sequence_accuracy': 'Ordered (drums, duration) hit events; silent slots omitted.',
            'exact_bar_accuracy': 'Every drum grid cell matches; durations scored separately.',
            'per_drum_counts': 'Per-bar presence, not onset counts; recall is TP/support.',
            'unsupported_recall': 'Null when a drum has zero ground-truth support.',
            'tradeoff_deltas': 'Tuned minus baseline; negative FP is fewer false-positive bars.',
        },
        'test_inference_passes': 1, 'validation': validation_result, 'test': test_result,
        'limitations': ['The test split was already used for the released baseline evaluation.',
                        'Threshold selection optimizes presence F1, not sequence/exact-bar accuracy.',
                        'This offline measurement does not change or qualify a shipped release.'],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x') as stream:
        stream.write(json.dumps(result, indent=2, allow_nan=False) + '\n')
    print(json.dumps({split: {variant: {key: result[split][variant][key] for key in (
        'sequence_accuracy', 'exact_bar_accuracy', 'macro_per_drum_f1')}
        for variant in ('baseline', 'tuned')} for split in ('validation', 'test')}, indent=2))
    print(f'Saved experiment only: {output}', flush=True)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset', type=Path,
                        default=WORKTREE / 'ml/data/training/dataset')
    parser.add_argument('--checkpoint', type=Path,
                        default=WORKTREE / 'ml/data/releases/baseline-14drum-v1/omr_finetuned.pt')
    parser.add_argument('--output', type=Path, default=Path('/tmp/drumhub-thresholds.json'))
    parser.add_argument('--batch-size', type=int, default=32)
    args = parser.parse_args()
    experiment(args.dataset, args.checkpoint, args.output, args.batch_size)


if __name__ == '__main__':
    main()
