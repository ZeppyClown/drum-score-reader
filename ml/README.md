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

| File               | Purpose                                                       |
| ------------------ | ------------------------------------------------------------- |
| `omr_finetuned.pt` | PyTorch checkpoint — use this to resume training or fine-tune |
| `omr.onnx`         | ONNX export — use this for inference (no PyTorch needed)      |

---

## How to use (ONNX — recommended)

```python
import onnxruntime as ort
import numpy as np
from PIL import Image
import torchvision.transforms as T

DRUMS = [
    'hi_hat_closed', 'snare', 'kick', 'ride', 'crash',
    'hi_hat_open_half', 'hi_hat_open_full', 'hi_hat_pedal',
    'floor_tom_1', 'floor_tom_2', 'tom_mid', 'tom_hi',
    'ride_bell', 'snare_rim',
]
    # to be added later
    # 'snare_rimshot', 'cowbell', 'clap', 'choked_crash', 'china',
DURATIONS = [
    'whole', 'half', 'dotted_quarter', 'quarter',
    'dotted_eighth', 'eighth', 'sixteenth', 'thirty_second',
    'triplet_eighth', 'triplet_sixteenth',
]
CONFIG_PATH = f'{CKPT_DIR}/omr_config.json'
N_BEATS, N_DRUMS, N_DURATIONS = CONFIG_PATH.N_BEATS, CONFIG_PATH.N_DRUMS, CONFIG_PATH.N_DURATIONS,
THRESHOLD = 0.5

sess = ort.InferenceSession('omr.onnx')

transform = T.Compose([
    T.Resize((128, 384)),
    T.Grayscale(num_output_channels=3),
    T.ToTensor(),
    T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])

def predict_bar(image_path: str) -> list:
    img = Image.open(image_path).convert('L')
    x   = transform(img).unsqueeze(0).numpy()

    drum_logits, dur_logits = sess.run(None, {'image': x})

    drum_probs = 1 / (1 + np.exp(-drum_logits[0]))
    drum_grid  = drum_probs.reshape(N_BEATS, N_DRUMS)
    dur_preds  = dur_logits[0].reshape(N_BEATS, N_DURATIONS).argmax(axis=1)

    notes = []
    for bi in range(N_BEATS):
        drums = [DRUMS[di] for di in range(N_DRUMS) if drum_grid[bi, di] > THRESHOLD]
        if drums:
            notes.append({
                'duration': DURATIONS[dur_preds[bi]],
                'drums':    drums,
            })
    return notes
```

---

## Architecture

- **Backbone:** MobileNetV3-Small, pretrained on ImageNet
- **Shared head:** Linear(576→1024) + Hardswish + Dropout
- **Drum head:** Linear(1024→480) — 32 beat positions × 15 drums, binary per slot
- **Duration head:** Linear(1024→320) — 32 beat positions × 10 duration classes
- **Total parameters:** 2,469,056
- **Training:** Two-phase — backbone frozen (Phase 1, 15 epochs), full fine-tune at LR/10 (Phase 2, 25 epochs)

---

## Drums recognised

15 drum types:

| Category      | Drums                                            |
| ------------- | ------------------------------------------------ |
| Core          | kick, snare, hi_hat_closed                       |
| Hi-hat        | hi_hat_open_half, hi_hat_open_full, hi_hat_pedal |
| Cymbals       | ride, crash, china*, ride_bell, choked_crash*    |
| Toms          | tom_hi, tom_mid, floor_tom_1, floor_tom_2        |
| Articulations | snare_rim, snare_rimshot\*                       |
| Percussion    | cowbell*, clap*                                  |

- To Be added in version 0.2

## Durations recognised

`whole`, `half`, `dotted_quarter`, `quarter`, `dotted_eighth`, `eighth`, `sixteenth`, `thirty_second`, `triplet_eighth`, `triplet_sixteenth`

---

## Performance

Evaluated on 26 held-out songs (~1,924 bars) the model never saw during training.

### Per-drum F1

| Drum             | F1        | Notes                                            |
| ---------------- | --------- | ------------------------------------------------ |
| kick             | **0.929** | Excellent                                        |
| snare            | **0.890** | Excellent                                        |
| hi_hat_closed    | **0.810** | Good                                             |
| hi_hat_open_half | **0.708** | Good                                             |
| hi_hat_open_full | 0.550     | Moderate                                         |
| crash            | 0.532     | Moderate                                         |
| tom_hi           | 0.462     | Moderate                                         |
| snare_rim        | 0.458     | Moderate                                         |
| ride             | 0.431     | Weak — visually similar to crash                 |
| floor_tom_1      | 0.424     | Weak                                             |
| ride_bell        | 0.424     | Weak                                             |
| tom_mid          | 0.264     | Weak                                             |
| hi_hat_pedal     | 0.245     | Weak                                             |
| floor_tom_2      | 0.131     | Very weak — hard to distinguish from floor_tom_1 |
| snare_rimshot    | 0.018     | Too few training examples                        |
| cowbell          | 0.000     | Too few training examples                        |
| clap             | 0.000     | Too few training examples                        |
| choked_crash     | 0.000     | Too few training examples                        |
| china            | 0.000     | Too few training examples                        |

### Duration accuracy

| Metric                    | Value                  |
| ------------------------- | ---------------------- |
| Overall duration accuracy | **90.9%**              |
| triplet_eighth            | 98%                    |
| eighth                    | 94%                    |
| quarter                   | 92%                    |
| sixteenth                 | 87%                    |
| dotted_eighth             | 11% — too few examples |

### Bar-level metrics

| Metric                   | Value |
| ------------------------ | ----- |
| Cell accuracy (per slot) | 97.4% |
| Exact-bar accuracy       | 14.7% |

> Note: exact-bar accuracy requires every single prediction in a 480-slot grid to be correct — it is an extremely strict metric. Cell accuracy and per-drum F1 are more meaningful for practical use.

---

## Training data

- **Source:** Songsterr (Guitar Pro 7 tabs) + local Guitar Pro 5 files
- **Songs:** 264 total — 212 train / 26 val / 26 test (split by song to prevent leakage)
- **Bars:** ~19,948 labelled bar images
- **Labels:** generated programmatically from Guitar Pro MIDI data via `parse_gp7.py` / `parse_gp5.py`
- **Image source:** bar images cropped from Songsterr rendered PDFs

---

## Limitations

- **Rare drums:** cowbell, clap, choked_crash, china have near-zero F1 — not enough training examples. More songs with these drums needed.
- **Tom confusion:** floor_tom_1 vs floor_tom_2 differ only by vertical staff position, which the global average pool architecture handles poorly.
- **Ride vs crash confusion:** both are x-noteheads on high staff lines — the model confuses them at moderate rates.
- **Non-standard notation:** unusual time signatures, grace notes, and multi-voice complexity may degrade accuracy.
- **Overfitting:** train loss (0.205) is lower than val loss (0.492) — adding more diverse songs will close this gap.

---

## Roadmap

- [ ] Add more training songs (target: 500+) to improve rare drums and reduce overfitting
- [ ] Replace global average pool with spatially-aware pooling to better distinguish toms
- [ ] Add rest detection to output silent positions explicitly
- [ ] Wire into Electron + FastAPI for end-to-end drum score reading app

---

## Citation

Work in progress — part of the Drum Hub project.
