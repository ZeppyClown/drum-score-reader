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
│   ├── layout.js       ← 5. Bar position math (pixel coords)
│   ├── score.js        ← 6. Rendering — turns state into SVG via VexFlow
│   ├── notation.js     ← 6. Drum names → VexFlow keys, noteheads, stem direction (pure)
│   ├── bar.js          ← 7. Pure editing rules — capacity, place, dot, duration, triplets, cursor moves
│   ├── input.js        ← 7. Wires keyboard + keypad to bar.js and stores results in state
│   └── import.js       ← OMR service /predict notes → one editable bar (pure; not wired to the UI yet)
├── js/menu.js          ← 8. Side menu (bars-per-line setting only)
└── test/*.test.mjs     ← Node tests for bar.js, notation.js, import.js — run with `npm test`
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

**This is the single source of truth.** Every file that needs to read or change app data imports `state` from here.

```js
state = {
  bars:       [ { notes: [...] }, { notes: [...] }, ... ],
  cursor:     { barIndex: 0, noteIndex: 0, position: 1 },
  barsPerRow: 4,
}
```

### `state.bars`

An array of bar objects. Each bar has one property:

```js
bar = {
  notes: [ note, note, note, ... ]   // ordered array — order IS position
}
```

**There is no beat or position field on notes.** The first note in the array is the first note in the bar. VexFlow reads them in sequence and handles timing from durations.

### Note object shape

```js
{
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

---

## 8. `js/menu.js` — Side Menu

Handles only one setting: **bars per line**.

```
User types a number in the input
→ parse as integer
→ valid range: 2–8
→ if invalid: show warning, clear input
→ if valid:   state.barsPerRow = val, render()
```

Menu open/close uses Tailwind's `-translate-x-full` / `translate-x-0` classes for the slide animation. The backdrop div catches outside clicks to close the menu.

---

## Data Flow — The Golden Rule

```
User action  (keyboard / keypad / menu)
      ↓
input.js / menu.js  mutates  state
      ↓
render()  reads  state  →  draws SVG
      ↓
Screen updates
```

**`score.js` never writes to `state`.**
**`input.js` never touches the DOM directly** (except the keypad button flash).
**`state.js` is dumb** — it just exports the object, it has no methods.

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
