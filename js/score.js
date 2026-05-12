import { STAVE_X, STAVE_Y0, ROW_HEIGHT, BAR_WIDTH, SPACE } from './constants.js';
import { state } from './state.js';
import { barX, barY, barCol, cursorCentreY } from './layout.js';

const { Renderer, Stave, StaveNote, Voice, Formatter } = VexFlow;
const div = document.getElementById('score');

function buildTickables(bar) {
  return [...bar.notes]
    .sort((a, b) => a.beat - b.beat)
    .map(note => {
      if (note.isRest) {
        return new StaveNote({ clef: 'percussion', keys: ['b/4'], duration: 'qr' });
      }
      return new StaveNote({
        clef:           'percussion',
        keys:           [note.vexKey],
        duration:       'q',
        stem_direction: note.stemDir,
      });
    });
}

export function render() {
  div.innerHTML = '';

  const numRows     = Math.ceil(state.bars.length / state.barsPerRow);
  const totalWidth  = STAVE_X * 2 + BAR_WIDTH * state.barsPerRow;
  const totalHeight = STAVE_Y0 + numRows * ROW_HEIGHT + 40;

  const vfRenderer = new Renderer(div, Renderer.Backends.SVG);
  vfRenderer.resize(totalWidth, totalHeight);
  const ctx = vfRenderer.getContext();

  const staves = [];
  let cursorTickables = null;

  state.bars.forEach((bar, i) => {
    const stave = new Stave(barX(i), barY(i), BAR_WIDTH);
    if (i === 0) {
      stave.addClef('percussion');
      stave.addTimeSignature('4/4');
    } else if (barCol(i) === 0) {
      stave.addClef('percussion');
    }
    stave.setContext(ctx).draw();
    staves.push(stave);

    if (bar.notes.length > 0) {
      const tickables = buildTickables(bar);
      const voice = new Voice({ numBeats: 4, beatValue: 4 });
      voice.setMode(Voice.Mode.SOFT);
      voice.addTickables(tickables);

      const noteWidth = stave.getX() + stave.getWidth() - stave.getNoteStartX() - 15;
      new Formatter().joinVoices([voice]).format([voice], noteWidth);
      voice.draw(ctx, stave);

      if (i === state.cursor.barIndex) cursorTickables = tickables;
    }
  });

  // ── Cursor ────────────────────────────────────────────────────────────────
  const cs = staves[state.cursor.barIndex];

  let cx;
  if (cursorTickables) {
    const sorted = [...state.bars[state.cursor.barIndex].notes].sort((a, b) => a.beat - b.beat);
    const idx    = sorted.findIndex(n => n.beat === state.cursor.beat);
    cx = idx >= 0
      ? cursorTickables[idx].getAbsoluteX() - SPACE / 2
      : cs.getNoteStartX() + 2;
  } else {
    cx = cs.getNoteStartX() + 2;
  }

  const cy  = cursorCentreY(cs, state.cursor.position) - SPACE / 2;
  const svg = div.querySelector('svg');

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
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
