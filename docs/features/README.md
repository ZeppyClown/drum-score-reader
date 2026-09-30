# DrumHub feature and project guides

These guides explain DrumHub's implemented features and the project components that support them. They were written from the working tree on 30 September 2026, including the changes present locally at that time. They describe the code's behavior; creating these guides did not include a new runtime or accuracy evaluation.

DrumHub is a desktop drum score reader and editor for students and teachers. Its main workflow is to enter or import notation, correct it, hear it, understand its patterns, and practise selected passages. Core editing, playback, analysis, exercises, and practice records work locally. Optional cloud features provide screenshot recognition, conversational answers, new fills, and teacher summaries.

## Guides by part

| Guide | What it explains |
| --- | --- |
| [01 — Project overview](01-project-overview.md) | The product, application layout, architecture, and connections between components. |
| [02 — Score editor](02-score-editor.md) | Drum entry, chords, durations, rests, triplets, selection, rendering, and accessibility. |
| [03 — Score files and exports](03-score-files-and-exports.md) | Saved documents, undo, recovery, file conflicts, PDF, MIDI, and MusicXML. |
| [04 — Bar and screenshot import](04-bar-and-screenshot-import.md) | Local recognition, cloud clipboard recognition, conversion, and checking imported bars. |
| [05 — Page and PDF import](05-page-and-pdf-import.md) | Segmentation, editable crop boxes, reading order, retries, partial results, and resume. |
| [06 — Playback](06-playback.md) | Audio, practice tempo, loops, count-in, metronome, and score highlighting. |
| [07 — Insights and score analysis](07-insights-and-score-analysis.md) | Counting, comparisons, repeated patterns, complexity, fill candidates, and practice plans. |
| [08 — Ask DrumHub](08-ask-drumhub.md) | Offline questions, cloud conversation, grounded answers, citations, and suggested actions. |
| [09 — Exercise library](09-exercise-library.md) | Searching, filtering, previews, passage recommendations, and adding exercises. |
| [10 — Fill Lab](10-fill-lab.md) | Existing fill recommendations and optional generation of a checked one-bar fill. |
| [11 — Practice tracking](11-practice-tracking.md) | Students, permission records, sessions, attempts, assignments, dashboards, and personal difficulty. |
| [12 — Teacher summaries](12-teacher-summaries.md) | Progress facts, offline reports, optional cloud drafts, and output validation. |
| [13 — Desktop and cloud infrastructure](13-desktop-and-cloud-infrastructure.md) | Electron, the preload bridge, app settings, cloud requests, usage limits, and packaging. |
| [14 — Local recognition backend](14-local-recognition-backend.md) | FastAPI endpoints, model loading, preprocessing, segmentation, and service lifecycle. |
| [15 — Training data pipeline](15-training-data-pipeline.md) | Guitar Pro parsing, PDF cropping, reconciliation, supported examples, and dataset splits. |
| [16 — OMR model and releases](16-omr-model-and-releases.md) | Model architecture, training, evaluation, ONNX export, benchmarking, and release evidence. |
| [17 — Testing, evaluations, and planning](17-testing-evaluations-and-planning.md) | Automated checks, recognition comparisons, assistant evaluations, and project planning documents. |

## Suggested reading order

For a product tour, start with the overview, then read guides 02–12. For development, follow the overview with guide 13, guide 14, and the guide for the feature you are changing. For machine learning, read guides 15–17.

Source links in each guide point back to the implementation. They are useful when you want to move from a feature explanation to the code responsible for it. The root [README](../../README.md), [codebase guide](../../CODEBASE.md), and [master plan](../../plan/drumhub_master_plan.md) provide additional context. Older plans and comments sometimes describe superseded behavior; the implementation takes precedence when describing current features here.

The adjacent `ai-engineer-workshop-2026-project/` directory is a separate course-platform project. DrumHub's application entry point does not load it, and these guides do not treat its features as DrumHub features.
