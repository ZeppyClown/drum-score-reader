# Drum Score Reader — Current Project Plan

Updated: 2026-09-11

This is the authoritative project plan. `progress.md` is the dated repository audit that
supports this plan. `model_training.md` and `score_editor.md` are retained only as
historical pointers because they describe an obsolete PaliGemma/Claude workflow.

## Product goal

Build a private, offline desktop app that can:

1. Import a photo, image, or PDF of drum notation.
2. Detect and read each bar with a locally trained model.
3. Render the result as an editable drum score.
4. Play the score back.
5. Export it to useful interchange and print formats.

## Current architecture

| Area | Current choice |
| --- | --- |
| Desktop app | Electron |
| Score rendering and editing | VexFlow 5 |
| OMR model | MobileNetV3-Small |
| Model input | One cropped bar, resized to 128 x 384 |
| Model output | Ordered `{duration, drums}` events |
| Model artifact | ONNX plus `omr_config.json` |
| Initial local inference bridge | Python and ONNX Runtime, exposed to Electron through a local FastAPI process |
| Playback | Web Audio API and local drum samples |
| PDF export | Electron `webContents.printToPDF()` |

PaliGemma and the Claude Vision API are not part of the current implementation plan.
Inference must remain local and must load dimensions, drum names, duration names, and the
classification threshold from `omr_config.json` rather than hardcoding them.

## Verified baseline

The 2026-09-11 audit found:

- Manual VexFlow score entry and editing are present in the Electron app.
- There is currently no image/PDF import UI or inference bridge.
- The ML workspace has 23,819 parsed labels and 19,948 packaged image/label pairs.
- The packaged data contains 264 songs, split by song into 212 train, 26 validation, and
  26 test songs.
- The active model contract is 32 positions x 14 drums (448 drum logits) and 32 positions
  x 10 duration classes (320 duration logits).
- The current local ONNX file is invalid: it is about 284 KB, while this fp32 architecture
  should be roughly 8.8 MB.
- Reproducible current-model evaluation results, `omr_config.json`, and benchmark results
  are absent.
- Data-preparation scripts contain stale paths and do not consistently target
  `ml/data/`.

See `progress.md` for the full audit and count reconciliation.

## Delivery plan

### Workstream 1 — Make data preparation reproducible

Goal: regenerate the packaged dataset from repository-relative inputs without editing
source files between machines.

Tasks:

1. Replace old absolute and incorrect relative paths in the GP5/GP7 parsers, crop scripts,
   spot-check scripts, and `ml/omr/prepare_upload.py`.
2. Add command-line arguments for source and output directories where useful, with
   repository-relative defaults under `ml/data/`.
3. Run the pipeline on a small fixture or subset before processing all data.
4. Reconcile the 3,871 labels that are not represented in the packaged 19,948 pairs and
   document whether they were intentionally filtered or failed to crop/match.
5. Produce a repeatable manifest containing song, source file, bar number, image path,
   label path, and split.

Exit criteria:

- Every packaged image has exactly one label and vice versa.
- Train/validation/test membership is deterministic and split by song.
- A clean run reproduces the documented counts or produces an explained replacement set.
- Spot checks confirm that bar crops and labels align.

### Workstream 2 — Produce a valid model release

Goal: create one internally consistent, evaluated model bundle for the current 14-drum
contract.

Tasks:

1. Remove stale 15/19-drum descriptions and saved outputs from the notebook.
2. Train or resume the 14-drum MobileNetV3 model using the verified dataset.
3. Evaluate on the held-out test-song split.
4. Save `eval_results.json`, including sequence accuracy, exact-bar accuracy, per-drum F1,
   and duration accuracy at hit positions.
5. Export `omr.onnx` and `omr_config.json` together.
6. Verify ONNX/PyTorch numerical parity and reject implausibly small exports.
7. Run `ml/omr/benchmark.py` on the target Mac and save benchmark results.
8. Version the checkpoint, ONNX model, config, evaluation, and benchmark as one release.

Exit criteria:

- ONNX output matches PyTorch within the notebook's stated tolerance.
- Inference on known test bars returns non-empty, plausible note sequences.
- All reported metrics are reproducible from saved artifacts.
- The model bundle contains the ONNX file, config, evaluation results, and benchmark.

No accuracy target is declared yet. Establish a reproducible baseline first, then set a
release threshold based on product testing and error patterns.

### Workstream 3 — Integrate single-bar local inference

Goal: import one bar image and turn it into the app's editable score representation.

Tasks:

1. Add an Electron file picker for PNG/JPEG input.
2. Implement a local Python inference service that loads the released ONNX bundle once.
3. Match preprocessing and decoding to the reference implementation in `ml/README.md`.
4. Define and validate the `/predict` request, response, and error contract.
5. Start, health-check, and stop the local service with the Electron app.
6. Convert ordered model events into one canonical editable bar format.
7. Render the imported bar and allow immediate cursor/keypad editing.
8. Show actionable errors for missing artifacts, service startup failure, unsupported
   files, and invalid model output.

Exit criteria:

- Importing a supported bar image works with networking disabled.
- The imported bar renders and can be edited exactly like a manually entered bar.
- No API key or remote service is required.

### Workstream 4 — Import complete pages and PDFs

Goal: turn a page or PDF into a correctly ordered sequence of editable bars.

Tasks:

1. Render PDF pages to high-resolution images.
2. Detect staff systems and bar lines, then crop bars in reading order.
3. Provide a crop-review screen so users can correct segmentation before inference.
4. Run bar inference with progress and per-bar error reporting.
5. Append successful results in page/system/bar order without discarding recoverable work.

Exit criteria:

- A representative multi-system page produces bars in the correct reading order.
- Users can correct bad crops and retry individual bars.
- Partial failures do not lose successfully imported bars.

### Workstream 5 — Playback

Goal: hear the edited score with synchronized visual feedback.

Tasks:

1. Define tempo, meter, and duration-to-time conversion.
2. Map supported drum names to bundled samples.
3. Add play, pause/stop, tempo, and start-position controls.
4. Highlight the active event during playback.

Exit criteria:

- Timing remains stable across multiple bars.
- Simultaneous drum hits sound together.
- Playback always reflects the latest edits.

### Workstream 6 — Export

Goal: save or exchange the corrected score.

Implement in this order:

1. PDF for visual output.
2. MIDI for playback/interchange.
3. MusicXML after the internal notation model can represent the required semantics.

Each exporter needs fixture-based tests for timing, simultaneous hits, rests, and dotted
or tuplet durations before it is considered complete.

## Cross-cutting work

- Add focused tests around the canonical bar representation, capacity rules, model-output
  conversion, and export timing.
- Add `test`, `lint`, and packaging scripts to `package.json` as their tooling is adopted.
- Keep generated datasets and model weights out of Git; version manifests, configs,
  metrics, and instructions.
- Keep the unrelated untracked `ai-engineer-workshop-2026-project/` out of this project's
  implementation commits.
- Deliver one small vertical slice per commit and verify it before starting the next.

## Immediate next milestone

Complete Workstream 1 before adding UI or inference code. The first implementation slice
should fix the dataset path contract and prove it on a small subset. The next slice should
produce the reconciled manifest. Only then should the model be retrained or exported.

## Plan maintenance

Update this file when architecture, ordering, or scope changes. Record measured counts and
repository-state evidence in a dated progress review rather than silently rewriting the
baseline. Never publish model metrics unless the corresponding model/config/evaluation
bundle can reproduce them.
