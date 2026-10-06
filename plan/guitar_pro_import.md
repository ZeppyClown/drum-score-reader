# Open a Guitar Pro file in DrumHub

Written: 2026-10-05. Status: specification, not built. Master plan ticket 25 (J10).

## Goal

A teacher chooses a Guitar Pro file (`.gp`, `.gp5`, `.gp4`, `.gp3`, `.gpx`) and its drum
part appears in DrumHub as an ordinary editable score: playable, loopable, exportable,
and readable by Insights and Ask DrumHub.

This import reads the notes from the file. Nothing is recognised from a picture, so
there are no recognition mistakes to correct. The only losses are things DrumHub's score
cannot hold, and each of those is reported.

## What the teacher sees

1. Side menu → **Open Guitar Pro file…** (also File → Import → Guitar Pro file…).
2. A file picker limited to Guitar Pro files.
3. If the file has more than one drum track, a short list to pick one.
4. A summary before anything is added:

   ```
   Everlong — Foo Fighters · 158 BPM · 164 bars
   151 bars will be added exactly as written
     9 bars were simplified (grace notes removed, ghost notes shown as normal notes)
     4 bars cannot be shown (not in 4/4) and will be added empty for you to fill in
   [ Add as new score ]  [ Add to the end of this score ]  [ Cancel ]
   ```
5. The score opens with title and tempo filled in. Simplified and empty bars carry the
   amber "needs checking" box and appear in **Next bar to check**; exact bars do not.

Friendly errors, with the score left untouched: not a Guitar Pro file, file too large,
no drum track in the file, file is damaged.

## Design decision: read the file in JavaScript, not Python

| | Read with alphaTab in Electron main | Read with the Python parsers in `ml/data-prep/parse/` |
| --- | --- | --- |
| Works without Python installed | Yes | No — the packaged app does not bundle Python |
| Formats | GP3–GP7 in one library | GP5 and GP7 only, two separate parsers |
| Keeps the UI/ML split | Yes | No — app code would import from `ml/` |
| Cost | One new runtime dependency (about 1 MB minified) | None new |

**Use alphaTab's file reader in the main process.** Only its importer is used; DrumHub
keeps drawing with VexFlow. The Python parsers stay as the training-data tool.

Checked on 2026-10-05 with alphaTab 1.8.4 on one 69-bar song: it found the drum track,
tempo (129) and section names, and 51 of 69 bars came out identical to the existing
`parse_gp7.py` labels with a first-draft reader. All 18 differences were grace notes,
which the draft read as extra hits; the rule below removes them.

## How it works

```
menu → preload window.guitarPro.import()
  → desktop/gp-import-ipc.cjs   file picker, size check (≤ 20 MB), read bytes
  → desktop/gp-import.cjs       alphaTab reads the file → plain drum events per bar
  → js/gp-to-bars.js (pure)     events → DrumHub bars + warnings   ← all the rules live here
  → summary dialog → importBarsCommand / new score
  → render (unchanged)
```

The page never receives the file path or the raw file, only the finished bars, in line
with how score files and page import already work.

### Step 1 — pick the drum track

A drum track is one whose staff is marked as percussion. One track → use it. Several →
ask. None → "This file has no drum part."

### Step 2 — read each bar into plain events

For every bar of the chosen track, across all its voices:

```js
{ barNumber, timeSignature: [4, 4], section: 'Verse 1' | null,
  events: [{ startTicks, durationTicks, drums: ['kick', 'hi_hat_closed'], ghost, accent }] }
```

`startTicks` is converted to DrumHub's 48 ticks per quarter note (192 per 4/4 bar).

### Step 3 — map each hit to one of DrumHub's 14 drums

Each note names a percussion sound; resolve it to a General MIDI number, then use the
same table as `parse_gp7.py` so imports and training labels can never disagree:

| MIDI | DrumHub drum | | MIDI | DrumHub drum |
| --- | --- | --- | --- | --- |
| 35, 36 | kick | | 46 | hi_hat_open_half |
| 38, 40 | snare | | 92 | hi_hat_open_full |
| 37 | snare_rim | | 49, 54, 57 | crash |
| 42 | hi_hat_closed | | 51, 59 | ride |
| 44 | hi_hat_pedal | | 53 | ride_bell |
| 48, 50 | tom_hi | | 43 | floor_tom_1 |
| 45, 47 | tom_mid | | 41 | floor_tom_2 |

Anything else (china, splash, cowbell, clap, rimshot, choked crash, sticks) has no
DrumHub drum. The hit is left out and the bar gets a warning naming it. It is never
swapped for a "close enough" drum.

### Step 4 — turn events into an editor bar

Reuse the existing rules instead of writing new ones:

- Hits that start together merge into one chord.
- A hit that would run into the next one is shortened; gaps become rests; the bar is
  filled to exactly 4/4. This is what `barFromPrediction` in `js/import.js` already does,
  so `gp-to-bars.js` converts events to its `{ position, duration, drums }` input and
  calls it.
- Triplets are placed by their real start time, not rounded to the 32nd-note grid.

### Step 5 — what happens to things the score cannot hold

| In the file | What DrumHub does | Bar marked for checking |
| --- | --- | --- |
| Ghost note | Shown as a normal note | Yes — "ghost notes shown as normal notes" |
| Accent, dynamics | Dropped | No |
| Grace note (flam, drag, ruff) | Grace note removed, main note kept | Yes |
| Drum with no DrumHub equivalent | Hit left out | Yes, naming the drum |
| Note shorter than a 32nd, or a 5-, 6-, 7-note group | Bar added empty | Yes — "could not be shown" |
| Bar not in 4/4 | Bar added empty | Yes |
| "Repeat the previous bar" sign | Previous bar's notes copied in | No |
| Repeat barlines, 1st/2nd endings | Written out in file order, **not** unfolded | No; one notice for the whole import |
| Section names | Dropped until the score can hold them (plan J13) | No |
| Tempo changes inside the song | First tempo used | No; one notice for the whole import |
| Sticking, lyrics, text | Dropped | No |

An empty bar keeps its place so bar numbers still match the original chart.

### Step 6 — where each bar came from

Add `'guitar_pro'` to `SOURCES` in `js/score-document.js`.

- Bar converted with no losses → `reviewed: true`, no warnings.
- Bar simplified or left empty → `reviewed: false`, with its warnings.
- `model` holds the file format, e.g. `"gp7"`.

Files saved with this source will not open in an older DrumHub, because the older
version rejects a source it does not know. That is the existing, intended behaviour.

## Limits

- 20 MB per file; 2,000 bars per score (the existing `MAX_BARS`). A longer file imports
  the first 2,000 bars and says so.
- The file's title and artist are untrusted text: trimmed to the 200-character title
  limit, hidden characters removed with `js/safe-text.js`, never sent to a model.
- Only 4/4 bars are converted. A file entirely in another meter imports as empty bars
  with a clear message; it is not opened view-only.

## Files to add or change

| File | Change |
| --- | --- |
| `package.json` | Add `@coderline/alphatab` to `dependencies` (it must ship) |
| `desktop/gp-import.cjs` | New: bytes → plain events per bar (the only file that touches alphaTab) |
| `desktop/gp-import-ipc.cjs` | New: file picker, size check, `guitarPro:import` handler with `trustedSender` |
| `js/gp-to-bars.js` | New, pure: drum table, grace-note and ghost rules, events → bars + warnings |
| `js/score-document.js` | `'guitar_pro'` in `SOURCES` |
| `preload.js`, `main.js` | Expose `window.guitarPro.import()`; register the handler; menu item |
| `js/menu.js`, `index.html` | "Open Guitar Pro file…" button |
| `js/import-ui.js` | Summary dialog; add as new score or append |

## Tests

- `test/gp-to-bars.test.mjs` (Node, no Electron): chords, rests from gaps, triplets,
  dotted notes, every row of the "cannot hold" table, the drum table checked against
  `ml/data-prep/parse/parse_gp7.py` so the two cannot drift.
- `test/gp-import.test.cjs`: a small Guitar Pro fixture written for the test (not a
  commercial song) → expected bars; damaged file; file with no drum track; two drum tracks.
- `test/desktop-gp-import-smoke.cjs`: the real app opens the fixture, shows the summary,
  adds the bars, and the score plays.
- Agreement check, run locally and not committed: every bar of the 324 Guitar Pro files
  in `ml/data/` converted both ways; report the share that match the Python labels.

## Done when

1. A Guitar Pro file opens as an editable DrumHub score with title and tempo set.
2. On the agreement check, bars with no grace notes, ghost notes or unsupported drums
   match the Python labels 100%.
3. Every simplified or empty bar is marked for checking and says why.
4. No drum is ever substituted for another.
5. It works in the packaged app on a computer without Python.
6. `npm test` and `npm run test:desktop` pass.

## Not in this ticket

- Showing ghost notes, accents, sticking or section names (plan J13 adds the fields;
  this import then fills them).
- Unfolding repeats into the played order.
- Other meters than 4/4.
- Writing Guitar Pro files.
- Importing Reflow `.flow` files.

## Open questions for Victor

1. Should a ghost note be kept as a normal note (as specified) or left out?
2. Add as a new score by default, or append to the open one?
3. Is one new shipped dependency acceptable? The alternative needs Python on every
   teacher's computer.
