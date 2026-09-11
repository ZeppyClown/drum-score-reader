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

> **Status: the performance numbers are pending a re-run.** The architecture and data
> sections below describe the current 14-drum configuration in
> `notebooks/OMR Training After.ipynb`. The metrics previously published here came from an
> earlier 19-drum run and do **not** describe this model — see
> [Superseded metrics](#superseded-metrics) for why, and what has to be re-run.

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

**The artifacts are not in this repository.** `ml/data/` is gitignored, so a fresh clone
contains the code but no weights. Local downloaded copies currently live in
`ml/data/songsterr/guitar_pro/`, hand-renamed on download:

| Documented name    | Local copy             | Size    |
| ------------------ | ---------------------- | ------- |
| `omr_finetuned.pt` | `Finetuned Model.pt`   | 10.0 MB |
| `omr.onnx`         | `Checkpoints OMR.onnx` | 284 KB  |
| `omr_config.json`  | *not downloaded*       | —       |

> ⚠️ **The local `.onnx` copy is broken, not merely suspect.** A reference export of this
> exact architecture measures **8.78 MB**. The file on disk is 284 KB — about 1/31st of
> that, and too small even for the three head layers alone. Re-export before using it for
> anything, and quote no model size from it. Notebook cell 14a now checks this
> automatically, so it cannot happen again unnoticed.

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

**No current numbers.** Cell 15 (`13b. Re-evaluate after Phase 2`) has no saved output in
the committed notebook, so nothing here is reproducible from the repository as it stands.
Re-run that cell and record its output before quoting any figure anywhere.

When re-run, cell 15 reports:

| Metric | What it measures |
| --- | --- |
| Exact-bar accuracy | Every slot in the 448-slot grid correct. Very strict, and low by construction |
| Cell accuracy | Per-slot correctness. Dominated by empty slots, so it reads high and means little |
| **Sequence accuracy** | The ordered left-to-right list of (drums, duration) events matches, ignoring beat-slot position. **This is the metric that reflects what the product ships** |
| Per-drum F1 | One score per drum, computed at bar level |
| Duration accuracy | Measured at hit positions only, plus a per-duration breakdown with counts |

Sequence accuracy is the one to lead with. The output contract is an ordered note list, so
it scores the model the way it is actually consumed — cell accuracy flatters it and
exact-bar accuracy punishes it for slot-level noise that never reaches the output.

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

**Expect int8 to be slower here.** On an M-series Mac (macOS 14.4, onnxruntime 1.27, one
thread) a dynamically quantised build came out 3.75× smaller but roughly 2.5× *slower* on
CPU than fp32 — the fp32 path hits optimised kernels the `MatMulInteger` path does not.
CoreML was slower than CPU for both, this model being far too small to pay back the
dispatch overhead.

Those figures come from a **reference export of the architecture, not the trained
checkpoint** — size and latency depend on the graph and its shapes, not on what the
weights contain, so they carry over. Output agreement does not: re-measure that against
real weights before quoting it.

---

## Training data

- **Source:** Songsterr (Guitar Pro 7 tabs) + local Guitar Pro 5 files
- **Songs:** 264 total — 212 train / 26 val / 26 test, **split by song, not by bar**
- **Bars:** ~19,948 labelled bar images
- **Labels:** generated programmatically from Guitar Pro MIDI data via `parse_gp7.py` / `parse_gp5.py` — machine-derived, not hand-annotated
- **Image source:** bar images cropped from rendered PDFs

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

The generator reruns both crop detectors in read-only mode, so it can take about a minute.
It refuses duplicate identities, missing source files, mismatched image/label stems, and
filename/JSON bar-number disagreements instead of silently emitting an ambiguous
manifest.

---

## Limitations

Carried over from the earlier run — expectations to re-confirm, not measured results for
the current model.

- **Tom confusion:** floor_tom_1 vs floor_tom_2 differ only by vertical staff position, which global average pooling handles poorly.
- **Ride vs crash confusion:** both are x-noteheads on high staff lines and are confused at moderate rates.
- **Rare drums:** several classes were dropped outright for having too few examples; the remaining rare ones are still the weakest.
- **Non-standard notation:** unusual time signatures, grace notes and multi-voice complexity may degrade accuracy.
- **Overfitting:** the earlier run had train loss 0.205 against val loss 0.492. More diverse songs should close the gap.

---

## Roadmap

- [ ] Re-run the Phase 2 evaluation, then cell 13c to write `eval_results.json`, and paste
      the markdown it prints into [Performance](#performance)
- [ ] Re-export `omr.onnx` and run cell 14a — it fails loudly if the file is the wrong size
- [ ] Run `omr/benchmark.py` against the re-exported model and record the numbers here,
      including the int8 agreement rate, which the reference export could not establish
- [ ] Add more training songs (target: 500+) to reduce overfitting
- [ ] Replace global average pool with spatially-aware pooling to better distinguish toms
- [ ] Add rest detection to output silent positions explicitly
- [ ] Wire into Electron + FastAPI for end-to-end drum score reading

---

## Citation

Work in progress — part of the Drum Hub project.
