# DrumHub — Interview Brief (technical)

A drum-score app for young drummers (8–16) and their teachers: an Electron/VexFlow score editor,
a trained OMR model (MobileNetV3-Small → ONNX) behind a local FastAPI service, an optional cloud
recogniser, and a tool-calling LLM agent whose every answer is validated by code.

Numbers come from saved reports in this repository (`ml/releases/baseline-14drum-v1/`,
`eval/recognition/reports/`, `eval/score-agent/reports/`, dated 2026-09-12 to 2026-09-15).
Implementation details were checked against the source on 2026-10-02; file paths are given so
each claim can be opened.

---

## 0. The 5-minute version

**Minute 1 — Problem and shape.**
Drum students get music as PDFs, photos and screenshots; teachers retype it by hand. DrumHub is
three processes: a sandboxed Electron renderer (plain ES modules, VexFlow 5), an Electron main
process that owns files, keys and network, and a Python child process serving my ONNX model on
`127.0.0.1`.

**Minute 2 — Recognition.**
Page → bars with classical CV (adaptive threshold, morphological opening, staff and barline
geometry). Bar → notes with a 2.3M-parameter MobileNetV3-Small that predicts a 32-slot × 14-drum
multi-label grid plus a 32-slot × 10-class duration grid. Alternative path: a cloud model with a
strict JSON schema. Both produce the same `{position, duration, drums}` contract, and every
imported bar carries provenance and starts `reviewed: false`.

**Minute 3 — Evals.**
One harness scores every recogniser the same way: exact bars, onset F1, (slot, drum) F1,
duration accuracy. Local model: 16.8% exact, onset F1 85.0 on 1,548 held-out Songsterr bars, 15 ms
per bar. GPT-5.6 Luna at high reasoning: 51.1% exact, onset F1 97.7 on 45 synthetic bars, 89 s per
bar. Each fails on the other's distribution (local 0% on DrumHub renders; Luna 3.3% on Songsterr).

**Minute 4 — The agent.**
Ask DrumHub is a Responses-API tool loop. The model never receives the notes; it calls 8
read-only tools that run deterministic analysis over a hashed snapshot. Output is strict JSON,
then checked by code (references in range, drums grounded in tool output, unsupported-claim and
child-safety filters), with one repair round and a deterministic offline fallback.

**Minute 5 — Reliability and lessons.**
Immutable command-based editor with monotonic revisions, atomic saves with fault-injection tests,
hash-pinned model releases, 289 Node tests plus 7 real-Electron workflow tests. Biggest lesson:
a benchmark leaked its answers to an agentic model (82% reported, 40% real), so every
file-reading recogniser now runs in an empty directory.

---

## 1. Architecture

```
┌──────────────────────┐  IPC (contextBridge)  ┌───────────────────────┐  HTTP 127.0.0.1  ┌──────────────────────┐
│ Renderer (sandboxed) │ ────────────────────▶ │ Electron main (Node)  │ ───────────────▶ │ Python child process │
│ ES modules, VexFlow  │ ◀──────────────────── │ files, key, budget,   │ ◀─────────────── │ FastAPI + ONNX RT    │
│ Web Audio            │                       │ SQLite, import jobs   │                  │ OpenCV, PyMuPDF      │
└──────────────────────┘                       └───────────┬───────────┘                  └──────────────────────┘
                                                           │ HTTPS, opt-in
                                                           ▼
                                                 OpenAI Responses API
```

Diagram of the recognition path: `docs/interview-system-design.svg`.

| Layer | Technology | Responsibility |
|---|---|---|
| Renderer | Electron renderer, native ES modules (no bundler, no TypeScript), VexFlow 5 as a script-tag global, Tailwind/Flowbite | Notation drawing, editing, panels, Web Audio playback |
| Main | Electron main, CommonJS (`desktop/*.cjs`) | Disk access, OpenAI calls, page-import jobs, `node:sqlite` practice store, spending limit |
| Recognition service | Python, FastAPI/Uvicorn, ONNX Runtime (CPU provider), OpenCV, PyMuPDF | `/predict` (model), `/segment` (bar detection), `/health` |
| Cloud (optional) | OpenAI Responses API | Screenshot transcription, typed questions, fill generation, summary drafts |

### Process isolation (`main.js`, `preload.js`)

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The renderer has no Node
  or filesystem access.
- `preload.js` exposes six narrow objects through `contextBridge`: `omr`, `scoreFiles`, `agent`,
  `pages`, `practice`, `fills`. Each method is one `ipcRenderer.invoke` on a fixed channel name.
- Every handler calls `trustedSender(event)`: the sender must be the main frame and its URL must
  equal the `file://` URL of `index.html`.
- `setWindowOpenHandler` denies new windows and `will-navigate` is prevented.
- The API key is read in main only (`.env` or environment) and redacted from every error string.

### Python service lifecycle (`desktop/omr-service.cjs`, `backend/app.py`)

- Main spawns `python3 -u backend/app.py --bundle <release> --port 0`. Port 0 lets the OS pick a
  free port; the service binds the socket itself and prints one JSON line
  `{port, model_sha256}` to stdout.
- Main then polls `GET /health` every 100 ms (30 s startup limit) and accepts the service only
  when the reported `model_sha256` matches the readiness line.
- Every `/predict` reply carries `model_sha256`; main rejects a reply whose hash differs.
- Limits: 10 MB per bar image, 40 MB per page file, 40 million pixels, 30 s per prediction,
  180 s per segmentation. Shutdown is `SIGTERM`, then `SIGKILL` after 2 s.
- Errors use one envelope, `{error: {code, message}}`, with 413/415/422/500 status codes.
  OpenAPI and docs routes are disabled.
- In a packaged app the Python files are unpacked from `app.asar` and the model ships as a
  bundled resource.

---

## 2. The score document and editor core

### Data model (`js/score-document.js`)

```
document = { schemaVersion: 1, scoreId, revision, title, tempoBpm, meter, bars }
bar      = { barId, provenance: { source, reviewed, warnings, model? }, notes }
note     = { eventId, duration, dotted, triplet?, drums }
```

- Time is integer ticks: 48 per quarter note, 192 per 4/4 bar. Seconds are derived from ticks
  only at playback, so nothing drifts.
- `scoreId`, `barId` and `eventId` are UUID v4 and survive edits, so saved files, undo history
  and agent citations all point at the same objects.
- `provenance.source` is `manual`, `local_omr` or `openai_omr`. Imported bars start
  `reviewed: false`; only an explicit user action flips it.
- Validation limits: 2,000 bars, tempo 20–300 BPM, 200-character title, 20 MB file. Any valid
  meter loads; only 4/4 is editable and analysed.
- The same validation module runs in the renderer and in main (file load), so a hand-edited
  file cannot bypass the editor's rules.

### Commands, immutability and revisions (`js/commands.js`, `js/editor-store.js`)

- Every change is a pure command `{label, run(editor)}` that returns the changed parts or `null`.
- Editor state is deep-frozen. Edits create new objects and share the unchanged ones, so
  "unsaved changes" is a reference comparison (`editor.bars !== editor.saved.bars`).
- Undo/redo keeps up to 200 entries. **Revision numbers only increase**, including on undo and
  redo. An analysis or AI answer computed for revision 7 can never attach to different content
  that later reaches revision 7.
- `commit()` stores the new editor, renders, then notifies listeners. If rendering throws, the
  previous editor is restored and re-rendered.

### Durable saves (`desktop/score-files.cjs`)

- `writeAtomic`: open a temp file in the same folder with `wx`, write, `fsync`, optionally
  compare the target's SHA-256 to `expectedHash` (raises `ConflictError` if another process
  changed it), `rename`, then `fsync` the directory.
- A `fault(step)` hook lets tests throw at `write`, `sync`, `check` and `rename` to prove a crash
  leaves either the old file or the new one.
- Autosave and crash-recovery copies live under the app's user-data folder.

---

## 3. Recognition

### 3.1 Import paths

| Path | Recogniser | Network | Latency | Bars per call |
|---|---|---|---|---|
| Import bar image | Local ONNX model | none | 16 ms p50, 40 ms p95 (M1 CPU, 1 thread) | 1 |
| Paste screenshot | OpenAI, default `gpt-5.6-sol`, reasoning `high` | yes, opt-in | minutes | up to 64 |
| Import page or PDF | Either, per box | only for cloud | as above | up to 20 pages |

Both recognisers return the same contract, validated before it reaches the editor:

```json
{ "position": 8, "duration": "eighth", "drums": ["kick", "hi_hat_closed"] }
```

`position` is a 32nd-note slot, 0–31. `js/import.js` multiplies by 6 ticks, inserts rests in the
gaps, regroups triplets from the start of their beat, pads to 192 ticks and turns anything the
editor cannot hold into a warning string.

### 3.2 Bar detection (`backend/page_segment.py`)

Pure pixel geometry, so it works on screenshots, photos and rendered PDFs alike.

1. **Ink mask.** `cv2.adaptiveThreshold`, mean method, block 31, C 12. A global Otsu cut-off
   (140–166 on these pages) drops the light-grey staff lines (levels 118–208) that Songsterr and
   Reflow draw.
2. **Staff lines.** Morphological opening with a `(width/30) × 1` kernel, then rows with ink over
   at least 8% of the page width. A band thicker than 4 rows is a solid block, not a line.
3. **Staves.** Five consecutive lines with spacing 4–60 px whose gaps differ by at most
   `max(2 px, 25% of the mean gap)` and whose width exceeds 8 staff spaces.
4. **Barlines.** Vertical opening with a kernel 90% of the staff height, columns with at least
   90% coverage, stroke width at most `max(4 px, 0.8 space)`, and a **clean-end test**: the strips
   just above the top line and just below the bottom line must be under 35% ink. Drum stems cross
   the whole staff too, but they continue past it and fail this test.
5. **Merging.** Strokes within 3.5 staff spaces are one boundary (double and final barlines, time
   signature digits after a barline).
6. **Boxes.** Bars at least 4 spaces wide, cropped 3.5 spaces above and below the staff (capped
   at the midpoint to the neighbouring staff) so cymbals and kicks are kept.

PDFs are rasterised with PyMuPDF at 2× zoom (144 dpi); pages are scaled so the long side is at
most 3,000 px. Detection is a suggestion: the user edits the boxes before anything is read.

| Source | Pages exactly right | Bars wrong |
|---|---|---|
| Songsterr | 528 / 549 (96%) | 33 of 16,915 (0.2%) |
| Reflow (local evaluation only) | 215 / 308 (70%) | 264 of 7,019 (3.8%) |

### 3.3 Page-import jobs (`desktop/page-import.cjs`)

- One folder per job: `job.json` plus `page-<n>.png`, written atomically after every result.
- Each result is keyed by `page:x,y,width,height:recogniser`. Moving a box or switching
  recogniser makes the old result stale, so only that box is read again.
- A failed box never loses the others and can be retried alone. An unfinished job is offered for
  resume on the next launch. Cloud boxes run 2 at a time.

### 3.4 The local model (`ml/omr/`)

**Architecture (`omr_model.py`)**

```
1 × 3 × 128 × 384 (grayscale repeated to 3 channels, ImageNet mean/std)
  → MobileNetV3-Small features (ImageNet weights)
  → global average pool → 576
  → Linear(576 → 1024) + Hardswish + Dropout
  ├─ drum head     Linear(1024 → 448) = 32 slots × 14 drums   (sigmoid, multi-label)
  └─ duration head Linear(1024 → 320) = 32 slots × 10 classes (softmax per slot)
```

2,305,056 parameters; 8.80 MB as fp32 ONNX.

**Target encoding (`training_contract.py`)**

- `BEAT_GRID` is 32 positions, `1 + i × 0.125` beats. The drum target is a 32 × 14 binary grid;
  the duration target is one class per slot.
- The contract is strict: a bar is excluded, never repaired, if it has an unsupported drum or
  duration, an off-grid or duplicate onset, a measure longer than the grid, a flam, or a simile
  mark. Ghost dynamics fold into the base drum.
- This filter turned 23,660 pairs into 19,942 (3,718 excluded, each with a recorded reason).

**Loss and optimisation (`train.py`)**

- `loss = BCEWithLogits(drum_logits, pos_weight) + 0.5 × CrossEntropy(duration_logits)`.
- `pos_weight` per output is `negatives / positives`, clamped to 50.
- The duration loss is **masked to slots that contain a hit**, so empty slots do not teach the
  duration head anything.
- AdamW, weight decay 1e-4, batch 32, cosine annealing within each phase.
- Phase 1: 15 epochs, backbone frozen, lr 3e-4. BatchNorm running statistics are frozen as well
  as the weights. Phase 2: 25 epochs, whole model, lr 3e-5, starting from the best heads.
- Checkpoint kept on best validation loss. Every epoch saves optimiser, scheduler and RNG state;
  `--resume` rejects any code, dataset or hyperparameter mismatch.
- Augmentation: rotation ±2°, vertical shift up to 4%, brightness and contrast jitter 0.4,
  Gaussian blur σ 0.1–1.5. No horizontal shift, because horizontal position is the timing.
- Trained on an M1 Mac (MPS). Final train loss 0.179, validation 0.404.

**Data**

- 289 songs (my Reflow charts as Guitar Pro 5, Songsterr as Guitar Pro 7). Labels are parsed
  from the tab files with PyGuitarPro; images are bars cropped from the rendered PDFs.
- Split **by song**: 15,839 bars / 232 songs train, 1,919 / 27 validation, 2,184 / 28 test.
  A bar-level split would leak near-duplicate bars across the boundary.
- `dataset_manifest.csv` records each pair's song, source file, bar number and split;
  `training_manifest.csv` adds SHA-256 hashes of every image and label.

**Inference (`backend/omr_bundle.py`)**

- Preprocessing is re-implemented in NumPy/Pillow (bilinear resize, scale, normalise), so the
  service does not need PyTorch.
- All dimensions, class names, tensor names and the threshold are read from `omr_config.json`.
  Startup fails if `omr.onnx` does not hash to `MODEL_SHA256` or if the ONNX input/output
  signature disagrees with the config.
- Decoding thresholds in logit space, `x > log(t / (1 − t))`, which avoids overflow in the
  sigmoid. Output is checked for shape and finiteness.

**Release gates (`export.py`, `release.py`)**

- Export verifies the ONNX file against PyTorch on random probes and 64 held-out bars: logits
  within 1e-4 relative to the largest logit, no slot crossing the threshold, identical decoded
  note sequences, and a file size consistent with the parameter count.
- `release.py` refuses to bundle unless the completion marker, evaluation, export, config and
  benchmark all name the same checkpoint hash, ONNX hash and dataset.

**Held-out test results (2,184 bars, 28 songs)**

| Metric | Value |
|---|---|
| Kick / snare / closed hi-hat F1 | 0.941 / 0.879 / 0.874 |
| Crash / ride F1 | 0.696 / 0.539 |
| Toms F1 | 0.208–0.388 |
| Open hi-hat (full) F1 | 0.105 |
| Cell accuracy (448 cells) | 96.7% |
| Duration accuracy at hits | 89.7% |
| Exact bar / exact sequence | 12.5% |

Error analysis:

- **Precision, not recall, is the problem.** `tom_hi` is found in 56 of 73 bars that contain it
  but also claimed in 409 that do not. The clamped `pos_weight` buys recall on rare classes at
  the cost of false positives. Cheapest next experiment: per-drum thresholds tuned on validation.
- **Global average pooling discards vertical position**, which is the only thing separating
  `tom_hi`/`tom_mid` and `floor_tom_1`/`floor_tom_2`.
- **Cell accuracy is misleading**: most of the 448 cells are empty, so 96.7% says little.
- Dotted eighths are read as plain eighths 103 times out of 118.

**Quantisation (`benchmark.py`)**

| Build | Size | CPU p50 | CPU p95 |
|---|---|---|---|
| fp32 | 8.80 MB | 16.4 ms | 39.6 ms |
| int8 | 2.37 MB | 42.5 ms | 50.0 ms |

int8 is smaller but slower and decoded a different note sequence on 200 of 200 bars, so fp32
ships. Agreement is measured on decoded sequences because per-cell agreement is dominated by
empty cells.

### 3.5 The cloud recogniser (`desktop/openai-omr.cjs`, `desktop/openai-client.cjs`)

- Responses API with `text.format = json_schema`, `strict: true`. Schema version 2:
  `{schemaVersion, gridSlots: 32, status: ok | needs_crop, message, bars: [{notes, uncertainties}]}`
  with `position` bounded 0–31 and enums for the 14 drums and 10 durations.
- `reasoning.effort: high`, `max_output_tokens: 100000`, 10-minute timeout. Reasoning tokens
  count against the output limit, so a truncated reply is retried once at `medium`.
- The prompt defines the 32-slot grid, DrumHub's notehead-to-drum mapping, and states that text
  printed in the image is data, not instructions.
- After the schema, code validates again: version, grid size, at most 64 bars; model-written
  text is stripped of hidden characters and length-capped (20 uncertainties, 200 characters).
- Shared client: `store: false` on every request, 3 attempts on temporary errors, key redaction.

**Spending limit (`desktop/cloud-budget.cjs`)**

- One monthly limit for all cloud features (default US$5) and a sliding window of 20 requests
  per minute. `check()` runs before a request, `record()` after, using the reply's token usage.
- Prices per million tokens: Luna 0.2 input / 1.2 output; Sol 4 / 20. Unknown models are charged
  at the highest listed price.

### 3.6 Recognition benchmark (`eval/recognition/`)

**Sets.** 45 synthetic one-bar images rendered by DrumHub from its own catalogue (exact truth,
safe for any provider); 1,548 held-out Songsterr bars from the training test split. Reflow charts
are never sent anywhere because file names identify students.

**Metrics (`truth.mjs`).**

| Metric | Definition |
|---|---|
| Exact bars | Same onset set, same drums at each onset, same duration at each onset |
| Onset F1 | Precision/recall over occupied slot positions |
| Drum-hit F1 | Precision/recall over `(slot, drum)` pairs |
| Durations | Share of matched onsets with the correct duration class |
| Errors | The recogniser returned no bars (for example `needs_crop`) |

| Recogniser | Set | Exact | Onset F1 | Drum F1 | Durations | Errors | Median time | Cost |
|---|---|---|---|---|---|---|---|---|
| Local `baseline-14drum-v1` | synthetic (45) | 0% | 67.9 | 22.2 | 83.1% | 0 | 30 ms | free |
| Luna, high | synthetic (45) | **51.1%** | **97.7** | **84.3** | 97.3% | 1 | 89 s | US$0.43 |
| Luna, medium | synthetic (45) | 28.9% | 87.6 | 70.8 | 86.6% | 6 | 34 s | US$0.15 |
| Luna, low | synthetic (45) | 13.3% | 78.9 | 61.8 | 70.8% | 12 | 20 s | US$0.07 |
| Gemini 3.6 Flash (dev only) | synthetic (45) | 40.0% | 98.8 | 82.6 | 97.8% | 0 | 45 s | — |
| Local | Songsterr held-out (1,548) | 16.8% | 85.0 | 54.1 | 92.2% | 0 | 15 ms | free |
| Local | Songsterr, first 30 | 10.0% | 85.1 | 49.5 | 91.0% | 0 | 15 ms | free |
| Luna, high | Songsterr, first 30 | 3.3% | 86.6 | 30.4 | 80.6% | 9 | 144 s | US$0.32 |

Runs are resumable (`.progress-<set>-<provider>.jsonl`) and each report stores the commit, set
hash, model and settings.

**Findings**

1. **Reasoning effort is the accuracy lever.** Low is about 4× faster than high and gets a
   quarter as many bars exactly right, with 12 of 45 refused.
2. **Notation convention beats model size.** The prompt describes DrumHub's drum positions;
   Songsterr places drums differently, so drum F1 falls from 84 to 30 while onset F1 holds at 87.
   Fix: a per-publisher drum key or reading the legend, then rerun.
3. **Domain gap in my model.** Trained only on Reflow and Songsterr renders, it scores 0% exact
   on DrumHub's own rendering.
4. **Benchmark hygiene.** Gemini ran through an agent CLI with file access in the project
   folder, where the truth manifest and descriptive image names live: 82% reported. Each image is
   now copied alone as `bar.png` into an empty working directory: 40%.

**Known gap.** The benchmark's cloud rows were measured on `gpt-5.6-luna`. The app's screenshot
default is `gpt-5.6-sol` (`DEFAULT_OMR_MODEL`), which has no benchmark row yet.

---

## 4. Insights: deterministic analysis (`js/score-snapshot.js`, `js/score-analysis.js`)

No model and no network. The same functions back the Insights panel, the agent's tools and the
offline answers.

**Snapshot.** Up to 64 bars as timing facts per event: `onsetTicks`, `durationTicks`,
`writtenDuration`, `dotted`, `triplet`, sorted `drums`, `isRest`; plus `scoreId`, `revision`,
per-bar `reviewed`/`source`, and a SHA-256 over the canonical JSON. It deliberately excludes the
title and import warning text, which may contain text copied from an image. Main re-validates the
snapshot and its hash before any model call.

**Notation complexity, 0–100 per bar.** Weighted sum of six signals, each in [0, 1]:

| Signal | Weight | Formula |
|---|---|---|
| Subdivision density | 0.30 | mean of `min(1, hits / 16)` and a level for the shortest note (32nd = 1.0, 16th = 0.75, 8th = 0.4) |
| Coordination | 0.25 | share of hits where kick or hi-hat pedal sounds with another drum |
| Syncopation | 0.15 | share of hits not on the beat or the "&" |
| Rhythm changes | 0.15 | `min(1, (distinct durations − 1) / 3 + 0.34 if triplets)` |
| Drum movement | 0.10 | mean of `min(1, (distinct drums − 1) / 5)` and the share of consecutive hits that change drums |
| Tempo | 0.05 | `clamp((bpm − 60) / 140)` |

The top 3 bars are merged into passages when adjacent, and each carries the raw signals and
generated reasons. It measures notation, never "hard for you".

**Repeats.** A bar is the set of `onset:drum` pairs. Exact repeats are identical sets; near
repeats have Jaccard similarity ≥ 0.75. Comparison is between one representative per exact group,
so a groove repeated ten times does not produce 45 pairs.

**Possible fills.** Each bar against the bars within ±2:
`0.35 × novelty + 0.25 × tomShare + 0.20 × crashOnNextDownbeat + 0.10 × timekeepingDrop + 0.10 × densityRise`,
where novelty is `1 − max similarity to a neighbour`. Score ≥ 0.5 is a candidate, labelled as a
candidate.

**Staleness.** Cards store the revision they were computed for. After any edit they are marked
out of date and their buttons refuse until refreshed.

A 10-bar fixture with hand-counted facts backs the unit tests. The weights are first guesses
awaiting teacher review.

---

## 5. Ask DrumHub: the agent (`desktop/score-agent.cjs`, `js/agent-tools.js`, `js/agent-contract.js`)

### 5.1 Request flow

```
validateRequest: question ≤ 500 chars, snapshot re-validated, scope inside the snapshot range
  → cloud off or no key → deterministic offline answer
  → rate limits: 1.5 s between cloud questions, 100 per day, shared monthly budget
  → loop (Responses API, model default gpt-5.6-luna):
       instructions + context line + question          (the notes are NOT in the prompt)
       tools: 8 strict function schemas, parallel_tool_calls: true
       reasoning.effort: low, max_output_tokens: 12000
       text.format: json_schema, strict
       function calls → runTool() locally → function_call_output → next round
       after 4 tool rounds: tool_choice "none", the model must answer
  → checkAnswer(); on failure, send the problems back once ("repair round")
  → finalizeAnswer(): add bar ids, code-generated caveats, scoreId/revision/snapshotHash
  → any error, refusal or second failure → offline answer with a caveat
```

**Tools** (all read-only, all running `score-analysis.js` on the snapshot):
`get_score_overview`, `inspect_bars` (≤ 8 bars), `find_complex_passages`, `find_patterns`,
`compare_passages`, `find_fill_candidates`, `build_practice_plan`, `find_exercises`.
`runTool` never throws: bad arguments return `{error}` so the model can correct itself. Tool
output is capped at 20,000 characters.

### 5.2 Output contract and checks

Schema: `{answer, abstained, references[{fromBar, toBar, label}], suggestedQuestions, caveats, actions}`.

| Check | Mechanism |
|---|---|
| References valid | Every `fromBar`/`toBar` inside the snapshot range |
| Every mentioned bar is cited | `barMentions()` parses "bar 5", "bars 7–8", "bars 1, 2 and 6" and bare ranges, excluding BPM, %, counts and times |
| Looked something up | A non-abstained answer needs at least one tool result |
| Drums grounded | Each drum word in a sentence must map to a drum name present in the tool outputs; instruments DrumHub never has are refused outright |
| Unsupported claims | A regex for accents, sticking, dynamics, ghost notes, flams, ties, hands and feet, "let it ring"; allowed only in a sentence that says the score does not show it |
| Child safety and topic | An unsafe-content pattern, an instruction-leak pattern, and an on-topic vocabulary test |
| Hidden characters | Zero-width and bidirectional control characters refused in every shown field |
| No internals | "tool", "snapshot", "JSON" not allowed in the answer |
| Out-of-range bars | Refused even when `abstained: true` |

Warnings about unchecked imported bars and truncated snapshots are generated by code in
`requiredCaveats()`; the model's own versions are dropped. Proposed actions (`select_bars`,
`set_loop`, `set_tempo`, `open_exercise`) are validated the same way and never run without a
click; none of them can change notes.

### 5.3 Evaluation harness (`eval/score-agent/`)

- 20 questions with traps: sticking, accents, "which hand", a bar that does not exist, an
  unchecked imported bar, an off-topic prompt injection.
- Frozen fixture scores with hand-checked facts; the question file's hash is in every report.
- Deterministic graders only. An LLM judge is deliberately not used until its agreement with
  teachers has been measured.

Release gates and the latest live run (2026-09-15, Luna, 20 questions):

| Gate / metric | Threshold | Result |
|---|---|---|
| References valid | 100% | 100% |
| Correct abstention | 100% | 100% |
| Unchecked-import warning | 100% | 100% |
| Grounded sentences | ≥ 95% | 100% |
| Answered without offline fallback | ≥ 95% | 100% |
| Harness errors | 0 | 0 |
| Unconfirmed score changes | 0 | 0 |
| Facts mentioned | — | 92.9% |
| Latency p50 / p95 | — | 6.3 s / 11.4 s |
| Cost, all 20 | — | US$0.027 |

Reading the first live run's answers found four things every grader had passed: "256 drum hits"
that were really 256 simultaneous-drum moments, "let it ring" advice, internal jargon, and
duplicate warnings. All four are now checks.

### 5.4 Red-team

Codex and Gemini attacked the prompts and checks independently (Gemini saw copies of code files
only). 11 real gaps, each now a test in `test/red-team.test.mjs`:

- an invented "cowbell in bar 7" → drum grounding against tool output
- "keep it a secret" replies → local safety and topic gate
- `abstained: true` smuggling bar 999 → range check applies regardless
- zero-width characters hiding "right hand" from the claims regex → hidden characters refused
- an assignment title leaking a student name to the cloud → titles and ids replaced by labels
- "90 minutes" borrowed from a 90 BPM fact → numbers must match a fact with the same unit
- retries bypassing the rate limit → every attempt is counted

---

## 6. Library and Fill Lab (`js/exercise-search.js`, `desktop/fill-generator.cjs`)

- **26 original exercises and 21 original fills**, each with level, styles, note value, limbs,
  goals, tempo range and the bars themselves.
- **Retrieval is deterministic, not embedding-based.** Structured filters first (level, style,
  subdivision depth, goal), then lowercase word overlap for ranking. Every result lists the words
  and facts that matched. With 47 items, an inspectable ranking is worth more than recall.
- **"Suggested for these bars"** turns the selection's analysis facts (shortest note, complexity
  reasons such as coordination or syncopation) into queries.
- **Fill recommendation:** filter by level (same or one easier), tempo range and a subdivision no
  finer than requested; rank by style match and distance to the target tempo; top 3 with reasons.
- **Generated fills (cloud):** the model writes one 4/4 bar. Code checks it sums to exactly 192
  ticks, uses only the 14 drums and valid durations (one repair round), and drops any text that
  claims sticking or hands.

---

## 7. Practice and teacher tools (`desktop/practice-store.cjs`, `desktop/teacher-summary.cjs`)

**Storage.** `node:sqlite` (`DatabaseSync`), WAL journal, foreign keys on, a `schema_migrations`
table. Tables: `students`, `sessions`, `attempts`, `assignments`, `difficulty_resets`, with
`CHECK` constraints (BPM 1–400, `to_bar >= from_bar`, name 1–60 characters) and
`ON DELETE CASCADE` from student to everything they own. Nothing here is sent anywhere.

**Personal difficulty.** Computed per bar range, only with at least 3 sessions and 6 attempts:

```
recency(t)   = exp(−age_days / 30)
difficulty   = 0.40 × recency-weighted share of unclean attempts
             + 0.35 × gap between best clean BPM and the target
             + 0.25 × recency-weighted self-rating
```

Each result carries reasons. A reset timestamp per student and score excludes older data.

**Practice plan.** Count it → slow at 60% → loop at 80% → connect one bar either side at 80% →
full tempo, never below 40 BPM, each with a success condition.

**Teacher summary.** Facts are assembled locally, each with an id. The cloud draft (only with
guardian consent and cloud help on) never receives the name, student id, assignment titles or
score ids. Checks: every highlight cites fact ids, every number matches a fact with the same
unit, no talent or personality judgments, no names. Real names are substituted back locally.

---

## 8. Playback and export

- **Schedule (`js/playback-schedule.js`).** Pure function from bars to tick-based events.
  Seconds are computed from integer ticks, so looping never accumulates floating-point drift.
- **Engine (`js/playback-engine.js`).** Look-ahead scheduling: a 25 ms timer queues everything
  in the next 120 ms on the `AudioContext` clock, which is the only clock used for sound. Stop
  uses a 10 ms gain ramp to avoid clicks.
- **Sound.** Synthesised drums (no sample licences). Count-in, metronome, loop, practice tempo,
  moving note highlight.
- **Export.** PDF (print), Standard MIDI on General MIDI channel 10, MusicXML 4.0.

---

## 9. Engineering quality

| Check | Detail |
|---|---|
| Node unit and integration tests | 289, all passing (`npm test`, about 1 s) |
| Real-Electron workflow tests | 7 scripts (`npm run test:desktop`) |
| Service integration | `npm run test:service` starts the real Python service |
| Python tests | `backend/test_*.py` (service, bundle loading, segmentation) |
| ML pipeline tests | `ml/omr/test_*.py` (contract, training resume, export, release) |
| Cross-layer contract test | `test/notation.test.mjs` fails if the editor's drum list drifts from `training_contract.py` |
| Accessibility | 21 issues found in review, all fixed |
| Packaging | electron-builder, unsigned macOS app |

Design choices that make this testable: analysis, scheduling, import conversion and validation
are pure modules with no DOM; clocks, id factories, file writers and HTTP clients are injected.

---

## 10. Likely questions

**Why a fixed 32-slot grid instead of a sequence model?**
It turns transcription into classification with a tiny head and one forward pass, which is what
makes 16 ms on a CPU possible. The cost: nothing finer than a 32nd, triplets are rounded onto the
grid and regrouped afterwards, and only 4/4 fits. A sequence decoder is the path to other meters.

**Why is exact-bar accuracy so low with 96.7% cell accuracy?**
A bar has 448 drum cells and most are empty, so cell accuracy is dominated by true negatives. One
false positive anywhere fails the bar, and the errors are false positives on rare drums.

**How would you improve the model?**
In order of cost: per-drum thresholds tuned on validation; lower the `pos_weight` clamp; replace
global average pooling with pooling that keeps the vertical axis; more songs (289 → 500+) and
more rendering styles to close the train/validation gap and the domain gap.

**Why your own model if a cloud model scores higher?**
Different operating points. Mine is 16 ms, free, offline and private; the cloud model takes over
a minute per bar, costs money and needs adult consent. It was also worse on Songsterr notation
(3.3% against 10.0% on the same 30 bars).

**How do you stop the agent hallucinating?**
The notes never enter the prompt. Facts come only from tool results computed by code, the output
is schema-constrained, and code verifies references, drum grounding and unsupported claims, with
one repair round and a deterministic fallback. Gates are 100% on references and abstention.

**Why regex checks instead of an LLM judge?**
They are deterministic, free, and run on every answer in production, not only in evaluation.
A judge would need calibration against teachers first, which has not happened.

**Why lexical search instead of embeddings?**
47 curated items with structured metadata. Filters plus word overlap give a stable, explainable
ranking with no model to host and no drift between runs.

**How is the renderer kept away from secrets?**
Sandbox, context isolation, a fixed IPC surface, a sender check on every handler, and the key
only ever in main with redaction on error paths.

**How is children's data protected?**
Practice data stays in local SQLite. Cloud features are off by default and adult opt-in, with
per-student guardian consent for summaries, names and free-text titles never sent,
`store: false`, and monthly and per-minute limits. Gemini is used only for developer evaluation
on synthetic data.

**What went wrong?**
The leaked Gemini benchmark (82% against a real 40%). Reasoning tokens silently consuming the
output budget until I raised the limit and added a retry at lower effort. A first live agent run
that passed every grader while still saying "let it ring".

**What is next?**
Benchmark the shipped screenshot model (Sol); a per-publisher drum key for the cloud prompt;
per-drum thresholds and more varied training renders for the local model; teacher review of the
complexity weights, question bank and exercises; a small pilot.
