---
language:
  - en
tags:
  - music
  - audio
  - drum
  - sheet-music
  - omr
  - optical-music-recognition
  - mobilenet
  - pytorch
  - onnx
license: mit
---

# Drum OMR — MobileNetV3

A computer vision model that reads **drum sheet music** from images.

Give it a cropped image of one bar of drum notation, and it outputs an ordered list of notes — which drums are hit and how long each note lasts — ready to feed into a music renderer or drum machine.

> **Status: first measured release, `baseline-14drum-v1` (2026-09-13).** Trained locally on
> an M1 Mac (MPS) on the strict 19,942-bar supported subset, evaluated on 28 held-out
> songs, exported, benchmarked, and bundled. Every figure below comes from
> `ml/releases/baseline-14drum-v1/`. Accuracy is a baseline, not a shippable result: read
> [Performance](#performance) before building on it. Older figures from a 19-drum run are
> retained only in [Superseded metrics](#superseded-metrics).

---

## What it does

```
[bar image] → model → [{duration, drums}, {duration, drums}, ...]
```

**Input:** A cropped PNG image of one bar of drum sheet music (resized to 128×384 pixels internally).

**Output:** An ordered list of notes, left-to-right:

```json
[
  { "duration": "eighth", "drums": ["kick", "hi_hat_closed"] },
  { "duration": "eighth", "drums": ["hi_hat_closed"] },
  { "duration": "quarter", "drums": ["snare", "hi_hat_closed"] },
  { "duration": "eighth", "drums": ["kick", "hi_hat_closed"] }
]
```

No beat positions — just the sequence of notes in the order they appear. Use the durations to reconstruct timing.

---

## Files

Training writes three files to `CKPT_DIR` (a Google Drive folder during Colab runs):

| File               | Purpose                                                               |
| ------------------ | --------------------------------------------------------------------- |
| `omr_finetuned.pt` | PyTorch checkpoint — use this to resume training or fine-tune          |
| `omr.onnx`         | ONNX export — use this for inference (no PyTorch needed)               |
| `omr_config.json`  | Sidecar written by cell 14: drum names, duration names, `N_BEATS`, `N_DRUMS`, `N_DURATIONS`, `IMG_H`, `IMG_W`, `THRESHOLD` |

Always read dimensions and class names from `omr_config.json` rather than hardcoding them.
The config is the contract between training and inference: if the drum list changes, only
the config changes.

**The weights are not in this repository.** `ml/data/` is gitignored, so a fresh clone has
the code and the evidence but no model. The current release lives in two places:

| Location | Holds | In Git? |
| --- | --- | --- |
| `ml/data/releases/baseline-14drum-v1/` | `omr_finetuned.pt` (9.35 MB), `omr.onnx` (9.23 MB), and all the JSON below | no (ignored) |
| `ml/releases/baseline-14drum-v1/` | `omr_config.json`, `eval_results.json`, `export_results.json`, `benchmark_results.json`, `run_config.json`, `history.json`, `training_complete.json`, `release_manifest.json` | yes |

`release_manifest.json` lists the SHA-256 and size of every file, so a copied bundle can be
checked against it. `ml/omr/release.py` refuses to bundle unless the completion marker,
evaluation, export, config, and benchmark all name the same checkpoint, ONNX file, and
training dataset.

> ⚠️ **The older `ml/data/songsterr/guitar_pro/Checkpoints OMR.onnx` (284 KB) is broken**,
> about 1/31st of the ~8.8 MB this fp32 architecture needs. Ignore it; `export.py` now
> fails loudly on a file that size.

---

## How to use (ONNX — recommended)

```python
import json

import numpy as np
import onnxruntime as ort
import torchvision.transforms as T
from PIL import Image

CKPT_DIR = '.'  # directory holding omr.onnx and omr_config.json

# Every dimension and class name comes from the sidecar config — never hardcode them.
with open(f'{CKPT_DIR}/omr_config.json') as f:
    cfg = json.load(f)

DRUMS       = cfg['DRUMS']        # 14 drum names, in output-column order
DURATIONS   = cfg['DURATIONS']    # 10 duration names, in class order
N_BEATS     = cfg['N_BEATS']      # 32 rhythmic positions per bar
N_DRUMS     = cfg['N_DRUMS']      # 14
N_DURATIONS = cfg['N_DURATIONS']  # 10
IMG_H       = cfg['IMG_H']        # 128
IMG_W       = cfg['IMG_W']        # 384
THRESHOLD   = cfg['THRESHOLD']    # 0.5

sess = ort.InferenceSession(f'{CKPT_DIR}/omr.onnx')

transform = T.Compose([
    T.Resize((IMG_H, IMG_W)),
    T.Grayscale(num_output_channels=3),
    T.ToTensor(),
    T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])


def predict_bar(image_path: str) -> list:
    """Run ONNX inference on one bar image → ordered list of {duration, drums}."""
    img = Image.open(image_path).convert('L')
    x   = transform(img).unsqueeze(0).numpy()      # (1, 3, IMG_H, IMG_W)

    drum_logits, dur_logits = sess.run(None, {'image': x})

    # sigmoid: raw logits → probability that each drum is present at each beat slot
    drum_probs = 1 / (1 + np.exp(-drum_logits[0]))
    drum_grid  = drum_probs.reshape(N_BEATS, N_DRUMS)          # (32, 14)
    dur_preds  = dur_logits[0].reshape(N_BEATS, N_DURATIONS).argmax(axis=1)

    notes = []
    for bi in range(N_BEATS):
        drums = [DRUMS[di] for di in range(N_DRUMS) if drum_grid[bi, di] > THRESHOLD]
        if drums:  # silent slots are skipped — the durations fill the bar time
            notes.append({
                'duration': DURATIONS[dur_preds[bi]],
                'drums':    drums,
            })
    return notes
```

This mirrors cell 17 of the training notebook, which is the reference implementation.

---

## Architecture

- **Backbone:** MobileNetV3-Small, pretrained on ImageNet
- **Shared head:** Linear(576→1024) + Hardswish + Dropout
- **Drum head:** Linear(1024→448) — 32 beat positions × 14 drums, binary per slot
- **Duration head:** Linear(1024→320) — 32 beat positions × 10 duration classes
- **Total parameters:** 2,305,056
- **Training:** Two-phase — backbone frozen (Phase 1, 15 epochs), full fine-tune at LR/10 (Phase 2, 25 epochs)

Head sizes derive from `N_DRUMS` / `N_DURATIONS` in cell 3, so they track the drum list
automatically. The parameter count above is computed from the architecture defined in
cells 3 and 8; it is not a figure read off a training run.

---

## Drums recognised

**14 drum types**, in output-column order:

| Category      | Drums                                            |
| ------------- | ------------------------------------------------ |
| Core          | hi_hat_closed, snare, kick                       |
| Hi-hat        | hi_hat_open_half, hi_hat_open_full, hi_hat_pedal |
| Cymbals       | ride, crash, ride_bell                           |
| Toms          | tom_hi, tom_mid, floor_tom_1, floor_tom_2        |
| Articulations | snare_rim (side stick / cross stick)             |

**Not recognised.** These were removed from the label set in cell 3; the model has no
output column for them:

- `cowbell`, `clap`, `choked_crash`, `china`, `snare_rimshot` — scored F1 = 0.000 in the
  earlier 19-drum run, so they only diluted the loss
- `ride_tie`, `splash`, `sticks` — fewer than 70 hits in the dataset

Re-adding any of them needs more training songs that actually contain them, then a
retrain — the head resizes itself from `N_DRUMS`.

## Durations recognised

**10 duration classes:** `whole`, `half`, `dotted_quarter`, `quarter`, `dotted_eighth`, `eighth`, `sixteenth`, `thirty_second`, `triplet_eighth`, `triplet_sixteenth`

---

## Performance

Measured by `ml/omr/evaluate.py` on **2,184 bars from 28 songs held out of training**,
split by song. Reproducible from `ml/releases/baseline-14drum-v1/eval_results.json`.

| Metric | Value | What it measures |
| --- | --- | --- |
| **Sequence accuracy** | **12.5%** | The ordered left-to-right list of (drums, duration) events matches. **This is what the product ships** |
| Exact-bar accuracy | 12.5% | Every slot in the 448-slot grid correct |
| Cell accuracy | 96.7% | Per-slot correctness. Dominated by empty slots, so it reads high and means little |
| Duration accuracy (at hits) | 89.7% | Note length, scored only where the ground truth has a hit |

The model predicted at least one note in 1,994 of 2,184 bars, so the low sequence accuracy
is wrong notes, not silence.

**Read this as a baseline, not a shippable result.** Roughly one bar in eight is read
perfectly. Kick, snare, and closed hi-hat are usable; everything else over-fires.

### Per-drum F1 (bar-level presence)

| Drum | F1 | Bars containing it | False positives |
| --- | --- | --- | --- |
| kick | 0.941 | 1744 | 125 |
| snare | 0.879 | 1597 | 313 |
| hi_hat_closed | 0.874 | 947 | 164 |
| crash | 0.696 | 632 | 237 |
| snare_rim | 0.647 | 139 | 108 |
| hi_hat_pedal | 0.612 | 118 | 136 |
| ride | 0.539 | 188 | 286 |
| ride_bell | 0.522 | 104 | 182 |
| hi_hat_open_half | 0.514 | 195 | 187 |
| floor_tom_1 | 0.388 | 144 | 375 |
| floor_tom_2 | 0.382 | 69 | 177 |
| tom_mid | 0.314 | 115 | 439 |
| tom_hi | 0.208 | 73 | 409 |
| hi_hat_open_full | 0.105 | 27 | 45 |

The false-positive column is the story: the model finds the rare drums (tom_hi recall is
56/73) but claims them in hundreds of bars that do not contain them. Training weights
positives by their rarity, which buys recall at the cost of precision. Lowering that
weighting, or raising the 0.5 threshold per drum, is the cheapest next experiment.

### Duration accuracy by class (at ground-truth hits)

| Duration | Accuracy | Support |
| --- | --- | --- |
| eighth | 0.942 | 9498 |
| quarter | 0.891 | 1061 |
| sixteenth | 0.854 | 4385 |
| triplet_eighth | 0.953 | 148 |
| triplet_sixteenth | 0.819 | 177 |
| whole | 0.938 | 16 |
| thirty_second | 0.525 | 356 |
| dotted_eighth | 0.127 | 118 |
| half | 0.000 | 6 |
| dotted_quarter | 0.000 | 1 |

Common durations are solid. Dotted eighths are read as plain eighths almost every time
(15/118), and the long notes have too little support to judge.

### Superseded metrics

The previous version of this file reported per-drum F1 for **19 drums** (kick 0.929, snare
0.890, … , plus cowbell / clap / choked_crash / china / snare_rimshot at 0.000), cell
accuracy 97.4%, exact-bar accuracy 14.7%, and duration accuracy 90.9%.

Those figures describe a different model and have been removed rather than carried forward:

1. **The drum list changed.** That run had 19 output classes; the notebook now defines 14.
   Five drums in the old table no longer exist as outputs.
2. **The parameter count proves it.** The old card claimed 2,469,056 parameters, which is
   exactly a 19-drum head (Linear(1024→608)). The current 14-drum configuration is
   2,305,056.
3. **Nothing was saved.** The evaluation cells carry no stored output, so the old numbers
   cannot be checked against the notebook that produced them.

The earlier run's qualitative findings still look sound and are kept in
[Limitations](#limitations) — kick and snare strongest, floor_tom_1 vs floor_tom_2 and ride
vs crash weakest. Treat those as expectations to confirm, not as results.

---

## Benchmarking on-device

`omr/benchmark.py` measures what the model costs on the machine it is meant to run on.
Run it locally — not in Colab, whose hardware is not the target.

```bash
pip install onnx                      # needed for quantisation only
python ml/omr/benchmark.py \
    --model  path/to/omr.onnx \
    --images ml/data/dataset/images \
    --n 200
```

It reports fp32 and int8 size, p50/p95/p99 latency per execution provider (pinned to one
intra-op thread so the figure is reproducible), and how often int8 decodes to the *same
note sequence* as fp32 across real bar images. Results land in
`ml/omr/benchmark_results.json`.

Two deliberate choices in how it scores:

- **Agreement is exact-sequence match, not per-slot.** Per-slot agreement would sit near
  100% because most of the 448-slot grid is empty — it would measure how sparse drum
  notation is, not what quantisation costs.
- **It refuses to report a meaningless agreement.** Two models that both predict nothing
  agree perfectly, so the script counts how many bars decoded to any notes at all and
  marks the comparison `NOT MEANINGFUL` when almost none did.

### Measured for `baseline-14drum-v1`

M1 Mac, macOS 14.4, onnxruntime 1.27, one intra-op thread, one bar per call:

| Build | Size | CPU p50 | CPU p95 | CoreML p50 | CoreML p95 |
| --- | --- | --- | --- | --- | --- |
| fp32 | 8.80 MB | 16.4 ms | 39.6 ms | 19.9 ms | 26.6 ms |
| int8 | 2.37 MB | 42.5 ms | 50.0 ms | 62.9 ms | 91.1 ms |

**Ship fp32.** At ~16 ms per bar, a 100-bar page reads in under two seconds. int8 is 3.7×
smaller but 1.26× slower at p95 — the fp32 path hits optimised kernels the `MatMulInteger`
path does not — and, worse, **it changes the output**: across 200 real bars int8 decoded a
different note list every time (0/200 identical, 5.66% of slots disagreeing). Quantisation
is not free for this model; do not use the int8 build without retraining for it.

---

## Training data

- **Source:** Songsterr (Guitar Pro 7 tabs) + local Guitar Pro 5 files
- **Songs:** 289 total — 233 train / 28 val / 28 test, **split by song, not by bar**
- **Bars:** 23,660 labelled bar images
- **Labels:** generated programmatically from Guitar Pro MIDI data via `parse_gp7.py` / `parse_gp5.py` — machine-derived, not hand-annotated
- **Image source:** bar images cropped from rendered PDFs

The 159 parsed labels for `The Trees` are excluded from this replacement dataset because
the available one-page Songsterr PDF contains no score content. The exclusion remains in
`data_reconciliation.csv` so it cannot be mistaken for silently missing data.

The by-song split is deliberate. Drum notation repeats heavily within a song, so a random
bar-level split would put near-identical bars on both sides of the boundary and inflate
every score.

### Manifest and reconciliation

Regenerate the versioned dataset audit from the current files under `ml/data/`:

```bash
python ml/data-prep/build_manifest.py
```

This writes:

- `ml/dataset_manifest.csv`: one row per packaged pair, including its song, original
  GP5/GP7 source, bar number, image, label, and deterministic train/validation/test split.
- `ml/data_reconciliation.csv`: one row per raw label absent from the packaged dataset,
  with the evidence-based reason and crop-audit totals.
- `ml/data_reconciliation.md`: a human-readable summary grouped by reason and song.

The generator reruns both crop detectors in read-only mode, so it can take several minutes.
It refuses duplicate identities, missing source files, mismatched image/label stems, and
filename/JSON bar-number disagreements instead of silently emitting an ambiguous
manifest.

### Strict subset for the first training release

Build the training package from the reconciled dataset:

```bash
python3 ml/omr/prepare_training.py
```

This preserves `dataset_manifest.csv` song assignments and writes
`training_manifest.csv` (19,942 accepted bars with image/label SHA-256 hashes),
`training_exclusions.csv` (3,718 bars with reasons), `training_report.json`, and the
ignored local `ml/data/training.zip`. It preserves the full dataset and `dataset.zip`.
The training split contains 15,839 bars / 232 songs, validation 1,919 / 27, and test
2,184 / 28. No retained song changes splits.

The shared `ml/omr/training_contract.py` rejects whole bars with unsupported hit drums or
durations, off-grid onsets, duplicate onsets, long measures, flams, or context-dependent
simile flags. It never invents a replacement duration or discards an unsupported hit.
Rests remain silent targets and ghost dynamics map to their base drum. Filtering cannot
undo quantization or voice merging already performed by the source parsers; this is a
supported-target baseline, not complete notation fidelity.

Upload **training.zip** to `MyDrive/drumhub/training.zip`, then run
`ml/notebooks/OMR Training After.ipynb` in a fresh Colab GPU runtime. The ZIP includes the
shared encoder and audit artifacts. The notebook extracts to a directory keyed by the
ZIP hash, verifies all included files, and reads the saved splits instead of reshuffling
songs after filtering. Checkpoints use a package-specific Drive folder. Old 19-drum
checkpoints must not be resumed, including as backbone warm starts: the new test split
overlaps their original training songs.

Evaluation records the training manifest/package hashes and the subset scope, including
359 excluded bars from the source test split. Do not report these metrics as accuracy
over all 23,660 source pairs.

Run training-contract regressions with:

```bash
python3 -m unittest discover -s ml/omr -p 'test_*.py'
```

### Local training and resumption

The local runner uses the same `omr_model.py` architecture, preprocessing, and strict
targets packaged for Colab. Prepare and extract the package before running it:

```bash
python3 ml/omr/prepare_training.py
python3 -m zipfile -e ml/data/training.zip ml/data/training
python3 -u ml/omr/train.py --device mps --run-dir ml/data/training/runs/baseline
```

Use `--device cpu` or `--device cuda` for other hardware. Apple GPU access must be
available to the process; the runner fails if MPS was explicitly selected but unavailable.
ImageNet backbone weights are downloaded on the first full run into the ignored
`ml/data/training/torch-cache/` directory.

The defaults match Colab: 15 head-only epochs, 25 full-model epochs, batch size 32,
learning rate 0.0003 then 0.00003. The head-only phase freezes BatchNorm buffers as well
as backbone parameters. The runner saves `last.pt` after each completed epoch with
optimizer, scheduler, RNG state, and run configuration; resume with the same arguments
plus `--resume`. Code, model, dataset, runtime, or hyperparameter mismatches are rejected.
An interrupted partial epoch restarts from the last completed epoch. If initialization
failed before the first checkpoint, `--resume` retries initialization.

For a short rehearsal, use a separate run directory and add
`--smoke-batches 2 --epochs 1 --finetune-epochs 1 --random-init`. Add
`--stop-after-epochs 1` to exercise a controlled epoch boundary, then repeat the same
arguments with `--resume` and without the stop flag. Smoke runs are marked explicitly
and must never be exported as a release. Full runs produce `training_complete.json`;
held-out test evaluation and ONNX export are still separate release steps.

### Local evaluation and ONNX export

After `training_complete.json` exists, run the release steps in order:

```bash
RUN=ml/data/training/runs/baseline-14drum-v1
python3 ml/omr/evaluate.py --run-dir "$RUN"
python3 ml/omr/export.py --run-dir "$RUN"
python3 ml/omr/benchmark.py --model "$RUN/omr.onnx" --out "$RUN/benchmark_results.json" \
    --images ml/data/training/dataset/images
python3 ml/omr/release.py --run-dir "$RUN" --name baseline-14drum-v1
```

Benchmark with training stopped, or the latency figures measure contention rather than
the model. `release.py` refuses to bundle unless the completion marker, evaluation,
export, config, and benchmark all name the same checkpoint hash, ONNX hash, and training
dataset. Weights go to the ignored `ml/data/releases/<name>/`; the JSON evidence and a
`release_manifest.json` of file hashes also go to the versioned `ml/releases/<name>/`.
An existing release name is never overwritten.

`export.py` needs `pip install onnx onnxscript`. It refuses smoke runs, unfinished runs,
checkpoints without a matching `eval_results.json`, and existing export artifacts. Before
publishing, it checks the file on disk: size must match the fp32 parameter count (the
historical 284 KB file fails); on random probes and 64 held-out test bars the ONNX logits
must stay within 1e-4 of PyTorch's *relative to the largest logit* (float32 rounding grows
with the numbers involved, so a fixed absolute limit would pass an untrained model and
fail a trained one), no slot may cross the hit/no-hit threshold, and every bar must decode
to the same note sequence. It writes
`omr.onnx`, `omr_config.json` (the notebook's keys plus input/output names, ImageNet
normalization, and `MODEL_SHA256`), and `export_results.json` with the verification
evidence and checkpoint/dataset hashes.

---

## Limitations

Measured on the `baseline-14drum-v1` test split unless stated otherwise.

- **Over-firing on rare drums:** the toms, ride, ride bell, and open hi-hats are claimed in
  far more bars than contain them (tom_mid: 439 false positives against 115 real bars).
  This, not missed notes, is what keeps sequence accuracy at 12.5%.
- **Tom confusion:** floor_tom_1 vs floor_tom_2 and tom_hi vs tom_mid differ only by
  vertical staff position, which global average pooling handles poorly. All four are below
  F1 0.40.
- **Ride vs crash:** both are x-noteheads high on the staff; crash reaches F1 0.70, ride
  only 0.54 with 286 false positives.
- **Dotted eighths:** read as plain eighths 103 times out of 118.
- **Long notes barely tested:** half notes (6) and dotted quarters (1) have too little
  support in the test split to judge.
- **Overfitting:** this run ended at train loss 0.179 against validation loss 0.404 — the
  same gap as the earlier 19-drum run. More songs remains the main fix.
- **Non-standard notation:** unusual time signatures, grace notes, and multi-voice
  complexity are outside the supported subset and untested.
- **int8 quantisation changes the output** (see [Benchmarking](#benchmarking-on-device)).

---

## Roadmap

- [x] Evaluate on the held-out test songs and record the numbers in
      [Performance](#performance) — `baseline-14drum-v1`, 2026-09-13
- [x] Export `omr.onnx` with `omr/export.py` — fails loudly on the wrong size, a logit
      drift beyond scale, a flipped hit decision, or a differently decoded bar
- [x] Run `omr/benchmark.py` on the target Mac and record the numbers, including the int8
      agreement rate (0/200 — int8 is not usable as exported)
- [ ] Cut the false positives on rare drums: lower the rarity weighting in the loss, or
      tune a per-drum threshold on the validation split (cheapest next experiment)
- [ ] Add more training songs (target: 500+) to reduce overfitting
- [ ] Replace global average pool with spatially-aware pooling to better distinguish toms
- [ ] Add rest detection to output silent positions explicitly
- [ ] Wire into Electron for end-to-end drum score reading (the local FastAPI service is in
      `backend/`; see `backend/README.md`)

---

## Citation

Work in progress — part of the Drum Hub project.
