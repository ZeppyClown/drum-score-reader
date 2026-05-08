const { Renderer, Stave } = VexFlow;

const div = document.getElementById('score');

// ── Layout ────────────────────────────────────────────────────────────────────
const STAVE_X    = 10;   // left margin inside the score div
const STAVE_Y0   = 30;   // top margin before first row
const ROW_HEIGHT = 110;  // vertical space between rows
const BAR_WIDTH  = 200;  // fixed width per bar

let barsPerRow = 4;

function barCol(i) { return i % barsPerRow; }
function barRow(i) { return Math.floor(i / barsPerRow); }
function barX(i)   { return STAVE_X + barCol(i) * BAR_WIDTH; }
function barY(i)   { return STAVE_Y0 + barRow(i) * ROW_HEIGHT; }

// ── Cursor position mapping ───────────────────────────────────────────────────
// Positions 1–10, bottom to top.
//
//  pos  1 → space between lines 4–5  (bottom space)
//  pos  2 → line 4
//  pos  3 → space between lines 3–4
//  pos  4 → line 3  (middle)
//  pos  5 → space between lines 2–3
//  pos  6 → line 2
//  pos  7 → space between lines 1–2
//  pos  8 → line 1  (top line)
//  pos  9 → one space above line 1
//  pos 10 → two spaces above line 1
//
// Anchored to stave.getYForLine(4) so it tracks VexFlow's actual geometry
// regardless of internal stave padding.

const POSITIONS = 10;
const SPACE     = 10; // VexFlow default px between stave lines

// Centre y of position p, anchored to the real bottom line of the stave.
function cursorCentreY(stave, p) {
  const bottomLineY = stave.getYForLine(4); // y of notation line 5 (bottom)
  return bottomLineY - p * 5;
}

// ── State ─────────────────────────────────────────────────────────────────────
let bars   = [{}];
let cursor = { barIndex: 0, position: 1 }; // position 1 = bottom space

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  div.innerHTML = '';

  const numRows     = Math.ceil(bars.length / barsPerRow);
  const totalWidth  = STAVE_X * 2 + BAR_WIDTH * barsPerRow;
  const totalHeight = STAVE_Y0 + numRows * ROW_HEIGHT + 40;

  const vfRenderer = new Renderer(div, Renderer.Backends.SVG);
  vfRenderer.resize(totalWidth, totalHeight);
  const ctx = vfRenderer.getContext();

  // Keep stave refs so we can query note positions for the cursor
  const staves = [];

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
  });

  // Cursor square: side = SPACE (10 px). Centred vertically on cursorCentreY.
  const cs   = staves[cursor.barIndex];
  const cx   = cs.getNoteStartX() + 2;
  const cy   = cursorCentreY(cs, cursor.position) - SPACE / 2;

  const svg  = div.querySelector('svg');
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x',      cx);
  rect.setAttribute('y',      cy);
  rect.setAttribute('width',  SPACE);
  rect.setAttribute('height', SPACE);
  rect.setAttribute('fill',   '#4a9eff');
  rect.setAttribute('rx',     '2');
  svg.appendChild(rect);
}

// ── Keyboard ──────────────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') {
    if (cursor.barIndex === bars.length - 1) bars.push({});
    cursor.barIndex++;
    render();
  }

  if (e.key === 'ArrowLeft') {
    if (cursor.barIndex > 0) {
      cursor.barIndex--;
      render();
    }
  }

  if (e.key === 'ArrowUp') {
    if (cursor.position < POSITIONS) {
      cursor.position++;
      render();
    }
  }

  if (e.key === 'ArrowDown') {
    if (cursor.position > 1) {
      cursor.position--;
      render();
    }
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

  // Empty input — silently revert to current value
  if (raw === '') {
    bplAlert.classList.add('hidden');
    return;
  }

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

// ── Boot ──────────────────────────────────────────────────────────────────────
render();
