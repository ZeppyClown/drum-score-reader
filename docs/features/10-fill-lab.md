# Fill Lab

[Back to guide index](README.md)

## Purpose

Fill Lab offers a small fill that fits the selected musical context. It has two paths: recommend an existing fill from the local catalogue, or request an original one-bar fill through cloud help. Both return notation that can be previewed and explicitly added to the score.

## Existing fill recommendations

The local catalogue currently contains 21 fills. Recommendation settings include tempo, subdivision, level, style, and a one-bar length. Context comes from selected bars or the cursor bar, with the relevant note value mapped to eighth, sixteenth, or triplet-eighth fill settings.

The recommender filters candidates by BPM range and subdivision, and accepts the requested level or one level easier. It does not offer a finer subdivision than requested. Style matches receive priority, followed by closeness to the catalogue's target tempo. Results are limited to three and include reasons for their suitability.

For example, a beginner playing an eighth-note passage at 80 BPM can receive an eighth-note fill within a matching tempo range. If no style-matching fill is available, a compatible fill may still be offered with an explanation that its original style differs.

Existing fills work offline. Like exercises, their cards support notation previews, accessible count tables, and Add to score. Adding a fill is an ordinary editable, undoable score operation.

## Generating a new fill

Generation requires cloud help enabled and a configured API key. The current implementation uses the configured agent model, whose default is `gpt-5.6-luna`, at low reasoning effort.

The request describes settings rather than sending the source score image: tempo from 40–220 BPM, one of the supported subdivisions, beginner/intermediate/advanced level, a short style string, and exactly one bar. The prompt asks for an original complete 4/4 fill using only the supported drums and note lengths.

The strict response contains notes and a short musical idea. Rests use an empty drum list. The notes must sum to exactly one 4/4 bar and pass document-style validation, including supported instruments, durations, dots, and correct triplet groups.

## Validation and repair

The local checker determines whether the fill is structurally acceptable. If it fails, the generator sends the problems back for one repair attempt. A still-invalid result is returned as an error instead of being inserted.

The idea text is omitted if it makes unsupported claims such as sticking, hands, or dynamics. Passing validation means the fill fits the editor's representation and bar capacity. It does not guarantee artistic quality, optimal difficulty, or originality against all existing music.

The result includes a preview and check messages. The user chooses whether to add it; the request itself does not rewrite the score. Cloud cost and rate limits apply through the shared transport. If generation fails, local recommendations remain available.

## Source map

See [library-ui.js](../../js/library-ui.js), [exercise-search.js](../../js/exercise-search.js), [exercise-catalogue.js](../../js/exercise-catalogue.js), [fill-generator.cjs](../../desktop/fill-generator.cjs), and [preload.js](../../preload.js).
