// ── A score in words ─────────────────────────────────────────────────────────
// Plain-language bar descriptions for screen readers (score-a11y.js shows them).
// Pure, tested in Node.

import { resolveSelection } from './selection.js';

export const DRUM_NAMES = Object.freeze({
  kick: 'kick', hi_hat_pedal: 'pedal hi-hat', floor_tom_2: 'low floor tom', floor_tom_1: 'floor tom',
  snare: 'snare', snare_rim: 'side stick', tom_mid: 'mid tom', tom_hi: 'high tom',
  hi_hat_closed: 'closed hi-hat', hi_hat_open_half: 'half-open hi-hat', hi_hat_open_full: 'open hi-hat',
  crash: 'crash', ride: 'ride', ride_bell: 'ride bell',
});

// One bar in plain words. `selected` and `current` are booleans from the editor.
export function describeBar(bar, index, { selected = false, current = false } = {}) {
  const hits = bar.notes.filter(note => note.drums.length > 0);
  const drums = [...new Set(hits.flatMap(note => note.drums))].map(d => DRUM_NAMES[d] ?? d.replaceAll('_', ' '));
  const flags = [current && 'cursor here', selected && 'selected'].filter(Boolean);
  const head = `Bar ${index + 1}${flags.length ? ` (${flags.join(', ')})` : ''}`;
  const body = hits.length === 0 ? 'rests only'
    : `${hits.length} ${hits.length === 1 ? 'note' : 'notes'} — ${drums.join(', ')}`;
  const review = bar.provenance?.reviewed === false ? '; imported, not checked yet' : '';
  return `${head}: ${body}${review}`;
}

export function describeScore(editor) {
  const range = resolveSelection(editor);
  const inRange = index => Boolean(range) && index >= range.fromIndex && index <= range.toIndex;
  return editor.bars.map((bar, index) =>
    describeBar(bar, index, { selected: inRange(index), current: index === editor.cursor.barIndex }));
}
