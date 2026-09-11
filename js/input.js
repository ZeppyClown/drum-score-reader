import { DRUM_KEYS, DRUM_DEFS, POSITIONS } from './constants.js';
import { state } from './state.js';
import { render } from './score.js';
import {
  placeDrum, toggleDot, changeDuration, backspaceAt, moveRight, moveLeft,
} from './bar.js';

// ── Wiring between user input and the pure bar rules ─────────────────────────
// The editing rules themselves live in bar.js and never touch state or the DOM.
// This file asks bar.js for the new bar/cursor, stores it in state, and re-renders.
// When bar.js returns the same bar object, the edit was refused — skip render().

function updateCurrentBar(edit) {
  const i    = state.cursor.barIndex;
  const bar  = state.bars[i];
  const next = edit(bar, state.cursor.noteIndex);
  if (next === bar) return false;
  state.bars = state.bars.map((b, j) => (j === i ? next : b));
  return true;
}

// ── Place / toggle a drum note at the cursor's current position ───────────────
// drumKey: the key the user pressed (e.g. '8' for snare)
function placeNote(drumKey) {
  const def = DRUM_DEFS[drumKey];
  if (!def) return;  // key has no drum definition yet
  if (!updateCurrentBar((bar, idx) => placeDrum(bar, idx, def))) return;  // bar full
  state.cursor.position = def.cursorPos;
  render();
}

// ── Shared handler for all drum key presses ───────────────────────────────────
function handleDrumKey(key) {
  if (key === '.') {
    if (updateCurrentBar(toggleDot)) render();
    return;
  }
  const cell = document.querySelector(`#keypad [data-key="${key}"]`);
  if (cell) {
    cell.classList.add('pressed');
    setTimeout(() => cell.classList.remove('pressed'), 120);
  }
  placeNote(key);
}

// ── Backspace: delete a rest, or turn a drum hit into a rest ──────────────────
function handleBackspace() {
  const cur = state.cursor;
  const { bar, removedRest } = backspaceAt(state.bars[cur.barIndex], cur.noteIndex);
  state.bars = state.bars.map((b, i) => (i === cur.barIndex ? bar : b));
  if (removedRest && cur.noteIndex > 0) cur.noteIndex--;
  render();
}

// ── Keyboard event handler ────────────────────────────────────────────────────
export function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;

    if (DRUM_KEYS.has(e.key)) { handleDrumKey(e.key); return; }
    if (e.key === '-') { if (updateCurrentBar((b, i) => changeDuration(b, i, -1))) render(); return; }
    if (e.key === '+') { if (updateCurrentBar((b, i) => changeDuration(b, i, 1)))  render(); return; }
    if (e.key === 'Backspace') { handleBackspace(); return; }

    if (e.key === 'ArrowRight') {
      const moved = moveRight(state.bars, state.cursor);
      state.bars   = moved.bars;
      state.cursor = moved.cursor;
      render();
    }
    if (e.key === 'ArrowLeft') {
      state.cursor = moveLeft(state.bars, state.cursor);
      render();
    }
    if (e.key === 'ArrowUp') {
      if (state.cursor.position < POSITIONS) { state.cursor.position++; render(); }
    }
    if (e.key === 'ArrowDown') {
      if (state.cursor.position > 1) { state.cursor.position--; render(); }
    }
  });
}

// ── Floating keypad (drag + click) ────────────────────────────────────────────
export function initKeypad() {
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
}
