"""Assemble one verified model release from a completed, evaluated, exported run.

RUN=ml/data/training/runs/baseline-14drum-v1
python3 ml/omr/benchmark.py --model "$RUN/omr.onnx" --out "$RUN/benchmark_results.json" \
    --images ml/data/training/dataset/images
python3 ml/omr/release.py --run-dir "$RUN" --name baseline-14drum-v1

Every artifact must describe the same checkpoint, ONNX file, and training dataset.
Weights and evidence go to the ignored ml/data/releases/<name>/; the JSON evidence and a
hash manifest also go to the versioned ml/releases/<name>/. Releases are never overwritten.
"""

import argparse
import datetime
import json
import re
import shutil
import subprocess
from pathlib import Path

from export import inference_config
from training_contract import sha256_file

ML_DIR = Path(__file__).resolve().parents[1]
EVIDENCE = ('omr_config.json', 'eval_results.json', 'export_results.json',
            'benchmark_results.json', 'run_config.json', 'history.json',
            'training_complete.json')
NAME = re.compile(r'^[a-z0-9][a-z0-9._-]{0,63}$')


def load_json(path):
    if not path.exists():
        raise ValueError(f'Missing release evidence: {path}')
    return json.loads(path.read_text())


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify_run(run_dir):
    """Cross-check every artifact; return release file names mapped to source paths."""
    run_config = load_json(run_dir / 'run_config.json')
    require(not run_config.get('smoke_batches') and not run_config.get('random_init'),
            'Smoke/random-initialization runs cannot be released')
    completed = load_json(run_dir / 'training_complete.json')
    require(completed.get('smoke') is False, 'Missing non-smoke completion evidence')
    checkpoint, onnx_path = run_dir / completed['checkpoint'], run_dir / 'omr.onnx'
    require(checkpoint.exists() and onnx_path.exists(), 'Checkpoint or omr.onnx is missing')
    checkpoint_sha, onnx_sha = sha256_file(checkpoint), sha256_file(onnx_path)
    require(checkpoint_sha == completed['checkpoint_sha256'],
            'Checkpoint changed after training completed')
    evaluation, exported, config, benchmark = (load_json(run_dir / name) for name in (
        'eval_results.json', 'export_results.json', 'omr_config.json', 'benchmark_results.json'))
    require(evaluation.get('checkpoint_sha256') == checkpoint_sha,
            'Evaluation used a different checkpoint')
    require(exported.get('checkpoint_sha256') == checkpoint_sha,
            'Export used a different checkpoint')
    require(exported.get('onnx_sha256') == onnx_sha == config.get('MODEL_SHA256'),
            'omr.onnx differs from the exported and configured model')
    require({k: v for k, v in config.items() if k != 'MODEL_SHA256'} == inference_config(),
            'omr_config.json does not match the current inference contract')
    require(benchmark.get('model_sha256') == onnx_sha, 'Benchmark measured a different ONNX file')
    datasets = {run_config.get('training_manifest_sha256'),
                completed.get('training_manifest_sha256'),
                evaluation.get('dataset', {}).get('training_manifest_sha256'),
                exported.get('training_manifest_sha256')}
    require(len(datasets) == 1 and None not in datasets,
            'Artifacts refer to different training datasets')
    return {'omr_finetuned.pt': checkpoint, 'omr.onnx': onnx_path,
            **{name: run_dir / name for name in EVIDENCE}}


def git_commit():
    try:
        return subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def copy_verified(source, target, digest):
    shutil.copy2(source, target)
    require(sha256_file(target) == digest, f'Copy verification failed: {target.name}')


def publish(files, name, bundle_root, record_root):
    require(NAME.match(name), 'Release names use lowercase letters, digits, ".", "_", or "-"')
    bundle, record = bundle_root / name, record_root / name
    require(not bundle.exists() and not record.exists(),
            f'Release {name} already exists; choose a new name')
    manifest = {'release': name, 'git_commit': git_commit(),
                'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'files': {file_name: {'sha256': sha256_file(path), 'bytes': path.stat().st_size}
                          for file_name, path in files.items()}}
    staging = [bundle.with_name(name + '.tmp'), record.with_name(name + '.tmp')]
    try:
        for folder in staging:
            shutil.rmtree(folder, ignore_errors=True)
            folder.mkdir(parents=True)
        for file_name, source in files.items():
            digest = manifest['files'][file_name]['sha256']
            copy_verified(source, staging[0] / file_name, digest)
            if file_name.endswith('.json'):
                copy_verified(source, staging[1] / file_name, digest)
        for folder in staging:
            (folder / 'release_manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        staging[0].replace(bundle)
        staging[1].replace(record)
    except BaseException:
        for folder in staging:
            shutil.rmtree(folder, ignore_errors=True)
        raise
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-dir', type=Path, required=True)
    parser.add_argument('--name', required=True)
    parser.add_argument('--bundle-root', type=Path, default=ML_DIR / 'data' / 'releases')
    parser.add_argument('--record-root', type=Path, default=ML_DIR / 'releases')
    args = parser.parse_args()
    manifest = publish(verify_run(args.run_dir), args.name, args.bundle_root, args.record_root)
    print(f'Released {args.name}: {len(manifest["files"])} files to '
          f'{args.bundle_root / args.name}; evidence in {args.record_root / args.name}')


if __name__ == '__main__':
    main()
