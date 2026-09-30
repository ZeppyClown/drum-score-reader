# Local recognition backend

[Back to guide index](README.md)

## Purpose and lifecycle

The backend is a FastAPI service running on the same computer as Electron. It reads cropped bars with ONNX Runtime and segments complete pages. It needs Python and backend dependencies, but inference does not require PyTorch or an API key.

The desktop service manager starts Python, waits for health readiness, reuses the process for requests, and stops it when the app quits. Electron starts it with port 0 so the operating system selects an available loopback port. Python emits a startup record containing the port and model hash, and the bound socket is handed directly to Uvicorn.

The service binds to `127.0.0.1`. The renderer does not call HTTP directly; Electron main handles service requests through the preload actions.

## Model bundle validation

The runtime bundle includes `omr.onnx` and `omr_config.json`. The config supplies image dimensions, normalization, grid size, drum and duration vocabulary, classification threshold, and the expected model hash.

At startup, the loader verifies required settings, class counts, hash, ONNX input/output names, and shapes. A mismatched or incomplete bundle is refused before predictions begin. This avoids running a graph with a vocabulary belonging to a different training run.

## Endpoints

| Endpoint | Input | Output |
| --- | --- | --- |
| `GET /health` | No upload. | Readiness, model hash, vocabulary, grid slots, and upload limit. |
| `POST /predict` | Multipart `image`: one PNG/JPEG bar. | Ordered hit events with position, duration, drums, and model identity. |
| `POST /segment` | Multipart `file`: PNG, JPEG, or PDF. | Rendered page images, staff systems, and suggested bar boxes. |

`/predict` limits uploads to 10 MB and images to 40 million pixels. `/segment` accepts up to 40 MB and 20 PDF pages. It returns image-coordinate boxes so the desktop can crop exactly what the user reviewed.

Prediction positions are onsets, not array indexes in the final editor. A position of 4 on a 32-slot bar grid is half a quarter-note beat after the start. Silent positions are omitted, and the editor converter restores rests from gaps.

## Preprocessing and inference

The loader applies image orientation, converts to grayscale, resizes to the configured dimensions using bilinear interpolation, copies the grayscale data into three channels, and applies ImageNet normalization. The current model uses 128×384 pixels.

Tests compare backend preprocessing against the training transform. This matters because a model can load successfully yet perform badly if deployment uses a different image transform.

ONNX outputs are checked for expected shape and finite values. Drum logits become independent probabilities, allowing simultaneous drums. Duration logits choose a duration class for each active slot. The threshold and output ordering come from the bundle contract.

## Segmentation and errors

Page segmentation uses pixel processing rather than the learned recognition model. It finds staff systems and barlines, with geometry intended to distinguish bar boundaries from drum stems. Suggested boxes still need review. A dense chart can defeat segmentation even when a manually cropped bar would be readable.

Errors use a structured envelope containing a code and message. Examples include `unsupported_file`, `invalid_image`, `file_too_large`, `image_too_large`, `missing_image`, and `invalid_model_output`. The desktop translates failures into actionable user messages.

## Running independently

```sh
pip install -r backend/requirements.txt
python3 backend/app.py --bundle ml/data/releases/baseline-14drum-v1 --port 8765
```

The runtime artifact folder is normally git-ignored. Tracked JSON release records under `ml/releases/` are evidence about the bundle, not a substitute for the model binary.

See [backend README](../../backend/README.md), [app.py](../../backend/app.py), [omr_bundle.py](../../backend/omr_bundle.py), [page_segment.py](../../backend/page_segment.py), and [omr-service.cjs](../../desktop/omr-service.cjs).
