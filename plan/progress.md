# Project Progress Review

Reviewed: 2026-09-11

Baseline: `main` at `2be0b0d` (`origin/main`)

Scope: the drum-score reader at the repository root and `ml/`; the unrelated untracked
`ai-engineer-workshop-2026-project/` and `songsterr/` directories are excluded.

## Current status

The plan consolidation itself is complete: `plan/README.md` is the authoritative plan,
this file preserves the dated audit, and `model_training.md` and `score_editor.md` are
archived pointers to Git history.

The product is still at the manual-editor and ML-preparation stage. The repository has a
working VexFlow editing prototype, a paired training dataset, and model-training/export
tooling, but none of the six delivery workstreams meets its exit criteria yet. In
particular, image/PDF import, local inference, page segmentation, playback, and export do
not exist in the Electron app.

## Done or present

### Project planning

- [x] Consolidate the conflicting plans into `plan/README.md`.
- [x] Preserve the progress audit as `plan/progress.md`.
- [x] Archive the obsolete PaliGemma and Claude plans as historical pointers.
- [x] Declare MobileNetV3-Small, ONNX, local inference, and VexFlow as the current
  architecture.

### Manual score editor

- [x] Electron entry point and VexFlow 5 score rendering are present.
- [x] Manual entry supports ten drum-key mappings.
- [x] Cursor navigation, duration changes, dotted notes, rests, and bar-capacity checks
  are present.
- [x] A draggable keypad and configurable two-to-eight bars per line are present.
- [x] The current CommonJS entry point and browser ES modules pass syntax parsing.

These are existing foundations, not completion of Workstream 3: there is no path from a
model response into this editor yet.

### ML data and tooling foundations

- [x] The workspace contains 178 GP5 source files, 179 Reflow PDFs, 314 GP7 files, and
  119 Songsterr PDFs under `ml/data/`.
- [x] `ml/data/labels/` contains 23,819 parsed labels.
- [x] The unpacked packaged dataset contains 19,948 images and 19,948 labels.
- [x] The checked-in `ml/data/dataset.zip` also contains 19,948 images and 19,948 labels.
- [x] Image and label stems have zero mismatches in both the unpacked dataset and ZIP.
- [x] The notebook uses a fixed seed (`42`) and a song-level split. Its saved audit counts
  are 212 train songs / 15,709 bars, 26 validation songs / 2,315 bars, and 26 test songs /
  1,924 bars.
- [x] The notebook contains two-phase MobileNetV3 training, evaluation, ONNX export, and
  numerical-verification code.
- [x] `ml/omr/benchmark.py` contains fp32/int8 size, latency, and sequence-agreement
  measurement code.

The data and tooling above are inputs to Workstreams 1 and 2. Data paths, subset
reproduction, and the manifest audit are now implemented. Workstream 1 still needs its
documented crop/name mismatches resolved and human spot checks; Workstream 2 still has no
valid evaluated model bundle.

## Delivery-plan progress

### Workstream 1 — Make data preparation reproducible: not complete

- [x] Replace stale paths in both parsers, both crop scripts, both spot-check scripts,
  and `ml/omr/prepare_upload.py`.
  All seven tools now derive their defaults from their own locations and consistently use
  `ml/data/`; no machine-specific repository path remains.
- [x] Add command-line source/output arguments with repository-relative defaults.
  The parsers expose `--source-dir`/`--output-dir`, crop tools expose
  `--pdf-dir`/`--label-dir`/`--output-dir`, spot checks expose
  `--image-dir`/`--label-dir`/`--output`, and the packager exposes
  `--dataset-dir`/`--output`.
- [x] Run the repaired pipeline successfully on a small fixture or subset.
  A two-song temporary run parsed and cropped 76 GP5/Reflow bars and 89 GP7/Songsterr
  bars. Both spot-check tools ran headlessly, and the packager produced a ZIP containing
  all 165 images and 165 matching labels.
- [x] Explain the 3,871 parsed labels not represented in the 19,948 packaged pairs.
  `ml/data_reconciliation.csv` accounts for every label. The audit found 1,299 labels in
  8 crop/label-count mismatch songs, 2,555 labels in 18 songs that are ready but were
  never packaged, and 17 missing labels across six otherwise-packaged songs. The only
  previously-unmatched Songsterr title is now covered by an explicit confirmed alias and
  produces 79 crops for 79 labels.
- [x] Generate a repeatable manifest with song, source, bar, image, label, and split.
  `ml/dataset_manifest.csv` contains 19,948 rows and reproduces the notebook split exactly:
  212 train songs / 15,709 bars, 26 validation songs / 2,315 bars, and 26 test songs /
  1,924 bars. `ml/data-prep/build_manifest.py` regenerates the manifest, detailed
  reconciliation CSV, and Markdown report.

All five implementation tasks are complete. The workstream exit criteria remain open
until the 8 crop-count mismatches are resolved, the full package is regenerated, and
human spot checks confirm that crops and labels align.

### Workstream 2 — Produce a valid model release: not complete

- [ ] Remove stale 15-drum/480-output descriptions and the saved 2,469,056-parameter
  Phase 2 output from the notebook.
- [ ] Train or verifiably resume the current 14-drum model on the reconciled dataset.
- [ ] Evaluate the model on the held-out test-song split.
- [ ] Save reproducible `eval_results.json` metrics.
- [ ] Export `omr.onnx` and `omr_config.json` together.
- [ ] Verify ONNX/PyTorch numerical parity for the released artifacts.
- [ ] Benchmark the released model on the target Mac and save
  `benchmark_results.json`.
- [ ] Version the checkpoint, ONNX file, config, evaluation, and benchmark as one release.

The only local model artifacts found are `Finetuned Model.pt` (10,012,219 bytes) and
`Checkpoints OMR.onnx` (283,541 bytes). The ONNX file is far below the approximately
8.8 MB expected for this fp32 architecture. `omr_config.json`, `eval_results.json`, and
`benchmark_results.json` are absent, so no model result is currently shippable or
reproducible.

### Workstream 3 — Integrate single-bar local inference: not started

- [ ] PNG/JPEG file picker.
- [ ] Long-lived local Python/ONNX inference service.
- [ ] Shared preprocessing and decoding contract.
- [ ] Validated `/predict` and error contract.
- [ ] Electron service lifecycle management.
- [ ] Canonical editable bar representation and model-event conversion.
- [ ] Imported-bar rendering and editing.
- [ ] Actionable import and inference errors.

There is no FastAPI service, ONNX Runtime integration, Electron IPC bridge, import UI, or
model-output conversion in the repository.

### Workstream 4 — Import complete pages and PDFs: not started

- [ ] PDF page rendering.
- [ ] Staff-system and bar-line detection for user imports.
- [ ] Crop-review and correction UI.
- [ ] Ordered multi-bar inference with progress and per-bar errors.
- [ ] Partial-failure recovery and retry.

The ML data-preparation crop scripts are offline dataset tools; they are not wired into the
desktop app and do not provide the user-facing import workflow described by this
workstream.

### Workstream 5 — Playback: not started

- [ ] Tempo, meter, and duration-to-time rules.
- [ ] Bundled drum samples and drum-to-sample mapping.
- [ ] Play, pause/stop, tempo, and start-position controls.
- [ ] Active-event highlighting.

No Web Audio implementation or sample assets are present.

### Workstream 6 — Export: not started

- [ ] PDF export.
- [ ] MIDI export.
- [ ] MusicXML export.
- [ ] Fixture-based exporter tests for timing, simultaneous hits, rests, dotted notes,
  and tuplets.

There is no `printToPDF()` call or PDF, MIDI, or MusicXML exporter in the app.

## Cross-cutting work: not complete

- [ ] Add tests for the canonical bar representation, capacity rules, model conversion,
  and export timing.
- [ ] Add `test`, `lint`, build, and packaging scripts. `package.json` currently exposes
  only `npm start`.
- [ ] Keep generated datasets and model weights out of Git. The live `ml/data/`
  directories are ignored, but the 73,311,803-byte `ml/data/dataset.zip` is currently
  tracked and needs an explicit retention/removal decision.
- [ ] Save versioned manifests, configs, metrics, and reproducibility instructions.

## Immediate next milestone

Workstream 1 remains the next milestone. The path contract and small-subset proof are
complete, and every existing label is now accounted for. The next slice must resolve the
8 crop-count mismatches. Then regenerate the full package and perform human crop/label
spot checks before starting model-release work.

## Verification performed for this review

- Compared every delivery-plan task with the current root app and `ml/` source tree.
- Recounted source data, parsed labels, unpacked pairs, and ZIP pairs.
- Compared image and label stems in both packaged forms; each comparison had zero
  mismatches.
- Rechecked stale paths and stale notebook descriptions.
- Exercised every data-preparation CLI with its repository-relative defaults or explicit
  path overrides.
- Ran a two-song end-to-end subset through both parsers, both crop tools, both spot-check
  tools, and the ZIP packager; the result contained 165 matching image/label pairs.
- Generated and validated the 19,948-row dataset manifest and the 3,871-row reconciliation
  audit by rerunning bar detection across all available PDFs.
- Confirmed the James Brown source/PDF title alias and verified its 79 crops match all 79
  labels.
- Diagnosed a fourfold triplet/bracket endpoint being mistaken for a five-line staff
  boundary, raised the Reflow endpoint-support threshold from four to five, and added a
  focused regression test. The full Reflow audit improved from 170 to 174 matching songs
  without breaking an existing match.
- Diagnosed dense 32nd-note beams being mistaken for bar boundaries in
  `Grade 5 fills_counting 32nd notes`, restricted endpoint detection to segment groups
  with five evenly spaced staff lines, and added a regression test based on the failing
  geometry. The song now yields 8 crops for 8 labels, and the full Reflow audit improves
  to 175 of 176 matching songs without breaking an existing match.
- Diagnosed two narrow repeat measures being discarded in
  `Songs_Into the night (YAOSOBI)`, separated the conservative staff-row discovery gate
  from the narrower staff-segment extraction gate, and added regressions for both the
  missing measures and beam-induced row clustering. The song now yields 138 crops for
  138 labels, and all 176 labeled Reflow songs pass the crop-count audit.
- Checked for model config, evaluation, benchmark, manifest, inference, playback, and
  export artifacts or code.
- Parsed `main.js` with Node and the browser modules with Acorn.
- Confirmed `main` and `origin/main` both pointed to `158b007` before this progress-file
  update, with only the two excluded directories untracked.
