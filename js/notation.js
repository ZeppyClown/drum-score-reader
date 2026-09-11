// ── Drum notes → VexFlow notation ─────────────────────────────────────────────
// Pure helpers used by score.js to draw a note's chord. They have no VexFlow or
// DOM dependency, so the notation rules can be tested in Node.

import { DRUMS } from './constants.js';

// A rest is drawn centred on the middle line.
export const REST_KEY = 'b/4';

// VexFlow key for one drum. A normal head is just the pitch ('c/5'); any other
// shape is added as a per-key glyph code ('f/5/x'), so one chord can mix shapes.
export function drumKey(drumId) {
  const drum = DRUMS[drumId];
  if (!drum) throw new Error(`Unknown drum: ${drumId}`);
  return drum.head === 'n' ? drum.vexKey : `${drum.vexKey}/${drum.head}`;
}

// Every key for a note's chord (a rest has the single rest key).
export function noteKeys(note) {
  return note.drums.length > 0 ? note.drums.map(drumKey) : [REST_KEY];
}

// Stems point down only when every drum in the chord is a stem-down (foot/floor) drum.
export function noteStemDir(note) {
  return note.drums.length > 0 && note.drums.every(id => DRUMS[id].stemDir === -1) ? -1 : 1;
}
