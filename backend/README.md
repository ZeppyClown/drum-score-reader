# Local OMR inference service

A small FastAPI process that loads one released OMR bundle (`omr.onnx` +
`omr_config.json`) and reads single bar images. It is the bridge between the Electron app
and the Python model layer. It needs no network access, API key, or PyTorch.

```bash
pip install -r backend/requirements.txt
python3 backend/app.py --bundle ml/data/releases/baseline-14drum-v1 --port 8765
```

The desktop app starts and health-checks this service automatically, reuses it across
imports, and stops it on quit. Run `npm start`, then choose **Import bar image…**.
The initial empty score is filled; later imports append a bar and select it for editing.
Conversion warnings and all-rest predictions are shown for review. The baseline model
reads only 12.5% of held-out bars exactly; expect to correct its output.

Set `OMR_PYTHON` to a Python executable or `OMR_BUNDLE` to an alternate released bundle
directory before `npm start` if needed. Runtime dependencies must be installed first;
shipping a bundled Python runtime is part of future packaging work.

Electron uses `--port 0`: Python binds an available loopback port and emits a JSON record
with `port` and `model_sha256`, then Electron polls health before sending predictions.
The bound socket is handed directly to Uvicorn, avoiding a port reservation race.
The renderer has no HTTP access; its isolated preload exposes only the native import
action, and the main process reads only the file selected by the native picker.
All editor scripts, fonts, and styles are local, so import works without internet access.

The service binds to `127.0.0.1` only. It checks the bundle at startup — config keys,
class counts, `MODEL_SHA256` against the ONNX file, and the model's input/output names and
shape — and exits with `OMR service could not start: ...` instead of failing on the first
request. Electron's main process should start it, poll `GET /health`, and make requests
itself; the renderer does not call it directly.

## Contract

`GET /health`

```json
{"status": "ok", "model_sha256": "59fce5c4...", "drums": ["hi_hat_closed", "..."],
 "durations": ["whole", "..."], "grid_slots": 32, "max_upload_bytes": 10485760}
```

`POST /predict` — multipart form with one field, `image`: a PNG or JPEG of one bar.

```json
{"notes": [{"position": 0, "duration": "eighth", "drums": ["kick", "hi_hat_closed"]},
           {"position": 4, "duration": "eighth", "drums": ["hi_hat_closed"]}],
 "model_sha256": "59fce5c4..."}
```

Notes are in left-to-right order and silent slots are omitted, as in the model card's
reference decoder. `position` is the beat-grid slot where the hit starts (0 to
`N_BEATS - 1`); on the current 32-slot grid it counts 32nd notes from the start of a 4/4
bar. Use it to put rests back: silence is any gap between where one note ends and the next
note's `position`. The reference decoder drops positions, so without them a rest between
two hits would be lost. Every error uses one envelope:

```json
{"error": {"code": "unsupported_file", "message": "The file is not a PNG or JPEG image"}}
```

| HTTP | `code` | When |
| --- | --- | --- |
| 413 | `file_too_large` | Upload is over 10 MB |
| 413 | `image_too_large` | Image is over 40 million pixels |
| 415 | `unsupported_file` | Not a PNG or JPEG (PDF, GIF, text, ...) |
| 422 | `invalid_image` | Empty or corrupt image |
| 422 | `missing_image` | No `image` field in the request |
| 500 | `invalid_model_output` | Inference failed or returned the wrong shape or non-finite values |

## Page import: `POST /segment`

Send one PNG, JPEG or PDF (up to 20 pages, 40 MB) in the multipart field `file`. The
response has every page as a PNG data URL plus suggested bar boxes in that image's pixel
coordinates, in reading order:

```json
{ "barCount": 6, "pages": [{ "page": 1, "width": 1190, "height": 1684, "image": "data:image/png;base64,…",
  "systems": [{ "staffTop": 257.0, "staffBottom": 301.0, "lineSpacing": 11.0, "x0": 68, "x1": 1119,
                "bars": [{ "x": 66, "y": 219, "width": 192, "height": 121 }] }] }] }
```

`page_segment.py` works from pixels (local threshold → five-line staves → barlines that stop
at the staff edges, so drum stems crossing the staff are not mistaken for barlines). Photos
are scaled to at most 3000 px on the long side first. Boxes are suggestions for the user to
review before transcription.

Measured on 2026-09-15 against the vector crop tools with `python3 backend/eval_segment.py`:

| Source | Pages with the exact bar count | Bars found / expected | Bars wrong |
| --- | --- | --- | --- |
| Songsterr PDFs | 528 / 549 (96.2%) | 16,894 / 16,915 | 33 (0.2%) |
| Reflow PDFs | 215 / 308 (69.8%) | 6,807 / 7,019 | 264 (3.8%) |

Reflow's remaining misses are mostly staves whose lines run through dense rows of touching
noteheads. Two attempted fixes (thin-ink line detection, tolerant staff grouping) made both
sources worse and were reverted.

## Preprocessing

`omr_bundle.preprocess` reproduces `ml/omr/omr_model.image_transform` without PyTorch:
grayscale, bilinear resize to `IMG_H` x `IMG_W`, three identical channels, and ImageNet
normalization read from the config. A test asserts it matches the training transform on
several image sizes. Phone-photo EXIF orientation is applied before preprocessing.

## Tests

```bash
python3 -m unittest discover -s backend -p 'test_*.py'
npm run test:service
npm run test:desktop
```

The Python tests build a randomly initialized export, so they need the ML dependencies (`torch`,
`torchvision`, `onnx`, `onnxscript`) in addition to `backend/requirements.txt`. They verify
the contract and error handling, not model accuracy.

The two npm checks use the local released bundle and crop dataset. The desktop check
runs the actual Electron renderer, IPC, and Python inference with external HTTP blocked;
it automates the native picker and checks rendering, editing, append behavior, cancellation,
invalid files, empty predictions, conversion warnings, and invalid output handling.
