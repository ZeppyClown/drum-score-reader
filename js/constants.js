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
// '32'  = demisemiquaver  32nd note
// '16'  = semiquaver      16th note
// '8'   = quaver          8th note      ← NOTE: 'q' is NOT quaver
// 'q'   = crotchet        quarter note  ← 'q' stands for "quarter", not quaver
// 'h'   = minim           half note
// 'w'   = semibreve       whole note
//
// Rests use the same strings with 'r' appended: 'qr' = crotchet rest, '8r' = quaver rest.
// Triplets are not separate strings: a note with `triplet: true` keeps its written
// duration and lasts 2/3 as long (three triplet eighths fill a quarter).
export const DURATIONS = ['32', '16', '8', 'q', 'h', 'w'];

// ── Tick system ───────────────────────────────────────────────────────────────
// Instead of storing beats as 1/2/3/4, we use "ticks" so every supported note
// lands on a whole number. 48 ticks per crotchet is the smallest scale where
// 32nds (6), triplet eighths (16), triplet 16ths (8), and dotted 16ths (18) are
// all whole numbers. A 4/4 bar has 192 ticks.
//
// DUR_TICKS maps a VexFlow duration string → how many ticks that note takes.
//   e.g. a crotchet (q) takes 48 ticks, a quaver (8) takes 24.
// BAR_TICKS: total ticks in one bar (4 crotchets × 48 ticks = 192)
export const DUR_TICKS = { '32': 6, '16': 12, '8': 24, 'q': 48, 'h': 96, 'w': 192 };
export const BAR_TICKS = 192;

// ── Keys that trigger drum notes ──────────────────────────────────────────────
// The numpad keys 0-9 and '.' are all intercepted for drum input.
// '.' is special — it toggles a dot on the current note rather than placing one.
// Shift + 0, 4, 6 or 9 enters the four extra drums (see SHIFT_KEY_DRUMS).
export const DRUM_KEYS = new Set(['0','1','2','3','4','5','6','7','8','9','.']);

// ── Drum definitions ──────────────────────────────────────────────────────────
// One entry per drum the OMR model reads, keyed by the model's own drum name, so
// imported notes need no translation. A note lists these names in `note.drums`.
//   vexKey:    VexFlow pitch string that positions the notehead on the staff
//              (percussion stave uses treble-clef positions visually)
//   head:      notehead shape: 'n' normal, 'x' x-head, 'cx' circle-x,
//              'h' diamond, 'tu' triangle
//   stemDir:   1 = stem up, -1 = stem down (a chord is stem-down only if every drum is)
//   cursorPos: which vertical slot (1-10) the cursor snaps to after placing this drum
//              (maps to stave pixel: getYForLine(4) - cursorPos * 5px)
export const DRUMS = {
  kick:             { vexKey: 'c/4', head: 'n',  stemDir: -1, cursorPos: 1  },  // bass drum
  hi_hat_pedal:     { vexKey: 'd/4', head: 'x',  stemDir: -1, cursorPos: 1  },
  floor_tom_2:      { vexKey: 'g/4', head: 'n',  stemDir: -1, cursorPos: 2  },  // low floor tom
  floor_tom_1:      { vexKey: 'a/4', head: 'n',  stemDir: -1, cursorPos: 3  },
  snare:            { vexKey: 'c/5', head: 'n',  stemDir:  1, cursorPos: 5  },
  snare_rim:        { vexKey: 'c/5', head: 'x',  stemDir:  1, cursorPos: 5  },  // side stick
  tom_mid:          { vexKey: 'd/5', head: 'n',  stemDir:  1, cursorPos: 6  },
  tom_hi:           { vexKey: 'e/5', head: 'n',  stemDir:  1, cursorPos: 7  },
  hi_hat_closed:    { vexKey: 'f/5', head: 'x',  stemDir:  1, cursorPos: 8  },
  hi_hat_open_half: { vexKey: 'f/5', head: 'tu', stemDir:  1, cursorPos: 8  },  // triangle
  hi_hat_open_full: { vexKey: 'f/5', head: 'cx', stemDir:  1, cursorPos: 8  },  // circle-x
  crash:            { vexKey: 'a/5', head: 'x',  stemDir:  1, cursorPos: 9  },
  ride:             { vexKey: 'b/5', head: 'x',  stemDir:  1, cursorPos: 10 },
  ride_bell:        { vexKey: 'b/5', head: 'h',  stemDir:  1, cursorPos: 10 },  // diamond
};

// Number / keypad key → drum (the original 10-key layout).
export const KEY_DRUMS = {
  '0': 'kick',     '1': 'crash',            '2': 'tom_hi',
  '3': 'tom_mid',  '4': 'hi_hat_open_full', '5': 'snare_rim',
  '6': 'floor_tom_1', '7': 'hi_hat_closed', '8': 'snare', '9': 'ride',
};

// Shift + key → the extra drum related to that key's drum.
export const SHIFT_KEY_DRUMS = {
  '0': 'hi_hat_pedal', '4': 'hi_hat_open_half', '6': 'floor_tom_2', '9': 'ride_bell',
};
