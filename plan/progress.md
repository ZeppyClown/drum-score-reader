# Project Progress Review

Reviewed: 2026-09-14 (first written 2026-09-11)

Baseline: `main` at `b332e66`, plus the uncommitted Workstream 3 implementation described
below. Historical verification entries retain their original scope and counts.

Scope: the drum-score reader at the repository root and `ml/`; the unrelated untracked
`ai-engineer-workshop-2026-project/` and `songsterr/` directories are excluded.

## Current status

The plan consolidation itself is complete: `plan/README.md` is the authoritative plan,
this file preserves the dated audit, and `model_training.md` and `score_editor.md` are
archived pointers to Git history.

Workstream 1 is complete with a reproducible 23,660-pair replacement dataset and an
explicit 159-label exclusion for the blank `The Trees` source. Workstream 2 is now complete
too: the first 14-drum run finished on 2026-09-12 and was evaluated, exported, benchmarked,
and bundled as `baseline-14drum-v1` on 2026-09-13. Its held-out sequence accuracy is 12.5%,
which is a reproducible baseline rather than a shippable recognition result. Victor
requested completion of Workstream 3 on 2026-09-14: the Electron app now imports a single
PNG/JPEG bar through the released local model, appends an editable bar, and manages the
Python service lifecycle. The UI discloses baseline accuracy and conversion warnings.
Workstreams 1–3 are complete; page import, playback, and export (4–6) have not started.

On 2026-09-14 the broader DrumHub vision was reconciled with the working score-reader
baseline. `drumhub_master_plan.md` now specifies the score document, deterministic score
analysis, read-only Ask DrumHub agent, practice/exercise/fill functions, teacher view,
evaluation gates, delivery phases, and explicit Claude/ChatGPT/Gemini responsibilities.
No implementation of those new workstreams is claimed here. A provider review also found
that Gemini's current API terms prohibit clients directed to or likely accessed by people
under 18, so Gemini is limited to adult developer evaluation on synthetic/licensed data.

An optional GPT-5.6 Luna path was added on 2026-09-14 without replacing the ML pipeline.
With `OPENAI_API_KEY` set, the user copies a single-bar PNG screenshot and presses Cmd+V
or **Paste screenshot with GPT-5.6 Luna**. The main process sends the PNG at original
image detail to the OpenAI Responses API with a strict 32-slot structured-output schema,
then imports the response as an editable bar and surfaces uncertainty notes. The key is
not exposed to the renderer. This optional route requires internet and an API project with
billing. The project-local `/read-drum-bar` workflow also remains available for interactive
inspection. Transient API failures are retried twice with exponential backoff and jitter.

Verified on 2026-09-14: 53 tests across the editor and OpenAI client (`npm test`), 16 Python service tests
(`backend/`), two released-service integration tests (`npm run test:service`), and the
offline Electron workflow (`npm run test:desktop`), all passing. The previous audit's
33 ML tests (`ml/omr/`) were not rerun for this desktop integration change.

### 2026-09-14 — Master plan Phase 0 item 3 and Phase 1 (tickets 1–3)

Built from `drumhub_master_plan.md` §3.1, §4 A1–A4, §6 Phases 0–1 and §8 tickets 1–3.

- **API key leak check (Phase 0.3):** a new test sends a key through success, 401, 503,
  network and failed-response paths and asserts it never appears in the URL, body, result,
  or any error. It found a real leak — an API error echoing the key was shown verbatim —
  now redacted at the single exit point of `OpenAiOmr.recognize`.
- **Ticket 1 — score document:** `js/score-document.js` adds `schemaVersion`, `scoreId`,
  `revision`, title, tempo, 4/4 meter, per-bar `barId` + provenance (source, reviewed,
  warnings, model) and per-note `eventId`. Existing bars migrate in memory with the note
  format unchanged. Validation rejects bad meter, ids, provenance, notes, broken triplet
  groups and overfilled bars. 14 tests.
- **Ticket 2 — commands and undo/redo:** `js/commands.js` wraps every edit, import,
  review and metadata change; each increments the revision exactly once, cursor moves do
  not, and undo/redo restore the exact score and cursor (revision still moves forward).
  Keyboard, keypad, both import paths and the new title/tempo fields go through it. 13 tests.
- **Ticket 3 — save/load/recovery:** `.drumhub.json` Save / Save As / Open / Open Recent /
  New from a real File menu; atomic temp-file-and-rename writes; conflict prompt when the
  file changed on disk; 1-second autosave to a recovery copy in the app data folder with a
  restore prompt at launch; unsaved-changes prompt on close and quit; newer-format files
  refused without being touched. The page never gets filesystem access. 16 Node tests plus
  a new real-Electron workflow test (`test/desktop-files-smoke.cjs`).
- **Independent review (Codex CLI, read-only, per the plan's reviewer role):** 10 findings.
  Fixed 8: `drums: [undefined]` passed validation; a failing recent-files update could
  re-link Save to a file the editor was not showing; main-process file operations could
  interleave (now one at a time); the folder was not flushed after rename; Save to the
  linked file now requires the same `scoreId`; the page can no longer skip the close
  prompt or delete a recovery copy without the person choosing "Don't Save"; editor
  scores are frozen so an in-place edit cannot hide unsaved changes. Not changed: a
  sub-second window where another app edits the file between the conflict check and
  the rename (no portable compare-and-swap), and non-4/4 meters are still refused rather
  than shown as unsupported (decision 3's 4/4 MVP; the plan text allows display-only).
- Verified: `npm test` 101 passing; `npm run test:desktop` runs both Electron workflows
  and passes. The original desktop test now uses a temporary data folder and asserts
  the quit prompt instead of depending on the real app data folder.
- Not done in this slice: review badges / next-unreviewed UI (ticket 4), score snapshot
  and analysis (tickets 5–7), and every AI ticket (9–12), which Victor writes himself.

## Done or present

### Project planning

- [x] Consolidate the conflicting plans into `plan/README.md`.
- [x] Preserve the progress audit as `plan/progress.md`.
- [x] Archive the obsolete PaliGemma and Claude plans as historical pointers.
- [x] Declare MobileNetV3-Small, ONNX, local inference, and VexFlow as the current
  architecture.

### Manual score editor

- [x] Electron entry point and VexFlow 5 score rendering are present.
- [x] Manual entry covers all 14 model drums (10 keys plus Shift+0/4/6/9) and chords.
- [x] Cursor navigation, duration changes from 32nds to semibreves, dotted notes,
  triplets, rests, and bar-capacity checks are present.
- [x] A draggable keypad and configurable two-to-eight bars per line are present.
- [x] The current CommonJS entry point and browser ES modules pass syntax parsing.

`js/import-ui.js` now calls `js/import.js` through the desktop import workflow and renders
the resulting bar using the same editor state and rules as manual input.

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
gap. Workstream 2's evaluated model bundle is recorded below.

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

### Workstream 2 — Produce a valid model release: complete

- [x] Remove stale 15-drum/480-output descriptions and the saved 2,469,056-parameter
  Phase 2 output from the notebook. The notebook now consistently documents the current
  14-drum / 448-logit contract, and the obsolete Phase 2 execution output and count are
  cleared so its invalid metrics cannot be mistaken for a current run.
- [x] Train or verifiably resume the current 14-drum model on the reconciled dataset.
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
  documented held-out metrics, and reports an unfinished run in plain words rather than a
  missing-file traceback. Its four focused tests passed before the real run below.
  A two-batch GPU rehearsal completed head-only training, stopped at the epoch boundary,
  resumed its checkpoint in a new process, and completed full-model fine-tuning. Its
  artifacts are explicitly marked as smoke-test artifacts and are not a model release.
  The non-smoke MPS run `baseline-14drum-v1` finished on 2026-09-12: all 15 head epochs
  and all 25 fine-tune epochs completed, and `training_complete.json` records
  `finetune_best.pt` (sha256 5f7ef189…) with `smoke: false` and `evaluated_on_test: false`.
  Best validation loss 0.4036 at fine-tune epoch 23; the final epoch recorded train loss
  0.1786 against validation loss 0.4042, so the train/validation gap seen in the earlier
  19-drum run is still present. Validation exact-drum-bar accuracy was 0.074. These are
  validation numbers from training; the later held-out evaluation and release follow below.
- [x] Evaluate the model on the held-out test-song split.
  2,184 bars from 28 songs, split by song, on CPU in about three minutes. Sequence accuracy
  0.125, exact-bar accuracy 0.125, cell accuracy 0.967, duration accuracy at hits 0.897,
  with 1,994 of 2,184 bars predicting at least one note. Kick 0.941, snare 0.879, and
  closed hi-hat 0.874 per-drum F1; toms, ride, ride bell, and open hi-hats all below 0.55
  with heavy false positives (tom_mid 439 false-positive bars against 115 real ones).
  Dotted eighths are read as plain eighths 103 times out of 118.
- [x] Save reproducible `eval_results.json` metrics.
  Records the checkpoint hash, dataset manifest hashes, subset scope, metric definitions,
  torch version, and platform alongside the numbers.
- [x] Export `omr.onnx` and `omr_config.json` together.
  9,230,019 bytes against 9,220,224 expected for 2,305,056 fp32 parameters.
- [x] Verify ONNX/PyTorch numerical parity for the released artifacts.
  The first attempt failed its own gate: max logit difference 6.87e-04 against a fixed
  1e-4 tolerance, and nothing was written. Investigation on 96 real test bars showed logits
  spanning -23.8 to 7.6, a max difference of 9.7e-04 (about 4e-5 of that scale), zero of
  43,008 hit/no-hit decisions changed, and 96 of 96 bars decoding identically — float32
  rounding, which grows with logit magnitude, not a broken export. The check is now scaled
  to the largest logit (1e-4 relative) and additionally refuses any flipped hit decision or
  differently decoded bar. Released parity: 9.73e-04 against 2.41e-03 allowed, 0 flips,
  64/64 bars identical. Note that the closest slot sat 1.3e-04 from the threshold, so a
  borderline slot could in principle flip on another image; such slots are near-coin-flip
  predictions anyway.
- [x] Benchmark the released model on the target Mac and save
  `benchmark_results.json`.
  M1, onnxruntime 1.27, one intra-op thread: fp32 8.80 MB, CPU p50 16.4 ms / p95 39.6 ms,
  CoreML p50 19.9 ms / p95 26.6 ms. int8 is 3.72x smaller but 1.26x slower at p95 and
  decoded a different note list on all 200 sampled bars (5.66% of slots disagreeing), so
  only fp32 is usable. `benchmark_results.json` records the SHA-256 of the ONNX it measured.
- [x] Version the checkpoint, ONNX file, config, evaluation, and benchmark as one release.
  `baseline-14drum-v1`: weights and JSON in the ignored `ml/data/releases/baseline-14drum-v1/`,
  and the JSON evidence plus `release_manifest.json` (per-file SHA-256 and size) versioned in
  `ml/releases/baseline-14drum-v1/`.

The historical artifacts `Finetuned Model.pt` (10,012,219 bytes) and `Checkpoints OMR.onnx`
(283,541 bytes) are superseded; the latter is far below the approximately 8.8 MB expected
for this fp32 architecture and `export.py` would now reject it on size. Every current
result is reproducible from `ml/releases/baseline-14drum-v1/`, and the exit criteria hold:
ONNX matches PyTorch within the documented tolerance with no decision or decoding
differences, inference on real test bars returns non-empty plausible sequences, and the
bundle contains the ONNX file, config, evaluation, and benchmark.

The open question is quality, not process: 12.5% of held-out bars are read exactly right.
No release threshold was ever declared, and the plan says to set one from measured error
patterns — that decision is now due.

### Workstream 3 — Integrate single-bar local inference: complete

Completed on 2026-09-14 at Victor's request using `baseline-14drum-v1`. Python contract
tests use a random export; desktop and lifecycle integration checks use the real release.

- [x] PNG/JPEG file picker via an isolated preload and main-process IPC handler.
  Only the native picker's selected path is read. Cancellation leaves the score unchanged.
- [x] Long-lived local Python/ONNX inference service.
  `backend/app.py` binds to 127.0.0.1, loads the bundle once, and refuses to start on a
  missing config or model, hash mismatch, or wrong input/output names or shape.
- [x] Shared preprocessing and decoding contract.
  `backend/omr_bundle.py` reads every dimension and name from `omr_config.json`; tests
  show preprocessing matches the training transform exactly and decoding matches the
  reference sigmoid decoder on 25 random logit sets.
- [x] Validated `/predict` and error contract.
  `GET /health` and multipart `POST /predict` return ordered `{position, duration, drums}`
  notes (position is the 32nd-note slot, so rests between hits survive import);
  errors use one envelope with codes for oversized, unsupported, corrupt, or missing
  images and invalid model output. 16 backend tests pass, and a live run on port 8799
  answered `/health`, a real bar image, a text file (415), and a missing field (422).
- [x] Electron service lifecycle management.
  Start at app launch, discover the child-bound ephemeral loopback port, poll health,
  reuse the loaded model, retry after failure, and terminate on app quit with a bounded
  graceful-shutdown period. Missing Python, dependencies, and bundle errors are actionable.
- [x] Canonical editable bar representation and model-event conversion.
  The editor note (`{duration, dotted, drums, triplet?}`) now holds every model output:
  chords, all 14 drums, 32nds, and triplets. `js/import.js` turns `/predict` notes into a
  full 4/4 bar: timing from `position`, written durations kept when they fit and
  shortened when they overlap, gaps filled with rests, and triplet hits grouped into
  the nearest slot of their beat. Every adjustment returns a plain-English warning, and
  malformed output throws a clear error. Connected to the service and UI, using the
  model's configured grid size from health metadata.
- [x] Imported-bar rendering and editing.
  Fill the initial empty score or append after existing bars, select the imported bar,
  and render it with VexFlow. Keyboard and keypad edits use the existing bar rules.
- [x] Actionable import and inference errors.
  Show failures without changing existing bars; display timing adjustments and a clear
  message for all-rest predictions. The UI reports the baseline's 12.5% exact-bar accuracy.

External CDN dependencies were replaced by local CSS. The desktop smoke check blocks
external HTTP and exercises real model import, SVG rendering, keyboard/keypad correction,
append preservation, cancellation, unsupported files, empty predictions, malformed model
events, and conversion warnings. Service checks cover process reuse, crash recovery,
startup timeout, missing artifacts/Python, and shutdown. No API key is needed.

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
  conversion is covered too: 14 tests for `js/import.js` (grooves, rests from gaps,
  shortened overlaps, dotted notes, triplet grouping and merges, validation errors) and a
  check that its duration names match `training_contract.py`. Export timing is not covered.
  The note model now matches the OMR model's vocabulary (Victor's 2026-09-11 decisions):
  a note stores `drums`, a list of model drum names, so one note can be a chord and an
  empty list is a rest. All 14 model drums are in the editor — the 4 new ones via
  Shift+0/4/6/9 — and pressing a drum toggles it in the chord. 23 Node tests pass,
  including a check that the editor's drum list matches `training_contract.py`. A
  19-step keyboard/Shift/keypad script in the real app produced the expected drums and
  notehead count at every step on two consecutive runs; an earlier run's extra drum
  came from a manual keypad click during the automated run, not from the editor.
  Stems now follow each note: VexFlow 5 ignored the old `stem_direction` option, so
  snare stems pointed down and kick/floor-tom stems up; a real-app check confirms
  hands stem up and feet/floor toms stem down after the fix.
  32nd notes and triplets are in: ticks moved to 48 per quarter (192 per bar) so every
  supported note is a whole number, `-` reaches 32nds, and `T` turns a note of length d
  into a triplet group spanning 2×d (or splits a group back into two notes). Triplet
  notes cannot be dotted, resized, or have their rests deleted, and 32nds cannot be
  dotted. 32 Node tests pass, and a 20-step real-app script confirmed triplet creation,
  splitting, every refusal, 32nds, and the dotted 16th with no page errors.
- [ ] Add `test`, `lint`, build, and packaging scripts. `npm test` now runs the editor
  rule tests; lint, build, and packaging scripts do not exist yet.
- [x] Keep generated datasets and model weights out of Git. The regenerated local dataset
  and `ml/data/dataset.zip` are ignored; the ZIP is removed from version control without
  deleting the local copy.
- [x] Save versioned manifests, configs, metrics, and reproducibility instructions. The
  manifest, reconciliation evidence, model config, metrics, and release manifest are
  versioned; runtime setup and integration verification are in `backend/README.md`.

## Immediate next milestone

Workstreams 1–3 are done. The next delivery workstream is complete-page/PDF import,
starting with page rendering and crop review. Accuracy improvement remains valuable:
tune per-drum thresholds on validation data to measure whether false positives fall
without unacceptable recall loss. Changing training weights would require retraining.
`The Trees` can be restored in a later dataset version when a complete 159-bar PDF is
available. Single-bar imports currently use the released baseline and require correction.

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
Training finished on 2026-09-12 in the ignored `baseline-14drum-v1` run directory, with a
non-smoke completion marker. Evaluation, export, benchmark, and release-bundle checks
passed on 2026-09-13. Report only held-out test metrics, and
disclose the supported-subset scope and the 359 excluded bars from the original test split.

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
- Confirmed the finished non-smoke run's artifacts and its 40 recorded epochs (15 head,
  25 fine-tune), and that `training_complete.json` names `finetune_best.pt` with
  `smoke: false` and `evaluated_on_test: false`.
- Re-ran all three suites for this review: 46 Node, 16 service, and 35 ML tests pass
  (two new export tests cover the scaled parity tolerance and a flipped hit decision).
- Ran the full release sequence on 2026-09-13: evaluate, export, benchmark, release.
  Investigated the export's parity failure on 96 real test bars before changing its
  tolerance, and confirmed the released artifacts cross-check against each other.
- Confirmed the only unrelated untracked paths are `ai-engineer-workshop-2026-project/`
  and `songsterr/`; they remain excluded from all staging.
