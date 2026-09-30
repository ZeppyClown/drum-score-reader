# Single-bar and screenshot import

[Back to guide index](README.md)

## Purpose and recognition choices

Import converts notation pixels into ordinary editable DrumHub bars. There are two entry points: a local file importer for a cropped bar, and a cloud clipboard importer for one or more complete bars. Both pass recognition results through the same conversion rules before adding them to the editor.

| Path | Input | Recognition | Requirements |
| --- | --- | --- | --- |
| Import bar image… | One cropped PNG or JPEG 4/4 bar. | Local ONNX model through Python. | Model bundle and backend runtime. |
| Paste your screenshot | Clipboard image containing up to 64 complete 4/4 bars. | Configured OpenAI recognition model. | Cloud help enabled, API key, internet access. |

## Local import

Open the side menu and choose Import bar image…. The desktop file picker selects a PNG or JPEG, the main process sends it to the local service, and the predicted events return with their onset positions, drum names, and duration names.

An initial empty score is filled; subsequent imports append after existing bars. The imported bar becomes the editing target. The status area explains success, cancellation, or failure. Selecting a file does not require sharing it with a cloud provider.

The released local model is a baseline that often needs correction. Its documented full held-out sequence accuracy is 12.5%, so an apparently well-rendered result is not evidence that every drum was read correctly.

## Screenshot import

Copy a screenshot, then click Paste your screenshot or paste in the editor outside text fields. Cloud help must be enabled through the adult confirmation; an API key alone does not enable the action. Electron reads the clipboard image and sends it from the main process.

The current configured default is `gpt-5.6-sol`, with high reasoning effort and original image detail. `OPENAI_OMR_MODEL` overrides it, and the older `OPENAI_MODEL` is a fallback setting. The response uses a strict structured format containing bars and uncertainties. The UI displays editable notation and plain-language messages rather than asking the user to handle model JSON.

Cloud recognition can take several minutes. Its current timeout is ten minutes, and an output-token cutoff triggers one retry with medium reasoning. Screenshots over 20 MB or results over 64 bars are rejected. Incomplete or unreadable crops can produce a request to crop again.

## Conversion into editor notes

Recognition positions identify 32nd-note grid slots across a 4/4 bar. The converter maps duration names such as `eighth` to editor duration codes, preserves simultaneous drums, and inserts rests for silence. It shortens a duration if it overlaps the next onset and fills the remaining time to complete the bar.

Triplet onsets are rounded in the recognition grid. Conversion groups them into the nearest triplet positions for the relevant beat span. Any shortening, regrouping, or merging produces a warning. Invalid drum names, durations, positions, or event ordering cause conversion to fail.

For a multi-bar screenshot, convertible bars are added together as one undoable command. A bar that cannot be converted is skipped with an explanation, while other usable bars can still be added. This differs from page import, which can preserve a failed box as an empty placeholder.

## Review imported bars

Every imported bar starts unchecked and records its source, recognizer, and warnings. Next bar to check moves to an unchecked import. Mark bar checked records the user's explicit review; it is not a confidence score from the model. Correct notes with the normal editor controls and compare them against the source chart.

An empty prediction becomes a rest bar with a warning. It should be checked for missed notes. Analysis and assistant answers disclose unchecked imports because downstream explanations may accurately describe an inaccurate transcription.

## Source map

See [import-ui.js](../../js/import-ui.js), [import.js](../../js/import.js), [review.js](../../js/review.js), [review-ui.js](../../js/review-ui.js), [openai-omr.cjs](../../desktop/openai-omr.cjs), and [main.js](../../main.js).
