"""Benchmark the OMR ONNX model: size, latency, and what quantisation costs.

Run this on the machine the model is meant to run on. The point is not to
produce a flattering number — it is to attach a measured latency to a named
piece of hardware, and to show what int8 quantisation actually costs in output
quality rather than assuming it is free.

    python ml/omr/benchmark.py \
        --model "ml/data/songsterr/guitar_pro/omr.onnx" \
        --images ml/data/dataset/images \
        --n 200

What it reports:

  size       fp32 vs int8 on disk
  latency    p50 / p95 / p99 per provider, after warmup, single bar per call
  agreement  how often int8 produces the same decoded note sequence as fp32,
             measured on real bar images -- not on random noise, which would
             make any model look agreeable

Quantisation needs the `onnx` package (`pip install onnx`). Without it the
script still reports fp32 size and latency and says so.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import statistics
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort

WARMUP_RUNS = 10


# ── Preprocessing ─────────────────────────────────────────────────────────────
# Must match the training transform exactly (notebook cell 17): resize to
# IMG_H x IMG_W, greyscale expanded to 3 channels, ImageNet normalisation.
# If this drifts, the latency is still valid but the agreement number is not.

IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(3, 1, 1)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(3, 1, 1)


def load_bar(path: Path, img_h: int, img_w: int) -> np.ndarray:
    """One bar image → (1, 3, H, W) float32, preprocessed as in training."""
    from PIL import Image

    img = Image.open(path).convert('L').resize((img_w, img_h), Image.BILINEAR)
    arr = np.asarray(img, dtype=np.float32) / 255.0
    arr = np.repeat(arr[None, :, :], 3, axis=0)          # greyscale → 3 channels
    arr = (arr - IMAGENET_MEAN) / IMAGENET_STD
    return arr[None, ...].astype(np.float32)


def decode(drum_logits, dur_logits, cfg) -> list:
    """Logits → the ordered note list the product actually consumes."""
    n_beats, n_drums = cfg['N_BEATS'], cfg['N_DRUMS']
    drum_probs = 1 / (1 + np.exp(-drum_logits[0]))
    grid = drum_probs.reshape(n_beats, n_drums)
    durs = dur_logits[0].reshape(n_beats, cfg['N_DURATIONS']).argmax(axis=1)

    notes = []
    for bi in range(n_beats):
        hits = [cfg['DRUMS'][di] for di in range(n_drums)
                if grid[bi, di] > cfg['THRESHOLD']]
        if hits:
            notes.append({'duration': cfg['DURATIONS'][durs[bi]], 'drums': hits})
    return notes


# ── Measurement ───────────────────────────────────────────────────────────────

def make_session(model_path: str, provider: str) -> ort.InferenceSession:
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 1   # pin to 1 so the number is reproducible
    return ort.InferenceSession(model_path, opts, providers=[provider])


def measure_latency(sess, sample: np.ndarray, runs: int) -> dict:
    """Warm up, then time `runs` single-bar inferences. Returns milliseconds."""
    for _ in range(WARMUP_RUNS):
        sess.run(None, {'image': sample})

    times = []
    for _ in range(runs):
        t0 = time.perf_counter()
        sess.run(None, {'image': sample})
        times.append((time.perf_counter() - t0) * 1000)

    times.sort()
    return {
        'runs':   runs,
        'mean_ms': round(statistics.mean(times), 3),
        'p50_ms':  round(times[int(runs * 0.50)], 3),
        'p95_ms':  round(times[min(int(runs * 0.95), runs - 1)], 3),
        'p99_ms':  round(times[min(int(runs * 0.99), runs - 1)], 3),
        'min_ms':  round(times[0], 3),
        'max_ms':  round(times[-1], 3),
    }


def measure_agreement(sess_a, sess_b, batch: list, cfg) -> dict:
    """How often do two models decode to the same note sequence?

    Exact sequence match is the honest bar: a per-slot agreement rate would sit
    near 100% simply because most slots are empty.
    """
    same, total_slots, diff_slots, non_empty = 0, 0, 0, 0
    for x in batch:
        a_d, a_u = sess_a.run(None, {'image': x})
        b_d, b_u = sess_b.run(None, {'image': x})

        seq_a = decode(a_d, a_u, cfg)
        if seq_a:
            non_empty += 1
        if seq_a == decode(b_d, b_u, cfg):
            same += 1

        a_bits = (1 / (1 + np.exp(-a_d[0])) > cfg['THRESHOLD'])
        b_bits = (1 / (1 + np.exp(-b_d[0])) > cfg['THRESHOLD'])
        diff_slots += int((a_bits != b_bits).sum())
        total_slots += a_bits.size

    # Two models that both predict nothing agree perfectly and mean nothing.
    # An untrained or mis-loaded checkpoint decodes to empty sequences on every
    # bar, so record how many bars actually produced notes and refuse to call
    # the agreement meaningful when almost none did.
    result = {
        'bars':                   len(batch),
        'bars_with_notes':        non_empty,
        'sequence_match':         same,
        'sequence_match_rate':    round(same / len(batch), 4) if batch else None,
        'slot_disagreement_rate': round(diff_slots / total_slots, 6) if total_slots else None,
        'meaningful':             non_empty >= max(1, len(batch) // 10),
    }
    if not result['meaningful']:
        result['warning'] = (
            f'only {non_empty}/{len(batch)} bars decoded to any notes — the models '
            f'agree because both predict nothing. Check the checkpoint is trained '
            f'and loaded before quoting this agreement rate.'
        )
    return result


# ── Orchestration ─────────────────────────────────────────────────────────────

def quantise(model_path: str) -> str | None:
    """Dynamic int8 quantisation. Returns the new path, or None if unavailable.

    The pre-processing pass is not optional. Without it quantize_dynamic fails
    on this model with "Unable to find data type for weight_name=..." because
    the exported graph carries no inferred types for the MatMul feeding the
    shared head. Running shape inference first fixes it properly;
    DefaultTensorType is the fallback for any node inference still misses.

    A failure here is not fatal — fp32 results are still worth having, so we
    report the reason and carry on.
    """
    try:
        import onnx
        from onnxruntime.quantization import QuantType, quantize_dynamic
        from onnxruntime.quantization.shape_inference import quant_pre_process
    except ImportError:
        print('  int8: SKIPPED — needs the `onnx` package (pip install onnx)\n')
        return None

    prepped = model_path.replace('.onnx', '.prep.onnx')
    out = model_path.replace('.onnx', '.int8.onnx')
    try:
        quant_pre_process(model_path, prepped, skip_symbolic_shape=True)
        quantize_dynamic(
            prepped, out,
            weight_type=QuantType.QInt8,
            extra_options={'DefaultTensorType': onnx.TensorProto.FLOAT},
        )
    except Exception as exc:                      # noqa: BLE001 - reported, not swallowed
        print(f'  int8: SKIPPED — quantisation failed: {type(exc).__name__}: {exc}\n')
        return None
    finally:
        if os.path.exists(prepped):
            os.remove(prepped)

    # quantize_dynamic can emit a file that will not load — MatMulInteger shape
    # errors are the usual culprit. Catch that here rather than halfway through
    # the benchmark, and never report a size for a model that cannot run.
    try:
        ort.InferenceSession(out, providers=['CPUExecutionProvider'])
    except Exception as exc:                      # noqa: BLE001
        print(f'  int8: SKIPPED — quantised model fails to load: {exc}\n'
              f'        (the .onnx is at {out} if you want to inspect it)\n')
        return None
    return out


def hardware() -> dict:
    return {
        'machine':       platform.machine(),
        'processor':     platform.processor(),
        'platform':      platform.platform(),
        'python':        platform.python_version(),
        'onnxruntime':   ort.__version__,
        'cpu_count':     os.cpu_count(),
        'intra_op_threads': 1,
    }


def build_batch(images_dir: Path, n: int, cfg) -> list:
    if not images_dir.is_dir():
        print(f'  agreement: SKIPPED — no image directory at {images_dir}\n')
        return []
    paths = sorted(p for p in images_dir.iterdir()
                   if p.suffix.lower() in {'.png', '.jpg', '.jpeg'})[:n]
    if not paths:
        print(f'  agreement: SKIPPED — no images found in {images_dir}\n')
        return []
    return [load_bar(p, cfg['IMG_H'], cfg['IMG_W']) for p in paths]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--model', required=True, help='path to omr.onnx')
    ap.add_argument('--config', help='omr_config.json (default: beside the model)')
    ap.add_argument('--images', default='ml/data/dataset/images',
                    help='real bar images, for the agreement check')
    ap.add_argument('--n', type=int, default=200, help='bars for the agreement check')
    ap.add_argument('--runs', type=int, default=200, help='timed runs per provider')
    ap.add_argument('--out', default='ml/omr/benchmark_results.json')
    args = ap.parse_args()

    model = Path(args.model)
    if not model.is_file():
        print(f'error: no model at {model}', file=sys.stderr)
        return 1

    cfg_path = Path(args.config) if args.config else model.parent / 'omr_config.json'
    if not cfg_path.is_file():
        print(f'error: no config at {cfg_path}\n'
              f'       it is written by notebook cell 14; download it with the model.',
              file=sys.stderr)
        return 1
    cfg = json.loads(cfg_path.read_text())

    hw = hardware()
    print(f'\nHardware : {hw["platform"]}')
    print(f'Runtime  : onnxruntime {hw["onnxruntime"]}, 1 intra-op thread')
    print(f'Model    : {model.name}  ({model.stat().st_size / 1024**2:.2f} MB)')
    print(f'Config   : {cfg["N_DRUMS"]} drums, {cfg["N_BEATS"]} beats, '
          f'{cfg["IMG_H"]}x{cfg["IMG_W"]} input\n')

    variants = {'fp32': str(model)}
    q = quantise(str(model))
    if q:
        variants['int8'] = q

    providers = [p for p in ('CPUExecutionProvider', 'CoreMLExecutionProvider')
                 if p in ort.get_available_providers()]

    sample = np.random.randn(1, 3, cfg['IMG_H'], cfg['IMG_W']).astype(np.float32)
    batch = build_batch(Path(args.images), args.n, cfg)

    results = {'hardware': hw, 'config_path': str(cfg_path), 'variants': {}}

    for name, path in variants.items():
        size_mb = os.path.getsize(path) / 1024**2
        entry = {'path': path, 'size_mb': round(size_mb, 3), 'latency': {}}
        print(f'{name}  —  {size_mb:.2f} MB')
        for prov in providers:
            lat = measure_latency(make_session(path, prov), sample, args.runs)
            entry['latency'][prov] = lat
            print(f'  {prov:28s} p50 {lat["p50_ms"]:7.2f} ms   '
                  f'p95 {lat["p95_ms"]:7.2f} ms   p99 {lat["p99_ms"]:7.2f} ms')
        results['variants'][name] = entry
        print()

    if 'int8' in variants and batch:
        agr = measure_agreement(
            make_session(variants['fp32'], 'CPUExecutionProvider'),
            make_session(variants['int8'], 'CPUExecutionProvider'),
            batch, cfg,
        )
        results['int8_vs_fp32'] = agr
        print(f'int8 vs fp32 on {agr["bars"]} real bars')
        print(f'  bars decoding to notes  : {agr["bars_with_notes"]}/{agr["bars"]}')
        print(f'  identical note sequence : {agr["sequence_match"]}/{agr["bars"]}'
              f'  ({agr["sequence_match_rate"]*100:.1f}%)')
        print(f'  slot disagreement rate  : {agr["slot_disagreement_rate"]*100:.4f}%')
        if not agr['meaningful']:
            print(f'  ⚠️  NOT MEANINGFUL — {agr["warning"]}')
        print()

        f32 = results['variants']['fp32']
        i8 = results['variants']['int8']
        ratio = (f32['latency']['CPUExecutionProvider']['p95_ms']
                 / i8['latency']['CPUExecutionProvider']['p95_ms'])
        results['summary'] = {
            'size_reduction_x': round(f32['size_mb'] / i8['size_mb'], 2),
            'p95_speedup_x':    round(ratio, 2),
        }
        print(f'  size   {results["summary"]["size_reduction_x"]}x smaller')
        # A ratio below 1 is a slowdown. Say so plainly rather than printing
        # "0.29x faster", which reads as an improvement at a glance.
        if ratio >= 1:
            print(f'  p95    {ratio:.2f}x faster on CPU\n')
        else:
            print(f'  p95    {1/ratio:.2f}x SLOWER on CPU — int8 costs latency here\n')

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(results, indent=2) + '\n')
    print(f'Written to {out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
