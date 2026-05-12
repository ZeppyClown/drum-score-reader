// ── Layout ────────────────────────────────────────────────────────────────────
export const STAVE_X    = 10;
export const STAVE_Y0   = 30;
export const ROW_HEIGHT = 110;
export const BAR_WIDTH  = 200;

// ── Cursor ────────────────────────────────────────────────────────────────────
export const POSITIONS = 10;  // number of vertical cursor slots
export const SPACE     = 10;  // cursor square size in px

// ── Keys that trigger drum notes ──────────────────────────────────────────────
export const DRUM_KEYS = new Set(['0','1','2','3','4','5','6','7','8','9','.']);

// ── Drum definitions ──────────────────────────────────────────────────────────
// vexKey: treble-clef pitch used for percussion stave positioning
// stemDir: 1 = up, -1 = down
// cursorPos: which vertical slot the cursor snaps to after placing the note
export const DRUM_DEFS = {
  '8': { vexKey: 'c/5', stemDir:  1, cursorPos: 5 },  // snare
};
