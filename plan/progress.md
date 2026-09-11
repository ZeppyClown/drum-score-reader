# Project Progress Review

Reviewed: 2026-09-11

Baseline: `main` at `fe46637` (`origin/main`); this review records the current working-tree state

Scope: the drum-score reader at the repository root and `ml/`; the unrelated untracked
`ai-engineer-workshop-2026-project/` and `songsterr/` directories are excluded.

## Current status

The plan consolidation itself is complete: `plan/README.md` is the authoritative plan,
this file preserves the dated audit, and `model_training.md` and `score_editor.md` are
archived pointers to Git history.

The product is at the manual-editor and model-training stage. Workstream 1 is complete
with a reproducible 23,660-pair replacement dataset and an explicit 159-label exclusion
for the blank `The Trees` source. The remaining five delivery workstreams are incomplete;
image/PDF import, local inference, page segmentation, playback, and export do not exist
in the Electron app.

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
- [x] The regenerated unpacked dataset contains 23,660 images and 23,660 labels.
- [x] The local `ml/data/dataset.zip` contains the same 23,660 pairs and is excluded from
  Git as a generated artifact.
- [x] Image and label stems have zero mismatches in both the unpacked dataset and ZIP.
- [x] The notebook uses a fixed seed (`42`) and a song-level split. The versioned manifest
  reproduces 233 train songs / 19,029 bars, 28 validation songs / 2,088 bars, and 28 test
  songs / 2,543 bars. Stale notebook execution output has been cleared.
- [x] The notebook contains two-phase MobileNetV3 training, evaluation, ONNX export, and
  numerical-verification code.
- [x] `ml/omr/benchmark.py` contains fp32/int8 size, latency, and sequence-agreement
  measurement code.

The data and tooling above complete Workstream 1 and are inputs to Workstream 2. The one
remaining raw-label mismatch is an explicit source exclusion, not an unexplained package
gap. Workstream 2 still has no valid evaluated model bundle.

## Delivery-plan progress

### Workstream 1 — Make data preparation reproducible: complete

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
- [x] Explain every parsed label not represented in the package.
  Regeneration cleared all 3,712 stale-package gaps. `ml/data_reconciliation.csv` now
  contains only the 159 `The Trees` labels excluded because its available PDF has no score
  content. The confirmed James Brown alias produces 79 crops for 79 labels.
- [x] Generate a repeatable manifest with song, source, bar, image, label, and split.
  `ml/dataset_manifest.csv` contains 23,660 rows and reproduces the notebook split exactly:
  233 train songs / 19,029 bars, 28 validation songs / 2,088 bars, and 28 test songs /
  2,543 bars. `ml/data-prep/build_manifest.py` regenerates the manifest, detailed
  reconciliation CSV, and Markdown report.

All five implementation tasks and exit criteria are complete. A clean run produced the
documented replacement set: all 289 usable songs match exactly, every packaged image and
label is paired, the split is deterministic by song, and targeted visual checks cover
ordinary, dense, narrow, wrapped, miniature-rest, and aliased-source bars. `The Trees`
remains explicitly excluded until a non-blank source PDF is available.

### Workstream 2 — Produce a valid model release: not complete

- [x] Remove stale 15-drum/480-output descriptions and the saved 2,469,056-parameter
  Phase 2 output from the notebook. The notebook now consistently documents the current
  14-drum / 448-logit contract, and the obsolete Phase 2 execution output and count are
  cleared so its invalid metrics cannot be mistaken for a current run.
- [ ] Train or verifiably resume the current 14-drum model on the reconciled dataset.
  The obsolete local checkpoint has a 608-output drum head (19 drums), so it cannot
  resume the 448-output model. The replacement split also puts 23 old training songs
  into test and 16 into validation; a fresh training run is required for a clean evaluation.
  Fixed an additional training bug: negative counts for each beat/drum output were
  multiplied by an extra factor of 32, inflating positive weights. Regression tests
  execute the actual notebook assignments and verify balanced, imbalanced, and rare outputs.
  The approved strict subset is packaged: 19,942 included bars and 3,718 exclusions.
  Preparation and the notebook share one strict encoder; the notebook validates content
  hashes and loads the saved split membership before training.
  A local runner now shares the notebook's model and preprocessing. It supports epoch
  checkpoints with optimizer/scheduler/RNG state and rejects resume attempts when the
  code, dataset, model, runtime, or training configuration differs.
  `ml/omr/evaluate.py` now verifies a non-smoke completion marker, checkpoint hash,
  dataset/model provenance, and the unchanged test-song split before computing the
  documented held-out metrics. Its three focused tests pass; no real-run metrics exist yet.
  A two-batch GPU rehearsal completed head-only training, stopped at the epoch boundary,
  resumed its checkpoint in a new process, and completed full-model fine-tuning. Its
  artifacts are explicitly marked as smoke-test artifacts and are not a model release.
  The non-smoke MPS run `baseline-14drum-v1` is now in progress: head epochs 1 and 2 of
  15 have completed. Epoch 2 recorded train loss 0.43042 and validation loss 0.44688;
  epoch 3 is underway. Fine-tuning has not started, and no completion marker or release
  checkpoint has been produced yet.
- [ ] Evaluate the model on the held-out test-song split.
- [ ] Save reproducible `eval_results.json` metrics.
- [ ] Export `omr.onnx` and `omr_config.json` together.
  `ml/omr/export.py` is ready: it refuses smoke, unfinished, or unevaluated runs and never
  overwrites existing artifacts, then writes the ONNX file, config, and
  `export_results.json` together. Seven focused tests pass against a randomly initialized
  model (8.78 MB export, 2,305,056 parameters); no trained model has been exported yet.
- [ ] Verify ONNX/PyTorch numerical parity for the released artifacts.
  The export step enforces a 1e-4 logit tolerance on random probes and 64 held-out test
  bars, plus identical decoded note sequences; it has not yet run on a real checkpoint.
- [ ] Benchmark the released model on the target Mac and save
  `benchmark_results.json`.
  `benchmark_results.json` now records the SHA-256 of the ONNX file it measured.
- [ ] Version the checkpoint, ONNX file, config, evaluation, and benchmark as one release.
  `ml/omr/release.py` is ready: it cross-checks checkpoint, ONNX, config, evaluation,
  export, benchmark, and dataset hashes, then writes weights to the ignored
  `ml/data/releases/<name>/` and JSON evidence to the versioned `ml/releases/<name>/`.
  Eight focused tests pass on stand-in artifacts; no release exists yet.

The historical model artifacts are `Finetuned Model.pt` (10,012,219 bytes) and
`Checkpoints OMR.onnx` (283,541 bytes); the ONNX file is far below the approximately
8.8 MB expected for this fp32 architecture. The current run has only in-progress
checkpoints and history under the ignored `ml/data/training/runs/baseline-14drum-v1/`.
`omr_config.json`, `eval_results.json`, and `benchmark_results.json` are absent, so no
model result is currently shippable or reproducible.

### Workstream 3 — Integrate single-bar local inference: in progress (Python side)

Started early with Victor's approval while training runs; Electron work still waits for a
release. Everything below was verified against a randomly initialized export only, so it
proves the contract and error handling, not recognition quality.

- [ ] PNG/JPEG file picker.
- [x] Long-lived local Python/ONNX inference service.
  `backend/app.py` binds to 127.0.0.1, loads the bundle once, and refuses to start on a
  missing config or model, hash mismatch, or wrong input/output names or shape.
- [x] Shared preprocessing and decoding contract.
  `backend/omr_bundle.py` reads every dimension and name from `omr_config.json`; tests
  show preprocessing matches the training transform exactly and decoding matches the
  reference sigmoid decoder on 25 random logit sets.
- [x] Validated `/predict` and error contract.
  `GET /health` and multipart `POST /predict` return ordered `{duration, drums}` notes;
  errors use one envelope with codes for oversized, unsupported, corrupt, or missing
  images and invalid model output. 15 backend tests pass, and a live run on port 8799
  answered `/health`, a real bar image, a text file (415), and a missing field (422).
- [ ] Electron service lifecycle management.
- [ ] Canonical editable bar representation and model-event conversion.
- [ ] Imported-bar rendering and editing.
- [ ] Actionable import and inference errors.

There is no Electron IPC bridge, service lifecycle management, import UI, or
model-output-to-editor conversion in the repository yet.

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
  Capacity rules are covered: the editing rules moved from `js/input.js` into the pure
  `js/bar.js`, with 15 Node tests (placing, dots, durations, backspace, cursor moves,
  and no mutation of input). A 27-step keyboard/keypad script drove the real Electron app
  before and after the move and produced identical rendered SVG at every step. Model
  conversion and export timing are not covered yet.
- [ ] Add `test`, `lint`, build, and packaging scripts. `npm test` now runs the editor
  rule tests; lint, build, and packaging scripts do not exist yet.
- [x] Keep generated datasets and model weights out of Git. The regenerated local dataset
  and `ml/data/dataset.zip` are ignored; the ZIP is removed from version control without
  deleting the local copy.
- [ ] Save versioned manifests, configs, metrics, and reproducibility instructions. The
  manifest and reconciliation evidence are versioned; model config and metrics await a
  valid training run.

## Immediate next milestone

Workstream 2 is the next milestone. Let the fresh current 14-drum run finish on the
supported 19,942-bar subset, then evaluate it and save the checkpoint, ONNX, config,
evaluation, and benchmark as one reproducible release. `The Trees` can be restored in a
later dataset version when a complete 159-bar PDF becomes available.

The user selected a strict supported subset for the first training release. The complete
23,660-pair crop package is preserved; `ml/omr/prepare_training.py` selects 19,942 bars
without reshuffling songs. `ml/training_report.json` records 15,839 train bars / 232 songs,
1,919 validation bars / 27 songs, and 2,184 test bars / 28 songs.

`ml/training_exclusions.csv` records all 3,718 excluded bars, including all applicable
reasons: 495 outside-grid onsets, 1,324 bars flagged as simile/context-dependent, 500
duplicate-onset bars, 473 measures longer than the grid, 1,287 bars with unsupported
drums, and 815 with unsupported durations. Counts overlap. These exceed the initial
preflight counts because the strict audit checks all hits, even those outside the grid.

Rests still encode silence and ghost dynamics still fold into the base drum. The source
parsers' earlier onset quantization and voice merging are not reversed by filtering.
This is target compatibility, not a claim of lossless original-notation support. Model
metrics must disclose the subset and the 359 excluded bars from the original test split.
Training is in progress on MPS in the ignored `baseline-14drum-v1` run directory; only the
head-phase epoch-1 and epoch-2 metrics are currently available. Do not treat these interim artifacts
as a release until all epochs finish and the completion marker, evaluation, export, and
benchmark checks pass.

## Verification performed for this review

- Built and loaded the strict training ZIP through the actual notebook config, dataset,
  and split cells. All 19,942 image/label content hashes passed, the retained split counts
  matched the versioned report, and four augmented samples had the required 3x128x384
  images, 448 drum targets, and 32 duration targets.
- Added subset tests for whole-bar rejection, simultaneous/ghost hits, rests, duplicate
  onsets, long measures, context-dependent bars, split leakage, deterministic archives,
  and modified-file rejection; the notebook target wrapper is also regression-tested.
- Verified 14 training tests, including model output dimensions, RNG restoration, and
  unchanged backbone parameters/BatchNorm buffers while the prediction heads learn; the
  three evaluation tests also pass.
- Confirmed that PyTorch MPS is available outside the execution sandbox. A 64-bar GPU
  rehearsal took 40.8 seconds for its head-only epoch and 92.8 seconds for the resumed
  fine-tuning epoch, including initial GPU setup/compilation. These are rehearsal times,
  not an estimate of full-dataset throughput or accuracy.
- The initial package had 19,948 pairs across 264 songs (212 train / 26 validation /
  26 test), leaving 3,871 raw labels unpackaged. The replacement adds 3,712 pairs;
  the remaining 159 labels belong to the blank `The Trees` source. Adding songs changes
  the seeded split membership, so earlier checkpoints need a leakage audit before any
  reuse against the replacement test split.
- Compared every delivery-plan task with the current root app and `ml/` source tree.
- Recounted source data, parsed labels, unpacked pairs, and ZIP pairs.
- Compared image and label stems in both packaged forms; each comparison had zero
  mismatches.
- Rechecked stale paths and stale notebook descriptions.
- Updated all remaining notebook shape descriptions from 15 drums / 480 outputs to
  14 drums / 448 outputs, cleared the obsolete Phase 2 output and execution count, and
  validated the edited notebook as JSON.
- Exercised every data-preparation CLI with its repository-relative defaults or explicit
  path overrides.
- Ran a two-song end-to-end subset through both parsers, both crop tools, both spot-check
  tools, and the ZIP packager; the result contained 165 matching image/label pairs.
- Regenerated all usable source songs into 23,660 image/label pairs: Reflow matched
  176/176 labeled PDFs (6,811 pairs), and Songsterr matched 113/114 labeled PDFs
  (16,849 pairs), excluding only the blank `The Trees` source.
- Verified all 23,660 PNGs and parsed all 23,660 JSON labels, confirmed zero stem
  mismatches, and validated a ZIP with 47,320 unique, non-corrupt members.
- Generated the 23,660-row manifest with repository-relative paths and a 159-row
  reconciliation audit; all 3,712 stale-package gaps from the prior package are gone.
- Visually checked representative ordinary, dense-32nd, narrow-ending, wrapped-measure,
  miniature-rest, and aliased-title crops against their JSON labels.
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
- Diagnosed staff-row wrapping of dense sixty-fourth-note measures in Songsterr PDFs,
  joined continuation fragments horizontally into a single ordered bar crop, and added a
  focused image-content regression. Visual inspection confirmed both halves of AC/DC
  bars 180 and 181 are preserved. The full Songsterr audit fixes AC/DC (184/184) and
  `I Wish It Would Rain Down` (86/86) without breaking an existing match.
- Diagnosed miniature final rest bars being discarded by the Songsterr horizontal-line
  width threshold, admitted short segments only when they form five evenly spaced staff
  lines, and added a focused regression. The corpus-wide geometry audit identified and
  fixed exactly five affected songs: `Creeping Death`, `Everlong`,
  `For Whom the Bell Tolls`, `Heart-Shaped Box`, and `Ramble On`. The Songsterr audit now
  has 113 of 114 labeled PDFs matching, with only `The Trees` unresolved.
- Diagnosed `The Trees` as an invalid source export rather than a crop-detector failure.
  Its local PDF is a single blank score page with 24 header/footer words, one unrelated
  drawing path, no embedded images, and no horizontal or vertical score lines. The live
  Songsterr page identifies the correct Neil Peart drum track, but its score canvas also
  remained blank in the available browser. A complete 159-bar PDF export is required
  before this final mismatch can be verified and packaged.
- Checked for model config, evaluation, benchmark, manifest, inference, playback, and
  export artifacts or code.
- Parsed `main.js` with Node and the browser modules with Acorn.
- Confirmed the fresh non-smoke run created `run_config.json`, `provenance.json`,
  `heads_best.pt`, `last.pt`, and `history.json`; `history.json` currently contains head
  epochs 1 and 2 while epoch 3 runs, and no `training_complete.json` exists yet.
- Confirmed the only unrelated untracked paths are `ai-engineer-workshop-2026-project/`
  and `songsterr/`; they remain excluded from all staging.
