# Insights and deterministic score analysis

[Back to guide index](README.md)

## Purpose

Insights explains the structure of the stored score using local calculations. It works without a cloud model. The same analysis functions provide facts to Ask DrumHub, exercise recommendations, and practice plans, keeping those features consistent about what the notes contain.

## The Insights cards

| Card | Information |
| --- | --- |
| Score | Bar count, meter, tempo, approximate duration, frequently used drums, and shortest note. |
| Busiest notation | Ranked passages, notation scores, and reasons for their ranking. |
| Repeats | Exact repetitions and selected near-matching bars. |
| Possible fills | Bars that stand out as possible fills or transitions, with reasons. |
| Check imported bars | Imported bars that have not received explicit user review. |

Cards contain clickable bar references. A reference selects and navigates to the relevant passage. Refresh recomputes the cards after editing.

## Counting and inspection

Bar inspection describes each event's count, drums, length, rest status, and simultaneous hits. Counts include ordinary beat numbers, sixteenth syllables such as `1e`, `1&`, and `1a`, and triplet syllables such as `2trip` and `2let`. It also produces spoken counting and changes from the previous bar.

The overview distinguishes drum strokes from events containing several drums. One event with kick and hi-hat contains two drum strokes, but is one simultaneous event. This distinction matters when describing how busy a score is.

## Repeats and comparisons

Pattern detection finds exact repeated hit patterns and near matches. Near-match similarity compares sets of onset/drum pairs using their intersection divided by their union. A repeated groove can therefore be recognized even when one variation adds a crash or removes a kick.

Passage comparison also reports hits and drums added or removed and note-length changes. Pattern similarity is a rhythmic hit-pattern measure, not a claim that every written notation detail is identical. Empty bars are not presented as useful repeated grooves.

## Notation complexity

Complexity ranks bars on a 0–100 scale using subdivision density, coordination, syncopation, rhythm changes, drum movement, and tempo. Current weights are 30%, 25%, 15%, 15%, 10%, and 5% respectively. Results expose both the signals and plain-language reasons.

This is a score-level heuristic: it describes how busy and varied the notation is. It does not measure an individual student's ability. A student may find a sparse syncopated bar harder than a dense regular fill. Personal difficulty in Practice uses recorded attempts and is a separate calculation.

## Possible fills and practice plans

Fill detection uses changes in the notes and surrounding patterns to suggest transition candidates. Cards say a bar might be a fill; the score format does not contain verified musical section labels.

A practice plan for a range has five stages: count aloud, play slowly, loop at a medium speed, connect surrounding bars, and reach full tempo. Slow and medium stages derive from approximately 60% and 80% of the saved score tempo with a minimum practice BPM. Each stage includes a success condition, such as several consecutive clean repetitions. This is a generated plan, not automatic assessment of whether the condition was met.

## Snapshots, freshness, and limits

Analysis receives a compact snapshot containing score identity, revision, bar IDs, event timing, and review status. A hash verifies its content. Cloud-facing snapshots default to at most 64 bars and include a disclosure when only part of a score was shared.

A citation is refused when the score identity or revision has changed since computation, or its bars no longer exist. Refresh or ask again to obtain current results. Analysis currently supports 4/4 and can only describe supported information stored in the score. It cannot correct an imported note by comparing it with the original image.

## Source map

See [score-snapshot.js](../../js/score-snapshot.js), [score-analysis.js](../../js/score-analysis.js), [insights.js](../../js/insights.js), and [insights-ui.js](../../js/insights-ui.js).
