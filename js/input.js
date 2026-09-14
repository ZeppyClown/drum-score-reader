import { DRUM_KEYS, DRUMS, KEY_DRUMS, SHIFT_KEY_DRUMS, POSITIONS } from './constants.js';
import { state } from './state.js';
import { render } from './score.js';
import {
  toggleDrum, toggleDot, changeDuration, toggleTriplet, tripletGroupStart,
  backspaceAt, moveRight, moveLeft,
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

// ── Add or remove a drum in the chord at the cursor's current position ────────
function placeDrum(drumId) {
  if (!updateCurrentBar((bar, idx) => toggleDrum(bar, idx, drumId))) return;  // bar full
  state.cursor.position = DRUMS[drumId].cursorPos;
  render();
}

// ── Shared handler for all drum key presses ───────────────────────────────────
// key: '0'-'9' or '.'; shift: true selects the extra drums in SHIFT_KEY_DRUMS.
function handleDrumKey(key, shift = false) {
  if (key === '.') {
    if (updateCurrentBar(toggleDot)) render();
    return;
  }
  const drumId = (shift ? SHIFT_KEY_DRUMS : KEY_DRUMS)[key];
  if (!drumId) return;  // nothing assigned to this key (or this Shift combination)
  const cell = document.querySelector(`#keypad [data-key="${key}"]`);
  if (cell) {
    cell.classList.add('pressed');
    setTimeout(() => cell.classList.remove('pressed'), 120);
  }
  placeDrum(drumId);
}

// Shift changes e.key on the number row ('4' becomes '$'), so read the physical key.
function shiftedDigit(e) {
  const match = e.shiftKey && /^(?:Digit|Numpad)(\d)$/.exec(e.code);
  return match ? match[1] : null;
}

// ── T: make a triplet group at the cursor, or turn a triplet back into plain notes
function handleTriplet() {
  const cur   = state.cursor;
  const start = tripletGroupStart(state.bars[cur.barIndex], cur.noteIndex);
  if (!updateCurrentBar(toggleTriplet)) return;  // refused (see bar.js)
  // Splitting turns three notes into two, so keep the cursor inside the new pair.
  if (start >= 0) cur.noteIndex = Math.min(cur.noteIndex, start + 1);
  render();
}

// ── Backspace: delete a rest, or turn a hit or chord into a rest ──────────────
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
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey ||
        e.target.closest('input, textarea, select, button, [contenteditable="true"]')) return;

    const digit = shiftedDigit(e);
    if (digit) { handleDrumKey(digit, true); return; }
    if (DRUM_KEYS.has(e.key)) { handleDrumKey(e.key); return; }
    if (e.key === '-') { if (updateCurrentBar((b, i) => changeDuration(b, i, -1))) render(); return; }
    if (e.key === '+') { if (updateCurrentBar((b, i) => changeDuration(b, i, 1)))  render(); return; }
    if (e.key === 'Backspace') { handleBackspace(); return; }
    if (e.key === 't' || e.key === 'T') { handleTriplet(); return; }

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

  // Shift-click a keypad cell to enter its extra drum.
  keypad.querySelectorAll('.key-cell').forEach(cell => {
    cell.addEventListener('click', (e) => handleDrumKey(cell.dataset.key, e.shiftKey));
  });
}
