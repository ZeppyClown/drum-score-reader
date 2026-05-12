// ── App state ─────────────────────────────────────────────────────────────────
// Single source of truth for everything that changes while the app runs.
//
// bars: array of bar objects, each with an ORDERED array of note objects.
//   Notes have no beat/position field — their order in the array IS their position.
//   VexFlow reads them in sequence and handles timing from their durations.
//
//   Each note = {
//     duration: VexFlow duration string — '16' | '8' | 'q' | 'h' | 'w'
//     dotted:   true if the note is dotted (duration × 1.5)
//     vexKey:   VexFlow pitch string, e.g. 'c/5' for snare positioning on staff
//     stemDir:  1 = stem up, -1 = stem down
//     isRest:   true if this slot is a rest rather than a drum hit
//   }
//
// cursor:
//   barIndex:  which bar the cursor is in (0-based index into state.bars)
//   noteIndex: which note within the bar the cursor is on (index into bar.notes)
//   position:  vertical slot for the cursor square (1 = bottom, 10 = near top)
//
// barsPerRow: how many bars to draw per line (changed via the side menu, 2–8)
export const state = {
  bars:       [{ notes: [] }],
  cursor:     { barIndex: 0, noteIndex: 0, position: 1 },
  barsPerRow: 4,
};
