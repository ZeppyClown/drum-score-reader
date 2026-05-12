import { STAVE_X, STAVE_Y0, ROW_HEIGHT, BAR_WIDTH } from './constants.js';
import { state } from './state.js';

// ── Bar grid position helpers ─────────────────────────────────────────────────
// Bars are arranged in a grid: barsPerRow columns, as many rows as needed.

// barRow: which row (0-based) bar i sits in
export function barRow(i) { return Math.floor(i / state.barsPerRow); }
// barCol: which column (0-based) bar i sits in
export function barCol(i) { return i % state.barsPerRow; }


// barX / barY: pixel position of the top-left corner of bar i.
// Note: score.js overrides barX with a dynamic version that accounts for
// variable bar widths. These simple versions assume a fixed BAR_WIDTH.
export function barX(i) { return STAVE_X + barCol(i) * BAR_WIDTH; }
export function barY(i) { return STAVE_Y0 + barRow(i) * ROW_HEIGHT; }

// ── Cursor vertical position ──────────────────────────────────────────────────
// p = cursor position slot (1 = bottom space, 10 = above top line)
//
// We anchor to VexFlow's real bottom staff line using stave.getYForLine(4).
// Line 4 is the bottom line of a 5-line staff (lines are 0=top … 4=bottom).
// Each position slot is 5px above the previous one.
//
// Why use getYForLine(4) instead of barY(i)?
// VexFlow internally adds padding and offsets to place staff lines, so the
// actual pixel position of the staff doesn't match our raw STAVE_Y0 value.
// Using VexFlow's own geometry method keeps the cursor aligned with the staff.
export function cursorCentreY(stave, p) {
  return stave.getYForLine(4) - p * 5;
}
