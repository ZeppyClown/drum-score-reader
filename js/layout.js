import { STAVE_X, STAVE_Y0, ROW_HEIGHT, BAR_WIDTH } from './constants.js';
import { state } from './state.js';

export function barCol(i) { return i % state.barsPerRow; }
export function barRow(i) { return Math.floor(i / state.barsPerRow); }
export function barX(i)   { return STAVE_X + barCol(i) * BAR_WIDTH; }
export function barY(i)   { return STAVE_Y0 + barRow(i) * ROW_HEIGHT; }

// p = cursor position slot (1 = bottom space, 10 = above top line)
// Anchors to the real bottom staff line via VexFlow's own geometry method.
export function cursorCentreY(stave, p) {
  return stave.getYForLine(4) - p * 5;
}
