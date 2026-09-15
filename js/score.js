import { STAVE_X, STAVE_Y0, ROW_HEIGHT, SPACE } from './constants.js';
import { state } from './state.js';
import { barRow, barCol, barY, cursorCentreY } from './layout.js';
import { drawBarNotes } from './bar-drawing.js';
import { needsReview } from './review.js';
import { resolveSelection } from './selection.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Destructure the VexFlow classes we need from the global VexFlow object.
// VexFlow is loaded as a CJS bundle via <script> in index.html, so it's a global.
const { Renderer, Stave } = VexFlow;

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
  noteXs = [];                // x of every note, per bar, for the playback highlight
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
      // Notes, beams and triplet brackets (bar-drawing.js, shared with Library previews).
      const tickables = drawBarNotes(ctx, stave, bar, state.editor.meta.meter);
      // Remember the tickables for the bar the cursor is in, so the cursor snaps to its notehead.
      if (i === state.cursor.barIndex) cursorTickables = tickables;
      noteXs[i] = tickables.map(t => t.getAbsoluteX());
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
  // A viewBox lets the score scale to the page width when printed or exported to PDF.
  svg.setAttribute('viewBox', `0 0 ${maxRowW} ${totalHeight}`);

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
// imported bars that still need review, blue for selected bars. barBoxes keeps each bar's box so clicks can
// be mapped back to a bar (see barAt).
let barBoxes = [];
let noteXs = [];

// Moves the playback highlight to { barIndex, noteIndex } (or removes it for null) without
// redrawing the score, so it can follow the music note by note.
export function showPlayhead(position) {
  const svg = div.querySelector('svg');
  let mark = svg?.querySelector('#score-playhead');
  const box = position && barBoxes[position.barIndex];
  const x = position && noteXs[position.barIndex]?.[position.noteIndex];
  if (!svg || !box || !Number.isFinite(x)) { mark?.remove(); return; }
  if (!mark) {
    mark = document.createElementNS(SVG_NS, 'rect');
    mark.setAttribute('id', 'score-playhead');
    mark.setAttribute('class', 'score-playhead');
    svg.insertBefore(mark, svg.firstChild);
  }
  Object.entries({ x: x - 7, y: box.y, width: 18, height: box.height, rx: 3 }).forEach(([k, v]) => mark.setAttribute(k, v));
}

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
  const selected = resolveSelection(state.editor);
  state.bars.forEach((bar, i) => {
    if (selected && i >= selected.fromIndex && i <= selected.toIndex) overlayRect(svg, barBoxes[i], 'bar-selected');
    if (!needsReview(bar)) return;
    overlayRect(svg, barBoxes[i], 'bar-unreviewed');
  });
}

// Index of the bar under an SVG coordinate, or -1.
export function barAt(x, y) {
  return barBoxes.findIndex(b => x >= b.x && x <= b.x + b.width && y >= b.y - 14 && y <= b.y + b.height);
}
