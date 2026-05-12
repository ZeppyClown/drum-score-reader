// ── Layout ────────────────────────────────────────────────────────────────────
// STAVE_X: left margin before the first bar starts (in pixels)
// STAVE_Y0: top margin before the first row of bars starts (in pixels)
// ROW_HEIGHT: vertical distance between each row of bars (pixels)
// BAR_WIDTH: fallback/minimum width for a bar — actual width is calculated
//            dynamically based on how many notes are in the bar (see score.js)
export const STAVE_X    = 10;
export const STAVE_Y0   = 30;
export const ROW_HEIGHT = 110;
export const BAR_WIDTH  = 200;

// ── Cursor ────────────────────────────────────────────────────────────────────
// POSITIONS: how many vertical slots the cursor can sit in (1 = bottom, 10 = top)
//            Each slot is 5px apart, mapping to different staff positions (e.g. snare, hi-hat)
// SPACE: the width and height of the blue cursor square in pixels
export const POSITIONS = 10;
export const SPACE     = 10;

// ── Duration ladder (shortest → longest) ─────────────────────────────────────
// VexFlow duration strings, ordered so that + and - keys walk up and down.
//
// String  British name   American name
// '16'  = semiquaver      16th note
// '8'   = quaver          8th note      ← NOTE: 'q' is NOT quaver
// 'q'   = crotchet        quarter note  ← 'q' stands for "quarter", not quaver
// 'h'   = minim           half note
// 'w'   = semibreve       whole note
//
// Rests use the same strings with 'r' appended: 'qr' = crotchet rest, '8r' = quaver rest.
export const DURATIONS = ['16', '8', 'q', 'h', 'w'];

// ── Tick system ───────────────────────────────────────────────────────────────
// Instead of storing beats as 1/2/3/4, we use "ticks" so that quavers and
// semi-quavers can land at exact sub-beat positions.
// 1 semi-quaver = 1 tick.  A 4/4 bar has 16 ticks total.
//
// DUR_TICKS maps a VexFlow duration string → how many ticks that note takes.
//   e.g. a crotchet (q) takes 4 ticks, so the next note lands at beat + 4.
//        a quaver (8) takes 2 ticks, next note at beat + 2.
// BAR_TICKS: total ticks in one bar (4 crotchets × 4 ticks = 16)
export const DUR_TICKS = { '16': 1, '8': 2, 'q': 4, 'h': 8, 'w': 16 };
export const BAR_TICKS = 16;

// ── Keys that trigger drum notes ──────────────────────────────────────────────
// The numpad keys 0-9 and '.' are all intercepted for drum input.
// '.' is special — it toggles a dot on the current note rather than placing one.
export const DRUM_KEYS = new Set(['0','1','2','3','4','5','6','7','8','9','.']);

// ── Drum definitions ──────────────────────────────────────────────────────────
// Each key on the numpad maps to a drum sound definition:
//   vexKey:    the VexFlow pitch string used to position the notehead on the staff
//              (percussion stave uses treble-clef positions visually)
//   stemDir:   1 = stem goes up, -1 = stem goes down
//   cursorPos: which vertical slot (1-10) the cursor snaps to after placing this note
//
// Only snare ('8') is defined so far. Other keys (0,1,2,3,4,5,6,7,9) need
// entries added here before they will produce notes.
export const DRUM_DEFS = {
  '8': { vexKey: 'c/5', stemDir:  1, cursorPos: 5 },  // snare
};
