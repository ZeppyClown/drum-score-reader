# Exercise library

[Back to guide index](README.md)

## Purpose and catalogue

The Library tab provides DrumHub's own exercises for practising reading and coordination patterns. Its current catalogue contains 26 exercises, alongside 21 fills described in the Fill Lab guide. Catalogue search and recommendations work locally without an API key.

An exercise contains an ID, title, description, level, style tags, subdivision, practice goals, tempo guidance, and actual editable bars. These structured fields support filtering and explainable recommendations. The catalogue is frozen data rather than a live external content feed.

## Search and filters

The Exercises view offers text search and filters for level, style, note value, and goal. Levels are beginner, intermediate, and advanced. Note-value filters include quarter, eighth, sixteenth, triplet eighth, and 32nd subdivisions. Style and goal options come from the catalogue's tags.

Structured filters remove unsuitable entries first. Text matching uses normalized word overlap to rank the remaining exercises, with deterministic tie-breaking. This is a small local retrieval system; it does not require embeddings, an external search engine, or model-generated descriptions.

Each card shows its level, BPM range, subdivision, description, and why it matched. The explanation helps the user judge whether an exercise addresses the intended practice problem rather than treating the ranking as an unquestionable recommendation.

## Preview and add

Preview draws the exercise using the same notation approach as the score. A count-and-drums table remains available for accessibility and provides a visible fallback if VexFlow cannot draw the preview.

Add to score inserts the exercise's bars through the normal command system. The result is editable notation with new IDs and an undoable change. It does not merely display a reference card beside the score. The UI reports the bar numbers that were added, allowing the user to select and play them.

## Recommendations from a passage

Select bars and click Suggested for these bars. With no selection, the cursor bar supplies the context. The library inspects the passage's smallest note value, triplets, rests, off-beat hits, simultaneous kick/pedal and other drums, tom use, and complexity signals.

Those facts map to goals such as reading rests, triplets, syncopation, kick independence, and tom movement. The system returns up to three exercise recommendations and includes reasons tied to the inspected bars. For example, a passage with triplets and rests can lead to a recommendation to practise counting those features before attempting the full groove.

Ask DrumHub uses the same exercise retrieval through `find_exercises`. An Open exercise action can open a matching Library entry, but adding it to the score remains an explicit library action.

## Limits

Recommendations are based on notation features and catalogue tags. They do not independently establish a student's ability or diagnose why a drummer missed a note. A passage with unchecked recognition errors can produce an unsuitable recommendation because the retrieved exercise fits the stored transcription.

Exercises contain the information supported by DrumHub's score format. Descriptions and tags do not add editable sticking, accents, or dynamics. Adding catalogue content requires updating the local catalogue and keeping it valid under the same score rules.

## Source map

See [exercise-catalogue.js](../../js/exercise-catalogue.js), [exercise-search.js](../../js/exercise-search.js), [library-ui.js](../../js/library-ui.js), and [bar-drawing.js](../../js/bar-drawing.js).
