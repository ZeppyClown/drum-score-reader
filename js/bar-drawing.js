// ── Drawing one bar's notes with VexFlow ─────────────────────────────────────
// Shared by the main score (score.js) and small notation previews (Library, Fill Lab),
// so a preview looks exactly like the same bar in the score. VexFlow is read from the
// global only when drawing, so this file can be imported in Node tests.

import { isRest, tripletStarts } from './bar.js';
import { noteKeys, noteStemDir } from './notation.js';

const vexflow = () => globalThis.VexFlow;

// VexFlow tickables for a bar, in order. Rests get an 'r' duration; each drum in a
// chord carries its own notehead (notation.js); dots are attached after construction
// because VexFlow 5 dropped the `dots` option.
function buildTickables(bar) {
  const { StaveNote, Dot } = vexflow();
  return bar.notes.map(note => {
    const duration = note.duration ?? 'q';
    const staveNote = isRest(note)
      ? new StaveNote({ clef: 'percussion', keys: noteKeys(note), duration: `${duration}r` })
      : new StaveNote({ clef: 'percussion', keys: noteKeys(note), duration, stemDirection: noteStemDir(note) });
    if (note.dotted) Dot.buildAndAttach([staveNote], { all: true });
    return staveNote;
  });
}

// Draws a bar's notes on an already drawn stave and returns the tickables (for cursor
// and playback positions). meter = { beats, beatUnit }.
export function drawBarNotes(ctx, stave, bar, meter) {
  if (!bar.notes.length) return [];
  const { Voice, Formatter, Beam, Fraction, Tuplet } = vexflow();
  const tickables = buildTickables(bar);
  // Triplets are attached before the voice counts ticks (each shortens 3 notes to 2/3).
  const tuplets = tripletStarts(bar).map(start =>
    new Tuplet(tickables.slice(start, start + 3), { numNotes: 3, notesOccupied: 2 }));
  // SOFT: a bar still being edited may not add up to a full bar yet.
  const voice = new Voice({ numBeats: meter.beats, beatValue: meter.beatUnit });
  voice.setMode(Voice.Mode.SOFT);
  voice.addTickables(tickables);
  // Beams before voice.draw(), or flags are drawn under them. maintainStemDirections keeps
  // hands up and feet down; one beam group per quarter beat joins dotted-8th + 16th.
  const beams = Beam.generateBeams(tickables, { maintainStemDirections: true, groups: [new Fraction(1, 4)] });
  const noteWidth = stave.getX() + stave.getWidth() - stave.getNoteStartX() - 15;
  new Formatter().joinVoices([voice]).format([voice], noteWidth);
  voice.draw(ctx, stave);
  beams.forEach(beam => beam.setContext(ctx).draw());
  tuplets.forEach(tuplet => tuplet.setContext(ctx).draw());
  return tickables;
}

// A small drawing of one or more bars inside `container`, wrapping to new lines when the
// bars don't fit `maxWidth`. Returns false (and draws nothing) when VexFlow isn't loaded.
export function renderBarsPreview(container, bars, { meter = { beats: 4, beatUnit: 4 }, maxWidth = 360 } = {}) {
  if (!vexflow()) return false;
  const { Renderer, Stave } = vexflow();
  const STAVE_HEIGHT = 120;
  const MARGIN = 10;
  const widthOf = (bar, first) => Math.max(first ? 200 : 150, bar.notes.length * 24 + (first ? 80 : 30));
  const rows = [];
  for (const bar of bars) {
    const row = rows.at(-1);
    const used = row ? row.reduce((sum, item) => sum + item.width, 0) : 0;
    if (row && used + widthOf(bar, false) <= maxWidth - 2 * MARGIN) row.push({ bar, width: widthOf(bar, false) });
    else rows.push([{ bar, width: widthOf(bar, true) }]);  // a new line starts with the clef
  }
  const width = Math.max(...rows.map(row => row.reduce((sum, item) => sum + item.width, 0))) + 2 * MARGIN;
  const height = rows.length * STAVE_HEIGHT + 10;
  const renderer = new Renderer(container, Renderer.Backends.SVG);
  renderer.resize(width, height);
  const ctx = renderer.getContext();
  rows.forEach((row, r) => {
    let x = MARGIN;
    row.forEach((item, i) => {
      const stave = new Stave(x, 10 + r * STAVE_HEIGHT, item.width);
      if (i === 0) stave.addClef('percussion');
      if (r === 0 && i === 0) stave.addTimeSignature(`${meter.beats}/${meter.beatUnit}`);
      stave.setContext(ctx).draw();
      drawBarNotes(ctx, stave, item.bar, meter);
      x += item.width;
    });
  });
  const svg = container.querySelector('svg');
  // Scale down with the panel instead of overflowing it.
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.style.maxWidth = '100%';
  svg.style.height = 'auto';
  return true;
}
