# Project Progress Review

Reviewed: 2026-09-11
Baseline: `main` at `46357e9`

This is a review checkpoint before feature implementation. No application code was changed in this pass.

## Repository state

- The parent Git repository is on `main` and has no tracked modifications.
- `ai-engineer-workshop-2026-project/` is an untracked directory, not part of the current branch.
- `songsterr/guitar_pro/SUSS Timesheet.pdf` is also untracked.
- The original project is the Electron drum-score reader at the repository root.

## Drum-score reader

### Done or present

- Electron entry point and VexFlow score rendering are present.
- Manual editing is present: ten drum-key mappings, cursor movement, duration changes, dotted notes, rests, bar-capacity checks, a draggable keypad, and bars-per-line layout.
- The ML workspace contains 178 GP5 files, 179 PDFs, 23,819 parsed labels, 19,948 cropped images, and `ml/data/dataset.zip`.
- The training notebook contains a two-phase MobileNetV3 training loop, song-level train/validation/test splitting, evaluation code, ONNX export code, ONNX verification code, and a benchmark script.
- Browser JavaScript syntax checks successfully with Node's module parser.

### Number audit

The current packaged dataset counts reconcile:

| Check | Result |
|---|---:|
| Training images | 19,948 |
| Training labels in the ZIP | 19,948 |
| Image/label entries in the ZIP | 39,896 |
| ZIP total entries | 39,898, including two directory entries |
| Notebook train bars | 15,709 |
| Notebook validation bars | 2,315 |
| Notebook test bars | 1,924 |
| Split total | 19,948 |
| Notebook songs | 212 train + 26 validation + 26 test = 264 |

The split is by song, so the bar proportions are not exactly 80/10/10. The bar counts are internally consistent.

The 23,819 labels on disk are broader than the 19,948 image/label pairs packaged for training; 3,871 labels are outside that packaged pair set. This needs an explicit source/scope explanation before retraining.

The current model contract is 14 drums × 32 beat positions = 448 drum outputs, plus 32 × 10 duration outputs = 320. The notebook's opening description still says 15 drums and 480 outputs. Its saved Phase 2 output also says 2,469,056 parameters, which belongs to an older drum-head configuration. The current 14-drum configuration is documented as 2,305,056 parameters. These stale notebook outputs must not be used as current metrics.

The local ONNX file is 283,541 bytes (about 277 KB), while the current architecture should produce roughly 8.8 MB of fp32 weights. It is not a valid shippable model. `omr_config.json`, `eval_results.json`, and benchmark results are absent.

### Blocked or not done

- No image/PDF import UI exists in the current Electron app.
- No local model server, Electron-to-model bridge, or ONNX inference path exists.
- Multi-bar import, imported-score editing, playback, PDF/MIDI/MusicXML export, and advanced notation are not implemented.
- Current training metrics are not reproducible because the post-Phase-2 evaluation cell has no saved output and the available ONNX artifact is invalid.
- The ML scripts are not aligned with the current on-disk layout:
  - `ml/data-prep/parse/parse_gp5.py` and `parse_gp7.py` use old absolute paths.
  - Both crop scripts resolve data relative to `ml/data-prep/`, although data is under `ml/data/`.
  - Both spot-check scripts use the same outdated relative paths.
  - `ml/omr/prepare_upload.py` looks for `dataset/` at the repository root, not `ml/data/dataset/`.
- The older model plan names PaliGemma and still marks PDF slicing and pairing as incomplete, while the current notebook and model README describe a MobileNetV3 pipeline with packaged crops. The plans need to be consolidated.
- The root package has only `npm start`; there are no automated tests, lint command, build command, or packaging workflow.

## Cadence workshop project

This appears to be a separate full-stack course-platform project and is currently untracked.

### Done or present

- React Router, TypeScript, SQLite, Drizzle migrations, seed data, and route structure are present.
- Course catalog/search/categories, course and lesson pages, enrollment, lesson progress, dashboard, video tracking, quizzes, purchases, PPP pricing, teams, coupons, and redemption are implemented.
- Instructor course/module/lesson/quiz management and admin user/course/category management are implemented.
- Eleven service/library test files are present, containing roughly 3,126 test lines.

### Not done

- The requested gamification feature is not present: no points, levels/ranks, streaks, achievements, or quiz rewards exist in the schema, services, routes, or UI.
- No leaderboard is needed; the brief explicitly excludes competitive features.
- Dependencies are not installed in this directory, so tests, typechecking, and production build are currently unverified.
- Authentication is demo-only: email-only login, a hardcoded development session secret, and existing signup emails silently log in.
- Purchases are local database records; no payment-provider integration is present.

## Recommended order after review

1. Fix and test ML data paths.
2. Reproduce and validate the packaged image/label pairs.
3. Retrain or confirm the current 14-drum model.
4. Save evaluation results, the valid ONNX export, and its config together.
5. Integrate inference into the score reader.
6. Implement one feature at a time, with a separate commit and push for each completed slice.

## Verification performed

- Counted source files and generated artifacts on disk.
- Reconciled ZIP contents and notebook split totals.
- Checked current model dimensions against the notebook's stale outputs.
- Checked root JavaScript syntax with Node's module parser.
- Inspected Git status; only the review file is intended to be committed from this pass.
