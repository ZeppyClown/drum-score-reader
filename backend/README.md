# Local OMR inference service

A small FastAPI process that loads one released OMR bundle (`omr.onnx` +
`omr_config.json`) and reads single bar images. It is the bridge between the Electron app
and the Python model layer. It needs no network access, API key, or PyTorch.

```bash
pip install -r backend/requirements.txt
python3 backend/app.py --bundle ml/data/releases/baseline-14drum-v1 --port 8765
```

The service binds to `127.0.0.1` only. It checks the bundle at startup — config keys,
class counts, `MODEL_SHA256` against the ONNX file, and the model's input/output names and
shape — and exits with `OMR service could not start: ...` instead of failing on the first
request. Electron's main process should start it, poll `GET /health`, and make requests
itself; the renderer does not call it directly.

## Contract

`GET /health`

```json
{"status": "ok", "model_sha256": "59fce5c4...", "drums": ["hi_hat_closed", "..."],
 "durations": ["whole", "..."], "max_upload_bytes": 10485760}
```

`POST /predict` — multipart form with one field, `image`: a PNG or JPEG of one bar.

```json
{"notes": [{"duration": "eighth", "drums": ["kick", "hi_hat_closed"]},
           {"duration": "eighth", "drums": ["hi_hat_closed"]}],
 "model_sha256": "59fce5c4..."}
```

Notes are in left-to-right order. Silent beat positions are omitted, as in the model card's
reference decoder. Every error uses one envelope:

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

## Preprocessing

`omr_bundle.preprocess` reproduces `ml/omr/omr_model.image_transform` without PyTorch:
grayscale, bilinear resize to `IMG_H` x `IMG_W`, three identical channels, and ImageNet
normalization read from the config. A test asserts it matches the training transform on
several image sizes. Phone-photo EXIF orientation is applied before preprocessing.

## Tests

```bash
python3 -m unittest discover -s backend -p 'test_*.py'
```

The tests build a randomly initialized export, so they need the ML dependencies (`torch`,
`torchvision`, `onnx`, `onnxscript`) in addition to `backend/requirements.txt`. They verify
the contract and error handling, not model accuracy.
