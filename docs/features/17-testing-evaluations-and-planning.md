# Testing, evaluation labs, and planning

[Back to guide index](README.md)

## Different checks answer different questions

Automated behavior tests verify application rules and interfaces. Model evaluation measures prediction quality. Recognition benchmarks compare recognizers on shared inputs. Assistant evaluation checks grounding and abstention. Passing one category does not imply the others pass.

The repository keeps these layers separate so a change can be checked at the level it affects. For example, fixing crop-box movement calls for box and desktop checks; changing a recognition prompt calls for measured recognition comparisons as well as response parsing tests.

## Application and backend checks

| Command | Coverage |
| --- | --- |
| `npm test` | Editor rules, documents, commands, imports, analysis, playback, catalogue, UI helpers, and desktop service modules. |
| `npm run test:service` | Local inference integration using runtime artifacts and fixtures. |
| `npm run test:desktop` | Electron smoke checks for import, files, Insights, assistant, page import, playback, library, and practice. |
| `python3 -m unittest discover -s backend -p 'test_*.py'` | Backend contracts, preprocessing, bundle validation, and segmentation. |
| `python3 -m unittest discover -s ml/omr -p 'test_*.py'` | Training contracts, subsets, reproducibility, evaluation, export, and release guards. |

Some checks need local models, crop datasets, Python ML packages, or a desktop-capable environment. Backend tests can construct a randomly initialized ONNX export and therefore need more dependencies than production inference. Fixed test counts in older READMEs are historical; the test files and script definitions describe the present suite.

## Recognition benchmark lab

`eval/recognition/` runs the same labelled bars through configured recognizers and scores exact bars, onset F1, drum-hit F1, duration accuracy, errors, latency, and cost. It supports resumable runs by saving per-bar progress before writing the finished report.

The synthetic set contains DrumHub-rendered catalogue examples. The held-out lab set uses Songsterr bars from the test split. It is not the same population as the full 2,184-bar training evaluation, so its accuracy should not be compared as if only the recognizer changed.

The harness supports a Gemini developer comparison on synthetic data only. It refuses to send held-out source charts to that provider. This is an implemented project data restriction; Gemini is not an app recognition option. Reflow charts with student-identifying filenames are excluded from this lab.

For file-capable recognizers, images are isolated in an empty work directory under a neutral filename. This prevents accidental access to the answer manifest or informative chart names. The lab's README documents an earlier inflated result caused by answer access.

```sh
node eval/recognition/run.mjs --providers local --set synthetic
node eval/recognition/run.mjs --providers local --set heldout
```

Cloud comparisons are explicit developer runs and can incur costs. Saved reports describe their own dates, models, settings, and input sets. Historical Luna benchmark results do not automatically measure the currently configured Sol screenshot importer.

## Ask DrumHub evaluation

The assistant harness uses frozen score fixtures and a question bank. It checks expected facts, valid and required references, abstention on unsupported questions, unchecked-import warnings, grounded sentences, unsupported claims, latency, tokens, and fallback behavior.

`npm run eval:agent` runs the offline evaluation. Cloud runs require explicit provider configuration and an API key. The configured gates demand valid references and abstention, sufficient grounding, no score changes, and a high share of cloud answers passing without fallback. The question labels still require teacher review; deterministic grading does not make them a completed pedagogical validation.

## Plans and domain guidance

`plan/drumhub_master_plan.md` records the broader delivery and product plan. `plan/progress.md` is a dated audit. `plan/README.md` provides planning context but includes older baseline findings that no longer describe all current features. `plan/model_training.md` and `plan/score_editor.md` are historical pointers to superseded approaches.

Issues and PRDs are tracked in GitHub Issues, with repository guidance under `docs/agents/`. `docs/interview-brief.md` provides another project narrative. No root `CONTEXT.md` or `docs/adr/` files were present when these guides were prepared; those expected domain-documentation locations can be added later.

The new `docs/features/` guides explain the current implementation. They are not a replacement for dated experiment reports, tests, issue acceptance criteria, or a roadmap.

## Source map

See [package.json](../../package.json), [test directory](../../test/), [recognition lab README](../../eval/recognition/README.md), [assistant evaluation README](../../eval/score-agent/README.md), [master plan](../../plan/drumhub_master_plan.md), [progress audit](../../plan/progress.md), and [issue-tracker guidance](../agents/issue-tracker.md).
