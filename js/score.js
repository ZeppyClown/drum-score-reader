import { STAVE_X, STAVE_Y0, ROW_HEIGHT, SPACE } from './constants.js';
import { state } from './state.js';
import { barRow, barCol, barY, cursorCentreY } from './layout.js';
import { isRest, tripletStarts } from './bar.js';
import { noteKeys, noteStemDir } from './notation.js';
import { needsReview } from './review.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Destructure the VexFlow classes we need from the global VexFlow object.
// VexFlow is loaded as a CJS bundle via <script> in index.html, so it's a global.
const { Renderer, Stave, StaveNote, Voice, Formatter, Beam, Dot, Fraction, Tuplet } = VexFlow;

// The div where the entire score SVG is rendered
const div = document.getElementById('score');

// ── Bar width calculation ─────────────────────────────────────────────────────
// Each bar is wide enough to fit all its notes without overlap.
// PX_PER_NOTE: pixels allocated per note (notehead width + stem clearance)
// MIN_BAR_WIDTH: minimum bar width even if the bar is empty
// clefPad: the first bar in each row needs extra space for the clef symbol
const PX_PER_NOTE   = 30;
const MIN_BAR_WIDTH = 200;

function barWidth(bar, i) {
  const clefPad = barCol(i) === 0 ? 70 : 35;
  return Math.max(MIN_BAR_WIDTH, bar.notes.length * PX_PER_NOTE + clefPad);
}

// ── X position of a bar ───────────────────────────────────────────────────────
// Because bar widths are dynamic, we can't multiply by a fixed width.
// Instead we sum up the widths of all preceding bars in the same row.
// widths: pre-computed array of bar widths (one entry per bar)
function getBarX(i, widths) {
  let x = STAVE_X;
  const rowStart = barRow(i) * state.barsPerRow;  // index of the first bar on this row
  for (let j = rowStart; j < i; j++) x += widths[j];
  return x;
}

// ── Build VexFlow tickable objects from a bar's notes ─────────────────────────
// VexFlow needs an array of StaveNote objects in beat order.
// A "tickable" is VexFlow's term for any object that takes up time (note or rest).
//
// For rests: duration string gets 'r' appended (e.g. 'qr' = crotchet rest).
//            key is always 'b/4' which centres the rest on the middle line.
// For drum notes: one key per drum in the chord, each carrying its own notehead
//            shape (see notation.js), and one shared stem from noteStemDir().
// In VexFlow 5 the `dots` constructor option was removed — we must call
// Dot.buildAndAttach() after construction to attach the dot modifier visually.
// Notes are already in order (the array IS the sequence), so no sorting needed.
function buildTickables(bar) {
  return bar.notes.map(note => {
    const dur = note.duration ?? 'q';
    let sn;
    if (isRest(note)) {
      sn = new StaveNote({ clef: 'percussion', keys: noteKeys(note), duration: dur + 'r' });
    } else {
      sn = new StaveNote({
        clef:           'percussion',
        keys:           noteKeys(note),
        duration:       dur,
        stemDirection:  noteStemDir(note),  // VexFlow 5 reads camelCase; stem_direction is ignored
      });
    }
    if (note.dotted) {
      Dot.buildAndAttach([sn], { all: true });
    }
    return sn;
  });
}

// ── Main render function ──────────────────────────────────────────────────────
// Called after every state change. Wipes the SVG and redraws everything from scratch.
export function render() {
  div.innerHTML = '';  // clear previous SVG

  // Pre-compute every bar's pixel width so we can position them correctly
  const widths  = state.bars.map((bar, i) => barWidth(bar, i));
  const numRows = Math.ceil(state.bars.length / state.barsPerRow);

  // Find the widest row so we can size the canvas correctly.
  // Each row's total width = left margin + sum of bar widths in that row.
  let maxRowW = 0;
  for (let row = 0; row < numRows; row++) {
    let w = STAVE_X * 2;
    for (let col = 0; col < state.barsPerRow; col++) {
      const idx = row * state.barsPerRow + col;
      w += idx < state.bars.length ? widths[idx] : MIN_BAR_WIDTH;
    }
    maxRowW = Math.max(maxRowW, w);
  }

  const totalHeight = STAVE_Y0 + numRows * ROW_HEIGHT + 40;

  // Create the VexFlow SVG renderer and size it to fit all rows
  const vfRenderer = new Renderer(div, Renderer.Backends.SVG);
  vfRenderer.resize(maxRowW, totalHeight);
  const ctx = vfRenderer.getContext();

  const staves = [];          // keep stave refs so we can look up cursor's stave later
  let cursorTickables = null; // VexFlow tickable objects for the bar the cursor is in

  state.bars.forEach((bar, i) => {
    // Create and draw the stave (the 5 horizontal staff lines for this bar)
    const stave = new Stave(getBarX(i, widths), barY(i), widths[i]);

    // First bar: show clef + time signature. First bar of each new row: show clef only.
    if (i === 0) {
      stave.addClef('percussion');
      const { beats, beatUnit } = state.editor.meta.meter;
      stave.addTimeSignature(`${beats}/${beatUnit}`);
    } else if (barCol(i) === 0) {
      stave.addClef('percussion');
    }
    stave.setContext(ctx).draw();
    staves.push(stave);

    if (bar.notes.length > 0) {
      const tickables = buildTickables(bar);

      // Triplets must be attached BEFORE the voice counts ticks: each Tuplet
      // shortens its three notes to 2/3 of their written length.
      const tuplets = tripletStarts(bar).map(start =>
        new Tuplet(tickables.slice(start, start + 3), { numNotes: 3, notesOccupied: 2 }));

      // Voice tells VexFlow the bar's meter (4 beats in 4/4 for every editable score).
      // SOFT mode means VexFlow won't throw an error if the notes don't add up
      // exactly to a full bar — useful while the user is still editing.
      const voice = new Voice({ numBeats: state.editor.meta.meter.beats, beatValue: state.editor.meta.meter.beatUnit });
      voice.setMode(Voice.Mode.SOFT);
      voice.addTickables(tickables);

      // ── Beam generation must happen BEFORE voice.draw() ──────────────────
      // When VexFlow draws a voice, it draws flags on 8th/16th notes.
      // Beam.generateBeams() suppresses those flags and replaces them with
      // beam bars connecting adjacent short notes.
      // If we called generateBeams() AFTER draw(), the flags would already
      // be drawn and visible underneath the beams.
      //
      // maintainStemDirections: keep each note's own stem (hands up, feet/floor
      //   toms down, from noteStemDir). Without it VexFlow re-picks every group's
      //   direction from pitch — even for unbeamed quarter notes — which drew snare
      //   stems down and kick stems up. A beam breaks where the direction changes.
      // groups: [new Fraction(1, 4)] tells VexFlow to form one beam group per
      //   quarter-note beat. This is what makes dotted-8th + 16th beam together:
      //   they fill exactly one beat (3 + 1 = 4 sixteenth-note ticks), so VexFlow
      //   keeps them in the same group instead of splitting at the dot boundary.
      const beams = Beam.generateBeams(tickables, {
        maintainStemDirections: true,
        groups: [new Fraction(1, 4)],
      });

      // Format: space the notes evenly across the available note area of the bar
      // (stave width minus the clef/time-sig area and a small right margin)
      const noteWidth = stave.getX() + stave.getWidth() - stave.getNoteStartX() - 15;
      new Formatter().joinVoices([voice]).format([voice], noteWidth);
      voice.draw(ctx, stave);

      // Draw the beam bars (connecting lines between beamed stems) after voice.draw()
      beams.forEach(b => b.setContext(ctx).draw());
      tuplets.forEach(t => t.setContext(ctx).draw());  // the "3" over each triplet

      // Remember the tickables for the bar the cursor is currently in,
      // so we can snap the cursor's x-position to the correct notehead below.
      if (i === state.cursor.barIndex) cursorTickables = tickables;
    }
  });

  // ── Draw the cursor ───────────────────────────────────────────────────────
  // The cursor is a small blue rectangle drawn on top of the VexFlow SVG.

  const cs = staves[state.cursor.barIndex];  // the stave the cursor lives in

  // cursor.noteIndex is a direct index into the bar's note array, which matches
  // the cursorTickables array 1-to-1. No beat-searching needed.
  const ni = state.cursor.noteIndex;
  const cx = (cursorTickables && ni < cursorTickables.length)
    ? cursorTickables[ni].getAbsoluteX() - SPACE / 2 + 4
    : cs.getNoteStartX() + 2;

  // cursorCentreY converts the cursor's position slot (1-10) to a pixel y using
  // VexFlow's actual staff geometry so it lines up with the correct staff line/space
  const cy  = cursorCentreY(cs, state.cursor.position) - SPACE / 2;
  const svg = div.querySelector('svg');

  drawBarOverlays(svg, staves);

  // Inject the cursor rectangle directly into the SVG DOM
  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('id',           'score-cursor');
  rect.setAttribute('x',            cx);
  rect.setAttribute('y',            cy);
  rect.setAttribute('width',        SPACE);
  rect.setAttribute('height',       SPACE);
  rect.setAttribute('fill',         'rgba(74,158,255,0.15)');
  rect.setAttribute('stroke',       '#4a9eff');
  rect.setAttribute('stroke-width', '1.5');
  rect.setAttribute('rx',           '2');
  svg.appendChild(rect);
}

// ── Bar overlays ──────────────────────────────────────────────────────────────
// Tinted boxes drawn BEHIND the notation (inserted first in the SVG): amber for
// imported bars that still need review. barBoxes keeps each bar's box so clicks can
// be mapped back to a bar (see barAt).
let barBoxes = [];

function box(stave) {
  const top = stave.getYForLine(0) - 14;
  return { x: stave.getX(), y: top, width: stave.getWidth(), height: stave.getYForLine(4) + 14 - top };
}

function overlayRect(svg, { x, y, width, height }, className) {
  const rect = document.createElementNS(SVG_NS, 'rect');
  Object.entries({ x, y, width, height, class: className, rx: 3 }).forEach(([k, v]) => rect.setAttribute(k, v));
  svg.insertBefore(rect, svg.firstChild);
  return rect;
}

function drawBarOverlays(svg, staves) {
  barBoxes = staves.map(box);
  state.bars.forEach((bar, i) => {
    if (!needsReview(bar)) return;
    overlayRect(svg, barBoxes[i], 'bar-unreviewed');
    const label = document.createElementNS(SVG_NS, 'text');
    Object.entries({ x: barBoxes[i].x + 4, y: barBoxes[i].y - 3, class: 'bar-unreviewed-label' })
      .forEach(([k, v]) => label.setAttribute(k, v));
    label.textContent = 'Check this bar';
    svg.appendChild(label);
  });
}

// Index of the bar under an SVG coordinate, or -1.
export function barAt(x, y) {
  return barBoxes.findIndex(b => x >= b.x && x <= b.x + b.width && y >= b.y - 14 && y <= b.y + b.height);
}
