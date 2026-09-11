"""Export an evaluated, completed training run to ONNX plus its inference config.

python3 ml/omr/export.py --run-dir ml/data/training/runs/baseline-14drum-v1

Run ml/omr/evaluate.py first. Export refuses smoke runs, unevaluated checkpoints, and
existing artifacts, then verifies the file on disk before publishing it: fp32 size,
PyTorch/ONNX logit parity on random probes and real held-out bars, and identical decoded
note sequences. omr.onnx, omr_config.json, and export_results.json are written together.
"""

import argparse
import datetime
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from PIL import Image

from benchmark import decode
from evaluate import verified_run
from omr_model import image_transform
from training_contract import (BEAT_GRID, DRUMS, DURATIONS, IMG_H, IMG_W, THRESHOLD,
                               sha256_file)

ML_DIR = Path(__file__).resolve().parents[1]
OPSET = 18
PARITY_TOLERANCE = 1e-4
INPUT_NAME = 'image'
OUTPUT_NAMES = ['drum_logits', 'dur_logits']
ARTIFACTS = ('omr.onnx', 'omr_config.json', 'export_results.json')


def inference_config():
    """The notebook's sidecar keys plus the preprocessing the service must reproduce."""
    normalize = image_transform().transforms[-1]
    return {
        'DRUMS': DRUMS, 'DURATIONS': DURATIONS, 'N_BEATS': len(BEAT_GRID),
        'N_DRUMS': len(DRUMS), 'N_DURATIONS': len(DURATIONS),
        'IMG_H': IMG_H, 'IMG_W': IMG_W, 'THRESHOLD': THRESHOLD,
        'INPUT_NAME': INPUT_NAME, 'OUTPUT_NAMES': OUTPUT_NAMES,
        'IMAGENET_MEAN': list(normalize.mean), 'IMAGENET_STD': list(normalize.std),
    }


def export_onnx(model, path):
    probe = torch.randn(1, 3, IMG_H, IMG_W)
    torch.onnx.export(model.eval(), probe, str(path), input_names=[INPUT_NAME],
                      output_names=OUTPUT_NAMES, opset_version=OPSET, dynamo=False,
                      dynamic_axes={name: {0: 'batch'} for name in (INPUT_NAME, *OUTPUT_NAMES)})


def check_size(path, model):
    """Catch order-of-magnitude failures such as the historical 284 KB export."""
    parameters = sum(p.numel() for p in model.parameters())
    expected, actual = parameters * 4, path.stat().st_size
    low, high = expected * 0.75, expected * 1.5 + 5 * 1024 ** 2
    if not low <= actual <= high:
        raise ValueError(f'ONNX size {actual:,} bytes is outside {low:,.0f}-{high:,.0f} '
                         f'bytes expected for {parameters:,} fp32 parameters')
    return {'parameters': parameters, 'onnx_bytes': actual, 'expected_fp32_bytes': expected}


def load_bars(image_paths):
    transform = image_transform()
    tensors = []
    for path in image_paths:
        with Image.open(path) as image:
            tensors.append(transform(image.convert('L')))
    return torch.stack(tensors)


def check_parity(model, session, batches, config):
    """Compare ONNX with PyTorch on logits and on the product-facing note sequences."""
    worst, bars, same, nonempty = 0.0, 0, 0, 0
    with torch.inference_mode():
        for images in batches:
            expected = [output.numpy() for output in model(images)]
            actual = session.run(OUTPUT_NAMES, {INPUT_NAME: images.numpy()})
            worst = max(worst, *(float(np.abs(a - e).max()) for a, e in zip(actual, expected)))
            for i in range(len(images)):
                sequence = decode(expected[0][i:i + 1], expected[1][i:i + 1], config)
                same += sequence == decode(actual[0][i:i + 1], actual[1][i:i + 1], config)
                nonempty += bool(sequence)
                bars += 1
    if worst > PARITY_TOLERANCE:
        raise ValueError(f'ONNX output differs from PyTorch by {worst:.2e} '
                         f'(tolerance {PARITY_TOLERANCE:.0e})')
    if same != bars:
        raise ValueError(f'ONNX decoded {bars - same} of {bars} bars differently from PyTorch')
    return {'bars': bars, 'max_abs_logit_diff': worst, 'identical_sequences': same,
            'nonempty_sequences': nonempty, 'tolerance': PARITY_TOLERANCE}


def verify_export(model, onnx_path, image_paths, batch_size=16):
    if not image_paths:
        raise ValueError('No held-out bar images available to verify the export')
    config = inference_config()
    size = check_size(onnx_path, model)
    session = ort.InferenceSession(str(onnx_path), providers=['CPUExecutionProvider'])
    generator = torch.Generator().manual_seed(0)
    probes = [torch.randn(2, 3, IMG_H, IMG_W, generator=generator)]
    bars = [load_bars(image_paths[i:i + batch_size])
            for i in range(0, len(image_paths), batch_size)]
    return {'size': size, 'parity': {
        'random_probes': check_parity(model, session, probes, config),
        'held_out_bars': check_parity(model, session, bars, config)}}


def evaluated_checkpoint(run_dir, checkpoint):
    path = run_dir / 'eval_results.json'
    if not path.exists():
        raise ValueError('No eval_results.json; run evaluate.py before exporting a release')
    evaluation = json.loads(path.read_text())
    if evaluation.get('checkpoint_sha256') != sha256_file(checkpoint):
        raise ValueError('eval_results.json was produced from a different checkpoint')
    return evaluation


def refuse_existing(run_dir):
    existing = [name for name in ARTIFACTS if (run_dir / name).exists()]
    if existing:
        raise ValueError(f'Export artifacts already exist ({", ".join(existing)}); '
                         'delete them deliberately before re-exporting')


def write_json(path, data):
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(data, indent=2, allow_nan=False) + '\n')
    temporary.replace(path)


def export_release(run_dir, dataset, bars):
    print('Verifying completed run, evaluation, and held-out split...', flush=True)
    model, groups, report, checkpoint = verified_run(run_dir, dataset)
    evaluated_checkpoint(run_dir, checkpoint)
    refuse_existing(run_dir)
    temporary = run_dir / 'omr.onnx.tmp'
    try:
        export_onnx(model, temporary)
        verification = verify_export(model, temporary, [row[0] for row in groups['test']][:bars])
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    onnx_path = run_dir / 'omr.onnx'
    temporary.replace(onnx_path)
    onnx_sha256 = sha256_file(onnx_path)
    write_json(run_dir / 'omr_config.json', {**inference_config(), 'MODEL_SHA256': onnx_sha256})
    results = {
        'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'export_source_sha256': sha256_file(Path(__file__)), 'opset': OPSET,
        'torch_version': str(torch.__version__), 'onnxruntime_version': ort.__version__,
        'checkpoint': checkpoint.name, 'checkpoint_sha256': sha256_file(checkpoint),
        'onnx_sha256': onnx_sha256,
        'training_manifest_sha256': report['training_manifest_sha256'], **verification,
    }
    write_json(run_dir / 'export_results.json', results)
    parity = verification['parity']['held_out_bars']
    print(f'Exported {onnx_path} ({verification["size"]["onnx_bytes"]:,} bytes); '
          f'max logit diff {parity["max_abs_logit_diff"]:.2e} on {parity["bars"]} held-out bars',
          flush=True)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-dir', type=Path, required=True)
    parser.add_argument('--dataset', type=Path, default=ML_DIR / 'data' / 'training' / 'dataset')
    parser.add_argument('--bars', type=int, default=64, help='held-out bars for parity')
    args = parser.parse_args()
    if args.bars < 1:
        parser.error('--bars must be positive')
    export_release(args.run_dir, args.dataset, args.bars)


if __name__ == '__main__':
    main()
