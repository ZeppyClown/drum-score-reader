// ── App state ─────────────────────────────────────────────────────────────────
// Single source of truth for everything that changes while the app runs.
//
// editor: the score being edited — metadata, bars, cursor, undo history, and the
//   last-saved snapshot (see commands.js). Only editor-store.js replaces it, always
//   with a new object from commands.js; nothing edits it in place.
//
// bars (read-only view of editor.bars): array of bar objects, each with an ORDERED
//   array of note objects. Notes have no beat/position field — their order in the
//   array IS their position. VexFlow reads them in sequence and handles timing.
//
//   Each bar  = { barId, provenance, notes }   (provenance: see score-document.js)
//   Each note = {
//     eventId:  stable id, kept through edits (see score-document.js)
//     duration: VexFlow duration string — '32' | '16' | '8' | 'q' | 'h' | 'w'
//     dotted:   true if the note is dotted (duration × 1.5)
//     triplet:  optional; true for each of three same-duration notes that take
//               the time of two (bar.js tripletStarts finds the groups)
//     drums:    drum names from DRUMS in constants.js, e.g. ['kick', 'hi_hat_closed'].
//               Several names are a chord; an empty array is a rest.
//   }
//   Staff position, notehead shape, and stem direction are derived from the drum
//   names at render time (notation.js), so they are never stored on the note.
//
// cursor (read-only view of editor.cursor):
//   barIndex:  which bar the cursor is in (0-based index into bars)
//   noteIndex: which note within the bar the cursor is on (index into bar.notes)
//   position:  vertical slot for the cursor square (1 = bottom, 10 = near top)
//
// barsPerRow: how many bars to draw per line (changed via the side menu, 2–8).
//   A view setting, so it is not part of the saved score or undo history.
import { createEditor } from './commands.js';
import { createMeta } from './score-document.js';

export const state = {
  editor:     createEditor({ meta: createMeta(), bars: [{ notes: [] }] }),
  barsPerRow: 4,
  get bars()   { return this.editor.bars; },
  get cursor() { return this.editor.cursor; },
};
