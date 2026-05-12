const { Renderer, Stave, StaveNote, Voice, Formatter } = VexFlow;

const div = document.getElementById('score');

// ── Layout ────────────────────────────────────────────────────────────────────
const STAVE_X    = 10;
const STAVE_Y0   = 30;
const ROW_HEIGHT = 110;
const BAR_WIDTH  = 200;

let barsPerRow = 4;

function barCol(i) { return i % barsPerRow; }
function barRow(i) { return Math.floor(i / barsPerRow); }
function barX(i)   { return STAVE_X + barCol(i) * BAR_WIDTH; }
function barY(i)   { return STAVE_Y0 + barRow(i) * ROW_HEIGHT; }

// ── Cursor vertical positions (1 = bottom space, 10 = above top line) ────────
const POSITIONS = 10;
const SPACE     = 10;

function cursorCentreY(stave, p) {
  return stave.getYForLine(4) - p * 5;
}

// ── Drum definitions ──────────────────────────────────────────────────────────
// Each entry maps a keyboard key to its VexFlow note properties.
// vexKey uses treble-clef positioning (percussion clef shares the same layout).
//
//   pos 5 on the stave = space between lines 2–3 from top
//              = C/5 in treble-clef key terms  ← snare
//
const DRUM_DEFS = {
  '8': { vexKey: 'c/5', stemDir: 1, cursorPos: 5 },   // snare — pos 5, stem up
};

// ── State ─────────────────────────────────────────────────────────────────────
let bars   = [{ notes: [] }];
let cursor = { barIndex: 0, position: 1, beat: 0 };

// ── Voice builder — only the notes that exist, no rests ──────────────────────
function buildTickables(bar) {
  return [...bar.notes]
    .sort((a, b) => a.beat - b.beat)
    .map(note => new StaveNote({
      clef:           'percussion',
      keys:           [note.vexKey],
      duration:       'q',
      stem_direction: note.stemDir,
    }));
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  div.innerHTML = '';

  const numRows     = Math.ceil(bars.length / barsPerRow);
  const totalWidth  = STAVE_X * 2 + BAR_WIDTH * barsPerRow;
  const totalHeight = STAVE_Y0 + numRows * ROW_HEIGHT + 40;

  const vfRenderer = new Renderer(div, Renderer.Backends.SVG);
  vfRenderer.resize(totalWidth, totalHeight);
  const ctx = vfRenderer.getContext();

  const staves = [];

  let cursorTickables = null;

  bars.forEach((bar, i) => {
    const stave = new Stave(barX(i), barY(i), BAR_WIDTH);
    if (i === 0) {
      stave.addClef('percussion');
      stave.addTimeSignature('4/4');
    } else if (barCol(i) === 0) {
      stave.addClef('percussion');
    }
    stave.setContext(ctx).draw();
    staves.push(stave);

    // Only draw a voice if the bar has at least one note
    if (bar.notes.length > 0) {
      const tickables = buildTickables(bar);
      const voice = new Voice({ numBeats: 4, beatValue: 4 });
      voice.setMode(Voice.Mode.SOFT);
      voice.addTickables(tickables);

      const noteWidth = stave.getX() + stave.getWidth() - stave.getNoteStartX() - 15;
      new Formatter().joinVoices([voice]).format([voice], noteWidth);
      voice.draw(ctx, stave);

      if (i === cursor.barIndex) cursorTickables = tickables;
    }
  });

  // Cursor square
  const cs = staves[cursor.barIndex];
  let cx;
  if (cursorTickables) {
    const sortedNotes = [...bars[cursor.barIndex].notes].sort((a, b) => a.beat - b.beat);
    const idx = sortedNotes.findIndex(n => n.beat === cursor.beat);
    cx = (idx >= 0) ? cursorTickables[idx].getAbsoluteX() - SPACE / 2 : cs.getNoteStartX() + 2;
  } else {
    cx = cs.getNoteStartX() + 2;
  }
  const cy   = cursorCentreY(cs, cursor.position) - SPACE / 2;

  const svg  = div.querySelector('svg');
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x',      cx);
  rect.setAttribute('y',      cy);
  rect.setAttribute('width',  SPACE);
  rect.setAttribute('height', SPACE);
  rect.setAttribute('fill',   'rgba(74,158,255,0.15)');
  rect.setAttribute('stroke', '#4a9eff');
  rect.setAttribute('stroke-width', '1.5');
  rect.setAttribute('rx',     '2');
  svg.appendChild(rect);
}

// ── Place a drum note at the next free beat in the current bar ────────────────
function placeNote(drumKey) {
  const def = DRUM_DEFS[drumKey];
  if (!def) return;

  const bar      = bars[cursor.barIndex];
  const usedBeats = new Set(bar.notes.map(n => n.beat));

  let beat = 0;
  while (usedBeats.has(beat) && beat < 4) beat++;
  if (beat >= 4) return; // bar full

  bar.notes = [...bar.notes, { beat, vexKey: def.vexKey, stemDir: def.stemDir }];
  cursor.position = def.cursorPos;
  cursor.beat = beat;
  render();
}

// ── Drum key handler (shared by keyboard and keypad clicks) ──────────────────
function handleDrumKey(key) {
  const cell = keypad.querySelector(`[data-key="${key}"]`);
  if (cell) {
    cell.classList.add('pressed');
    setTimeout(() => cell.classList.remove('pressed'), 120);
  }
  placeNote(key);
}

// ── Keyboard ──────────────────────────────────────────────────────────────────
const DRUM_KEYS = new Set(['0','1','2','3','4','5','6','7','8','9','.']);

document.addEventListener('keydown', (e) => {
  if (DRUM_KEYS.has(e.key)) { handleDrumKey(e.key); return; }

  if (e.key === 'ArrowRight') {
    if (cursor.barIndex === bars.length - 1) bars.push({ notes: [] });
    cursor.barIndex++;
    render();
  }
  if (e.key === 'ArrowLeft') {
    if (cursor.barIndex > 0) { cursor.barIndex--; render(); }
  }
  if (e.key === 'ArrowUp') {
    if (cursor.position < POSITIONS) { cursor.position++; render(); }
  }
  if (e.key === 'ArrowDown') {
    if (cursor.position > 1) { cursor.position--; render(); }
  }
});

// ── Side menu ─────────────────────────────────────────────────────────────────
const menuBtn  = document.getElementById('menu-btn');
const sideMenu = document.getElementById('side-menu');
const backdrop = document.getElementById('backdrop');
const bplInput = document.getElementById('bpl-input');
const bplAlert = document.getElementById('bpl-alert');

bplInput.addEventListener('change', () => {
  const raw = bplInput.value.trim();
  if (raw === '') { bplAlert.classList.add('hidden'); return; }
  const val = parseInt(raw, 10);
  if (isNaN(val) || val < 2 || val > 8) {
    bplAlert.classList.remove('hidden');
    bplInput.value = '';
    return;
  }
  bplAlert.classList.add('hidden');
  barsPerRow = val;
  render();
});

menuBtn.addEventListener('click', () => {
  const isOpen = !sideMenu.classList.contains('-translate-x-full');
  sideMenu.classList.toggle('-translate-x-full', isOpen);
  sideMenu.classList.toggle('translate-x-0', !isOpen);
  backdrop.classList.toggle('hidden', isOpen);
});

backdrop.addEventListener('click', () => {
  sideMenu.classList.add('-translate-x-full');
  sideMenu.classList.remove('translate-x-0');
  backdrop.classList.add('hidden');
});

// ── Floating keypad ───────────────────────────────────────────────────────────
const keypad       = document.getElementById('keypad');
const keypadHandle = document.getElementById('keypad-handle');

let dragging = false, dragOffX = 0, dragOffY = 0;

keypadHandle.addEventListener('mousedown', (e) => {
  dragging = true;
  const r  = keypad.getBoundingClientRect();
  dragOffX = e.clientX - r.left;
  dragOffY = e.clientY - r.top;
  keypadHandle.style.cursor = 'grabbing';
  e.preventDefault();
});
document.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  keypad.style.left  = (e.clientX - dragOffX) + 'px';
  keypad.style.top   = (e.clientY - dragOffY) + 'px';
  keypad.style.right = 'auto';
});
document.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  keypadHandle.style.cursor = 'grab';
});

keypad.querySelectorAll('.key-cell').forEach(cell => {
  cell.addEventListener('click', () => handleDrumKey(cell.dataset.key));
});

// ── Boot ──────────────────────────────────────────────────────────────────────
render();
