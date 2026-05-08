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

// ── State ─────────────────────────────────────────────────────────────────────
let bars   = [{}];
let cursor = { barIndex: 0 };

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

  // Cursor — a square whose side equals one stave space (10 px in VexFlow default).
  // getNoteStartX() gives the x right after any clef/time-sig, so the
  // cursor sits at the correct position regardless of which bar decorations are shown.
  const SPACE = 10; // VexFlow default distance between stave lines
  const cs    = staves[cursor.barIndex];
  const cx    = cs.getNoteStartX() + 2;
  const cy    = barY(cursor.barIndex) + SPACE * 2; // middle space of the stave

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
