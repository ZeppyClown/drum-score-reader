# Drum Score Reader — Codebase Guide

> Read this top to bottom before touching any code.

---

## Tech Stack

| What | How |
|---|---|
| App shell | Electron (Node + Chromium, runs as a Mac desktop app) |
| Music notation | VexFlow 5 (loaded as a global `VexFlow` via `<script>` tag, **not** npm import) |
| Styling | Tailwind CSS + Flowbite (both loaded from CDN) |
| Modules | Native ES Modules (`import`/`export`) — no bundler, no TypeScript |

---

## File Map — Read in This Order

```
drum score reader/
├── index.html          ← 1. The page. Loads VexFlow, then app.js
├── app.js              ← 2. Entry point. Calls all init functions
├── js/
│   ├── constants.js    ← 3. All fixed values (durations, ticks, drum definitions)
│   ├── state.js        ← 4. The data model. Every other file reads from here
│   ├── score-document.js ← 4. Saved score format: ids, provenance, validation, parse/serialize (pure)
│   ├── commands.js     ← 4. Every score change as a command: revision, undo/redo, dirty (pure)
│   ├── editor-store.js ← 4. The only writer of state.editor: commit → render → listeners
│   ├── layout.js       ← 5. Bar position math (pixel coords)
│   ├── score.js        ← 6. Rendering — turns state into SVG via VexFlow
│   ├── notation.js     ← 6. Drum names → VexFlow keys, noteheads, stem direction (pure)
│   ├── bar.js          ← 7. Pure editing rules — capacity, place, dot, duration, triplets, cursor moves
│   ├── input.js        ← 7. Maps keyboard + keypad to commands
│   ├── import.js       ← OMR service /predict notes → one editable bar (pure)
│   ├── import-ui.js    ← Import buttons/paste → importBarCommand with unreviewed provenance
│   ├── details-ui.js   ← Title and tempo fields (undoable metadata edits)
│   ├── review.js       ← Which imported bars still need checking (pure)
│   ├── review-ui.js    ← "N imported bars to check", Next bar to check, Mark bar checked
│   ├── sha256.js       ← Synchronous SHA-256 (same hash in page and main)
│   ├── score-snapshot.js ← Compact, hash-checked score facts for analysis and the agent (pure)
│   ├── score-analysis.js ← Overview, bar inspection, repeats, fills, complexity, practice plan (pure)
│   ├── selection.js    ← Selected bars stored by bar id; click / Shift-click commands (pure)
│   ├── selection-ui.js ← Maps clicks on the score to bars
│   ├── score-description.js ← Each bar in plain words for screen readers (pure)
│   ├── score-a11y.js   ← Keeps the hidden "bars in words" list current; S / Shift+S select bars
│   ├── insights.js     ← Offline insight cards with bar citations; stale-revision check (pure)
│   ├── insights-ui.js  ← Side panel "Insights" tab; followCitation() shared with Ask DrumHub
│   ├── agent-tools.js  ← The 7 read-only tools Ask DrumHub may call, run on the snapshot (pure)
│   ├── agent-contract.js ← Answer JSON schema, local answer checks, caveats added by code (pure)
│   ├── agent-actions.js ← Actions an answer may suggest (select, loop, slow down, open exercise); applied only after a click (pure)
│   ├── offline-answers.js ← Suggested questions and their offline answers (pure)
│   ├── ask-request.js  ← Which bars a question covers; builds the snapshot sent to main (pure)
│   ├── agent-ui.js     ← Side panel "Ask DrumHub" tab: suggestions, typed questions, answers, Stop
│   ├── page-boxes.js   ← Page-import bar boxes: reading order, clamping, validation (pure)
│   ├── page-import-ui.js ← Import page or PDF: review/edit boxes, transcribe, retry, add, resume
│   ├── playback-schedule.js ← Exact hit/click times for playback, loops, count-in (pure)
│   ├── playback-engine.js ← Look-ahead Web Audio scheduler; AudioContext time is the only clock
│   ├── drum-synth.js   ← Drum sounds made from oscillators and noise (no sample files)
│   ├── transport-ui.js ← Play/Stop, practice tempo, loop, count-in, metronome bar
│   ├── exercise-catalogue.js ← DrumHub's own 26 exercises and 21 fills (pure data)
│   ├── exercise-search.js ← Filter + word-overlap search for exercises and fills (pure)
│   ├── library-ui.js   ← Side panel "Library" tab: exercises and Fill Lab
│   ├── practice-ui.js  ← Side panel "Practice" tab: students, assignments, tries, dashboard, teacher summary
│   ├── export-midi.js  ← Score → Standard MIDI File on the General MIDI drum channel (pure)
│   └── export-musicxml.js ← Score → MusicXML 4.0 drum part (pure)
│   ├── file-ui.js      ← New/Open/Save/Save As, autosave, crash recovery (talks to main via preload)
├── js/menu.js          ← 8. Side menu (☰): Import bar image, Import page or PDF, bars per line
├── main.js, preload.js ← Electron main process and the narrow bridge the page may call
├── desktop/            ← Main-process modules (see §9–§12):
│   ├── omr-service.cjs      ← Starts/stops the Python recognition service; /predict and /segment
│   ├── openai-client.cjs    ← The one OpenAI transport: store:false, retries, key redaction, budget check
│   ├── cloud-budget.cjs     ← Monthly US$ limit, 20 requests/minute, provider health; shared by all cloud features
│   ├── openai-omr.cjs       ← Screenshot → up to 16 bars with GPT-5.6 Luna (prompt + strict schema)
│   ├── score-agent.cjs, agent-ipc.cjs, app-settings.cjs ← Ask DrumHub tool loop, adult cloud opt-in
│   ├── page-import.cjs, page-import-ipc.cjs ← Page/PDF import jobs saved box by box, cropping, progress
│   ├── fill-generator.cjs   ← Fill Lab: one new fill from Luna, checked against the drum list and claims rules
│   ├── practice-store.cjs, practice-ipc.cjs ← Students, assignments, practice tries in local SQLite
│   ├── teacher-summary.cjs  ← Teacher summary drafted by Luna from saved facts only (no names, no score)
│   └── score-files.cjs, score-session.cjs, score-ipc.cjs ← Save/open/recover and the File menu
├── eval/recognition/   ← Recognition benchmark: synthetic bars + held-out Songsterr, local / Luna / Gemini
├── eval/score-agent/   ← Ask DrumHub question bank, frozen scores, graders; `npm run eval:agent`
└── test/               ← `npm test` (Node) and `npm run test:desktop` (real Electron app)
```

---

## 1. `index.html` — The Page

Nothing fancy. Key things to know:

```html
<!-- VexFlow must be loaded BEFORE app.js -->
<script src="node_modules/vexflow/build/cjs/vexflow.js"></script>

<!-- app.js is a module — enables import/export across all js/ files -->
<script type="module" src="app.js"></script>
```

**The `#score` div** is where the entire SVG score is injected by VexFlow.

**The `#keypad` div** is the floating drum pad panel (top-right, draggable).

**The `#side-menu` div** slides in from the left when ☰ is clicked.

---

## 2. `app.js` — Entry Point

```js
initKeyboard();   // wire up keyboard keys
initKeypad();     // wire up keypad button clicks
initMenu();       // wire up the side menu
render();         // draw the score for the first time
```

Order matters: all three `init` calls must happen before `render()`. That's it — this file does nothing else.

---

## 3. `js/constants.js` — All Fixed Values

### Duration system

```js
DURATIONS = ['32', '16', '8', 'q', 'h', 'w']   // shortest → longest (VexFlow strings)
```

These are the **VexFlow duration strings** — the exact strings you pass to `new StaveNote({ duration: '...' })`.

| VexFlow string | British name | American name | Ticks |
|---|---|---|---|
| `'32'` | demisemiquaver | 32nd note | 6 |
| `'16'` | semiquaver | 16th note | 12 |
| `'8'` | quaver | 8th note | 24 |
| `'q'` | crotchet | quarter note | 48 |
| `'h'` | minim | half note | 96 |
| `'w'` | semibreve | whole note | 192 |

> **Common confusion:** `'q'` stands for **quarter** (American), not quaver. `'8'` is the quaver.
>
> **`'qr'` is not a duration string.** It is the *crotchet rest*, formed in code as `dur + 'r'` where `dur = 'q'`. Similarly `'8r'` = quaver rest, `'16r'` = semiquaver rest. The `'r'` suffix tells VexFlow to draw a rest symbol instead of a notehead.

### Tick system

```js
DUR_TICKS = { '32': 6, '16': 12, '8': 24, 'q': 48, 'h': 96, 'w': 192 }
BAR_TICKS = 192   // a 4/4 bar: 4 crotchets × 48 ticks
```

Ticks only exist for **bar capacity checks** in `bar.js`. They are never used for note positioning — VexFlow handles that.
48 ticks per crotchet is the smallest scale where every supported note is a whole number.

Dotted notes = 1.5 × base ticks (e.g. dotted crotchet = 72 ticks).
Triplet notes (`triplet: true`) = 2/3 × ticks (e.g. triplet quaver = 16). A triplet group is
exactly three consecutive triplet notes of one duration; `score.js` draws each with a
VexFlow `Tuplet`, which must be created **before** the notes are added to the voice.

### Drum definitions

```js
DRUMS = {
  snare:     { vexKey: 'c/5', head: 'n', stemDir: 1, cursorPos: 5 },
  ride_bell: { vexKey: 'b/5', head: 'h', stemDir: 1, cursorPos: 10 },  // diamond
  // ... one entry for each of the 14 drums the OMR model reads
}
KEY_DRUMS       = { '8': 'snare', '9': 'ride', ... }        // keys 0–9
SHIFT_KEY_DRUMS = { '9': 'ride_bell', '0': 'hi_hat_pedal', ... }  // Shift + 0/4/6/9
```

`DRUMS` is keyed by the **OMR model's drum names**, so imported notes need no translation.
A test (`test/notation.test.mjs`) fails if this list drifts from `ml/omr/training_contract.py`.
Each entry holds:
- `vexKey` — VexFlow pitch string (controls where the notehead sits on the staff)
- `head` — notehead shape: `'n'` normal, `'x'` x-head, `'cx'` circle-x, `'h'` diamond, `'tu'` triangle
- `stemDir` — `1` = stem up, `-1` = stem down
- `cursorPos` — which vertical slot (1–10) the cursor snaps to after placing this drum

### Layout constants

```js
STAVE_X    = 10    // left margin in pixels
STAVE_Y0   = 30    // top margin in pixels (below the fixed top bar)
ROW_HEIGHT = 110   // vertical distance between rows of bars
POSITIONS  = 10    // number of vertical cursor slots
SPACE      = 10    // cursor square size in pixels
```

---

## 4. `js/state.js` — The Data Model

**This is the single source of truth.** Every file that needs to read app data imports `state` from here.

```js
state = {
  editor:     { meta, bars, cursor, history, saved, idFactory },  // see commands.js
  barsPerRow: 4,
  bars,     // read-only getter → state.editor.bars
  cursor,   // read-only getter → state.editor.cursor
}
```

`state.editor` is **replaced, never edited**, and only by `editor-store.js` (see §9).
`score.js`, `layout.js` and the UI keep reading `state.bars` and `state.cursor` exactly as before.
`barsPerRow` is a view setting, not part of the saved score.

### `state.bars`

An array of bar objects. Each bar has one property:

```js
bar = {
  barId:      'uuid',                                   // stable through edits
  provenance: { source, reviewed, warnings, model? },   // see score-document.js
  notes:      [ note, note, note, ... ]                 // ordered array — order IS position
}
```

`provenance.source` is `'manual'`, `'local_omr'` or `'openai_omr'`. Imported bars start
`reviewed: false` and editing them does not change that — only an explicit "mark reviewed"
command does. Unreviewed bars are drawn with a dashed amber box
(`drawBarOverlays` in `score.js`); the review bar under the import buttons jumps between them.

**There is no beat or position field on notes.** The first note in the array is the first note in the bar. VexFlow reads them in sequence and handles timing from durations.

### Note object shape

```js
{
  eventId:  'uuid',   // stable id; added automatically by commands.js for new notes
  duration: 'q',      // VexFlow duration string — '32' | '16' | '8' | 'q' | 'h' | 'w'
  triplet:  true,     // optional — one of three same-duration notes taking the time of two
  dotted:   false,    // boolean — extends the note by half its value
  drums:    ['kick', 'hi_hat_closed'],  // DRUMS names; several = chord, [] = rest
}
```

Staff position, notehead shape, and stem direction are **not stored** — `notation.js`
derives them from `drums` at render time. A chord's stem points down only if every drum
in it is a stem-down drum (kick, floor toms, hi-hat pedal).

### `state.cursor`

```js
cursor = {
  barIndex:  0,   // which bar (index into state.bars)
  noteIndex: 0,   // which note within that bar (index into bar.notes)
  position:  1,   // vertical slot for the blue cursor square (1=bottom, 10=top)
}
```

`noteIndex` maps directly to the VexFlow tickable array — `cursorTickables[noteIndex]` gives you the exact rendered note the cursor is sitting on.

### `state.barsPerRow`

Integer between 2 and 8. Controls how many bars fit on one line. Changed via the side menu.

---

## 5. `js/layout.js` — Bar Positions

Pure math. No side effects. Used by `score.js`.

```js
barRow(i)              // row number (0-based) for bar i
barCol(i)              // column number (0-based) for bar i
barY(i)                // pixel Y of bar i's top edge
cursorCentreY(stave, p) // pixel Y for cursor vertical slot p
```

`cursorCentreY` anchors to VexFlow's real staff geometry via `stave.getYForLine(4)` (line 4 = bottom staff line). Each slot is 5px above the previous. This keeps the cursor aligned with actual staff lines regardless of where VexFlow decided to draw them.

---

## 6. `js/score.js` — Rendering

### One rule: `render()` only READS state, never writes it.

Called after every state change. Wipes the SVG and redraws everything from scratch.

### Execution order inside `render()`

```
1. div.innerHTML = ''              — clear previous SVG
2. Calculate bar widths            — wider for more notes
3. Find widest row                 — size the canvas
4. vfRenderer.resize(w, h)         — set SVG dimensions
5. For each bar:
   a. new Stave(x, y, width)       — draw the 5 staff lines
   b. buildTickables(bar)           — turn bar.notes → StaveNote[]
   c. new Voice → addTickables      — tell VexFlow the timing
   d. Beam.generateBeams(...)       — must happen BEFORE voice.draw()
   e. Formatter.format(...)         — space notes across the bar
   f. voice.draw(ctx, stave)        — draw noteheads, stems, rests
   g. beams.forEach(b => b.draw())  — draw beam bars AFTER voice
6. Draw cursor rectangle            — inject <rect> into the SVG DOM
```

### `buildTickables(bar)`

Converts `bar.notes` to VexFlow `StaveNote` objects. One-to-one mapping, same order.

```js
// For a rest:
new StaveNote({ clef: 'percussion', keys: ['b/4'], duration: dur + 'r' })

// For a drum hit or chord: one key per drum, each with its own notehead code
new StaveNote({ clef: 'percussion', keys: noteKeys(note), duration: dur, stemDirection: noteStemDir(note) })
// VexFlow 5 option names are camelCase — `stem_direction` is silently ignored.
// noteKeys({ drums: ['snare', 'hi_hat_closed'] }) → ['c/5', 'f/5/x']

// Dotted notes need this called after construction (VexFlow 5 requirement):
Dot.buildAndAttach([sn], { all: true })
```

### Cursor drawing

```js
// cursor.noteIndex indexes directly into cursorTickables — no searching needed
const cx = cursorTickables[cursor.noteIndex].getAbsoluteX() - SPACE/2 + 4;
const cy = cursorCentreY(stave, cursor.position) - SPACE/2;
// → inject <rect x cy width=SPACE height=SPACE fill="blue" /> into SVG
```

### Why beams must come before `voice.draw()`

VexFlow draws flags on 8th and 16th notes when it draws the voice. `generateBeams` suppresses those flags and replaces them with beam bars. If you call `generateBeams` after `voice.draw()`, the flags are already painted — you'll see both flags and beams overlapping.

---

## 7. `js/bar.js` + `js/input.js` — Editing Logic

The rules below live in **`js/bar.js`** as pure functions: each takes a bar (or the bars
array and cursor) and returns a new one, never touching `state`, the DOM, or `render()`.
A refused edit (bar full, would overflow) returns the **same object** it was given, so
`input.js` can skip the re-render. `input.js` only maps keys to these functions and stores
the result in `state`. Because `bar.js` has no browser dependencies, `npm test` runs its
rules in Node (`js/package.json` marks `js/` as ES modules for Node; the browser ignores it).

### Helper functions (read these first)

```js
// Total ticks consumed by all notes in a bar
barTicks(bar) → number

// Ticks for a single note (×1.5 if dotted)
noteTicks(note) → number

// Largest standard duration whose ticks fit within n
fitDuration(n) → '16' | '8' | 'q' | 'h' | 'w'
```

`barTicks` is the **bar capacity check**. Before any edit that changes a note's duration or adds a dotted flag, we check:

```js
if (barTicks(bar) + change > BAR_TICKS) return;  // block the edit
```

---

### CRUD — Note Operations

#### CREATE a note or chord — `toggleDrum(bar, index, drumId)`

Triggered by pressing a drum key (0–9, or Shift + 0/4/6/9, on keyboard or keypad click).

```
Is there already a note at cursor.noteIndex?
├── YES, drum already in its chord  →  remove it (last drum removed → rest, same length)
├── YES, drum not in its chord      →  add it to the chord (a rest becomes a hit)
└── NO (index past end)             →  create new note with just this drum
                                          inherit duration + dotted from previous note
                                          if inherited duration overflows bar → use fitDuration
                                          if bar is already full → do nothing
```

After placing, `cursor.position` snaps to `DRUMS[drumId].cursorPos`.

#### READ a note

There is no explicit read function. `score.js` reads `bar.notes` directly during `render()`. `input.js` reads the note at `bar.notes[cursor.noteIndex]` in every edit function.

#### UPDATE a note

Three update operations:

**Toggle dot — `toggleDot()`**
Triggered by pressing `.`

```
1. Get note at cursor.noteIndex
2. Block if duration === '32' (a dotted 32nd leaves gaps no plain rest can fill) or the note is a triplet
3. Calculate tick change: +baseTicks×0.5 (adding dot) or −baseTicks×0.5 (removing dot)
4. Block if barTicks(bar) + change > BAR_TICKS
5. Flip note.dotted
```

**Change duration — `changeDuration(delta)`**
Triggered by `-` (shorter) or `+` (longer)

```
1. Get note at cursor.noteIndex
2. Walk DURATIONS array by delta (clamp at ends)
3. Block if barTicks(bar) − oldTicks + newTicks > BAR_TICKS
4. Update note.duration
```

**Convert note ↔ rest — via `toggleDrum` or `Backspace`**

`toggleDrum` turns a rest into a hit by adding a drum, and a hit into a rest by removing
its last drum.

`Backspace` on a drum hit converts it to a rest (preserves duration + dotted so bar tick count stays the same).

#### DELETE a note — `Backspace`

```
Is the note at cursor.noteIndex a rest?
├── YES → delete it from the array, cursor.noteIndex--
└── NO  → convert to rest (same duration + dotted), do NOT delete
```

Why not delete drum hits? Deleting would collapse the array and shift all following notes, breaking their timing. Converting to a rest keeps the slot open.

---

### Navigation

#### Arrow Right

```
Does the bar have at least one real drum hit?
├── NO  → skip to next bar (barIndex++, noteIndex = 0)
└── YES →
      Is cursor.noteIndex < bar.notes.length − 1?
      ├── YES → noteIndex++  (move to next existing note)
      └── NO  → is barTicks(bar) < BAR_TICKS?
                ├── YES → create a plain rest, noteIndex++
                │          duration = previous note's duration if it fits, else fitDuration
                │          dotted is always false (auto-rests are never dotted)
                └── NO  → bar is full → barIndex++, noteIndex = 0
```

#### Arrow Left

```
noteIndex > 0?
├── YES → noteIndex--
└── NO  → barIndex > 0?
          ├── YES → barIndex--, noteIndex = last note of previous bar
          └── NO  → already at beginning, do nothing
```

#### Arrow Up / Down

Changes `cursor.position` (1–10). Does not touch any notes. `render()` moves the blue square vertically.

---

### Key binding summary

| Key | Action |
|---|---|
| `0`–`9` | Add/remove that drum in the chord at the cursor (`KEY_DRUMS`) |
| `Shift` + `0` `4` `6` `9` | Hi-hat pedal, half-open hi-hat, floor tom 2, ride bell (`SHIFT_KEY_DRUMS`); Shift-click on the keypad works too |
| `.` | Toggle dot on current note |
| `T` | Plain note of length d → the next 2×d becomes a triplet group of 3; on a triplet note → back to 2 plain notes (see `toggleTriplet` in `bar.js`) |
| `-` | Shorten duration (one step) |
| `+` | Lengthen duration (one step) |
| `→` | Move cursor forward one note |
| `←` | Move cursor back one note |
| `↑` | Move cursor up one vertical slot |
| `↓` | Move cursor down one vertical slot |
| `Backspace` | Delete rest / convert drum hit to rest |
| `S` / `Shift`+`S` | Select the bar at the cursor / extend the selection to it (`score-a11y.js`) |
| `Space` | Play / stop (`app.js`) |
| `⌘Z` / `⇧⌘Z` | Undo / redo (Edit menu; inside a text field they edit the text instead) |
| `⌘N` `⌘O` `⌘S` `⇧⌘S` | New, Open, Save, Save As (File menu) |

---

## 8. `js/menu.js` — Side Menu

Holds the two import buttons (choosing one closes the menu) and one setting: **bars per line**. Insights, Ask DrumHub, Library and Practice open from the round bot button at the bottom right (`#panel-btn`).

```
User types a number in the input
→ parse as integer
→ valid range: 2–8
→ if invalid: show warning, clear input
→ if valid:   state.barsPerRow = val, render()
```

Menu open/close uses Tailwind's `-translate-x-full` / `translate-x-0` classes for the slide animation. The backdrop div catches outside clicks to close the menu. While closed the menu is `inert` (Tab skips it); opening focuses the input and Escape closes it.

---

## Data Flow — The Golden Rule

```
User action  (keyboard / keypad / import / details / Edit menu)
      ↓
a command from commands.js  →  dispatch()  in editor-store.js
      ↓
execute() returns a NEW editor (ids filled, revision + 1, history entry)
      ↓
render()  reads  state  →  draws SVG   (on error the previous editor is restored)
      ↓
listeners: details bar, window title, autosave
```

**`score.js` never writes to `state`.**
**Only `editor-store.js` replaces `state.editor`.** `menu.js` still sets `barsPerRow` (a view setting).
**`input.js` never touches the DOM directly** (except the keypad button flash).

---

## 9. Commands, undo, and score files

### `js/commands.js`

A command is `{ label, run(editor) }`; `run` returns the changed parts
(`{ bars?, meta?, cursor? }`) or `null` when refused. `execute(editor, command)`:

- refused → returns the **same** editor (no re-render)
- cursor-only change → new cursor, **no** revision or history change
- score change → fills missing ids, `revision + 1`, pushes an undo entry (max 200), clears redo

`undo`/`redo` put back the exact earlier bars, metadata and cursor, but the revision still
goes **up**. Later agent answers are tied to a revision, so a revision number never means
two different scores.

`isDirty(editor)` compares with the last saved/opened score by object identity (undo
restores the same objects), so undoing back to the saved score clears the unsaved marker.

### `js/score-document.js`

The saved file is `{ schemaVersion: 1, scoreId, revision, title, tempoBpm, meter, bars }`
as human-readable JSON (`.drumhub.json`). `validateDocument` returns plain-language
problems: unknown fields, bad ids/duplicates, provenance, unknown drums/durations, dotted
32nds, broken triplet groups, and bars that overfill their meter. Any valid meter can be
saved and opened, but only 4/4 is editable: other meters open **view-only**
(`isReadOnly` in `commands.js` refuses every score change; the cursor still moves).
`parseDocument` migrates an old `{ bars }`-only export and refuses files from a newer
DrumHub without changing them.

### Electron main: `desktop/score-files.cjs`, `score-session.cjs`, `score-ipc.cjs`

- The page never touches the disk. It sends a document; main chooses the path with a
  native dialog and validates the document again before writing.
- Save writes a temporary file, flushes it, then renames it over the target, so a crash
  leaves either the old file or the new one.
- If the file changed or disappeared since it was opened, Save asks: Save As / Replace / Cancel.
  The file is checked again immediately before the rename; a change found then asks again.
- Autosave (1 s after an edit) writes a **recovery copy** in the app's data folder, never
  over the user's file. On launch, DrumHub offers to restore it. Save or "Don't Save" removes it.
- Closing or quitting with unsaved changes asks Save / Don't Save / Cancel. Only main can
  close past that prompt (after its own Save succeeds) or delete a recovery copy (after
  "Don't Save"); the page cannot do either by itself.
- Save to the already-linked file requires the same `scoreId`; a different score goes
  through Save As. File operations in main run one at a time.
- Scores inside the editor are frozen (`commands.js`). Build new objects; never edit in place.

---

## 10. Ask DrumHub

```
agent-ui.js → ask-request.js (scope + snapshot) → preload window.agent.ask
  → desktop/agent-ipc.cjs → desktop/score-agent.cjs
       validate request + snapshot (score-snapshot.js)
       cloud help off / no key → offline-answers.js
       cloud help on → OpenAI (desktop/openai-client.cjs, OPENAI_AGENT_MODEL)
            ↔ tool calls run locally (agent-tools.js → score-analysis.js)
       checkAnswer (agent-contract.js) → one repair round → else offline fallback
       finalizeAnswer adds bar ids + caveats written by code
  → agent-ui.js shows answer, bar buttons (followCitation), caveats, follow-ups
```

- **Cloud help is off by default.** Turning it on shows an adult-only confirmation and is
  saved in `settings.json` in the app data folder (`desktop/app-settings.cjs`). The same
  switch gates the Luna screenshot import.
- The model never sees the title, import warning text, or notes except through tool results.
- An answer is rejected if it cites bars the tools were not given, mentions bar numbers
  without references, or claims accents, sticking, dynamics, ornaments, ties, repeat signs
  or hands/feet (a sentence saying the score doesn't show them is fine).
- Warnings about unchecked imported bars and partial scores are added by code every time.
- Limits: 500-character questions, one at a time, 1.5 s between cloud questions, 100 per day.

---

## 11. Page and PDF import

```
Import page or PDF… → main: dialog → service POST /segment (backend/page_segment.py)
  → desktop/page-import.cjs saves page PNGs + suggested boxes (userData/page-imports/<job>)
  → review screen: draw / move / resize / remove boxes; numbers = reading order (page-boxes.js)
  → Read (keyboard: arrows move a box, Alt+arrows resize, Delete removes, Add box): main crops each box (nativeImage) → local model (predictData) or Luna
       results saved one by one; a failed box can be retried alone; moving a box redoes it
  → Add bars to score: importBarsCommand in reading order; failed boxes can become
       empty unchecked bars so the order stays right; the job folder is deleted
```

An import that was opened but not added is offered again (Resume / Discard) the next
time the app starts. Luna needs cloud help on, like screenshot import.

---

## 12. Playback, library, practice, packaging

- **Playback:** `playback-schedule.js` turns the score into exact times (pure, tested);
  `playback-engine.js` schedules them a little ahead on the AudioContext clock and moves the
  note highlight (`showPlayhead` in `score.js`); `drum-synth.js` makes the sounds.
- **Library and Fill Lab:** everything offline comes from `exercise-catalogue.js` and
  `exercise-search.js`. Generating a new fill needs cloud help (`fill-generator.cjs`).
- **Practice:** SQLite in main (`practice-store.cjs`); the page only calls the small
  `window.practice` API. Teacher summaries send counts and tempos, never names or notes.
- **Cloud safety:** every OpenAI call goes through `openai-client.cjs`, which asks
  `cloud-budget.cjs` first (monthly limit, per-minute limit) and records usage and health.
- **Accessibility:** the score has a hidden word list (`score-description.js`), keypad keys
  are buttons, dialogs keep focus inside and return it on close. Global key handlers ignore
  keys typed into inputs, buttons and open dialogs — keep that guard when adding shortcuts.
- **Packaging:** `npm run dist:dir` builds `dist/mac-arm64/DrumHub.app` with electron-builder.
  Only `dependencies` (dotenv, vexflow) ship; everything else must stay in `devDependencies`.
  `backend/` is unpacked beside `app.asar` and the model release is copied to
  `Resources/model` (`main.js` picks those paths when `app.isPackaged`). Python is not bundled.

---

## Adding a New Drum Sound

The editor's drums must match the OMR model's drum list, so a new drum starts in
`ml/omr/training_contract.py` (and needs a retrained model) — `npm test` fails until
both lists agree.

1. Open `js/constants.js`
2. Add an entry to `DRUMS`, using the model's drum name:
   ```js
   cowbell: { vexKey: 'a/5', head: 'tu', stemDir: 1, cursorPos: 9 },
   ```
3. Give it a key in `KEY_DRUMS` or `SHIFT_KEY_DRUMS`, and a label in the keypad in `index.html`
4. Look up the correct `vexKey` in VexFlow's pitch reference — format is `note/octave` e.g. `'a/5'`, `'e/5'`, `'c/5'`. No two drums may share both position and head.

---

## Common Gotchas

| Gotcha | Explanation |
|---|---|
| `dots: 1` in StaveNote constructor does nothing in VexFlow 5 | Use `Dot.buildAndAttach([sn], { all: true })` instead |
| Beams must be generated before `voice.draw()` | Otherwise flags are drawn first and show through the beams |
| Notes have no position field | Order in `bar.notes[]` IS position. Never sort this array. |
| Auto-rests are never dotted | A dotted auto-rest would claim 1.5× ticks and break all subsequent navigation |
| `barTicks` must be checked before every duration change | VexFlow SOFT mode won't error on overflow — the app enforces bar capacity manually |
| `cursor.noteIndex` maps directly to `cursorTickables[]` | They are built from the same array in the same order — no searching needed |
