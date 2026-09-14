import { DRUM_KEYS, KEY_DRUMS, SHIFT_KEY_DRUMS } from './constants.js';
import { dispatch } from './editor-store.js';
import {
  toggleDrumCommand, toggleDotCommand, changeDurationCommand, toggleTripletCommand,
  backspaceCommand, moveRightCommand, moveLeftCommand, moveCursorCommand,
} from './commands.js';

// ── Wiring between user input and editor commands ─────────────────────────────
// The editing rules live in bar.js and are wrapped as commands in commands.js, which
// also handles ids, revision, and undo history. This file only maps keys to
// commands; editor-store.js stores the result and re-renders. A refused edit
// changes nothing and skips the re-render.

// ── Shared handler for all drum key presses ───────────────────────────────────
// key: '0'-'9' or '.'; shift: true selects the extra drums in SHIFT_KEY_DRUMS.
function handleDrumKey(key, shift = false) {
  if (key === '.') { dispatch(toggleDotCommand()); return; }
  const drumId = (shift ? SHIFT_KEY_DRUMS : KEY_DRUMS)[key];
  if (!drumId) return;  // nothing assigned to this key (or this Shift combination)
  const cell = document.querySelector(`#keypad [data-key="${key}"]`);
  if (cell) {
    cell.classList.add('pressed');
    setTimeout(() => cell.classList.remove('pressed'), 120);
  }
  dispatch(toggleDrumCommand(drumId));  // add or remove it in the chord at the cursor
}

// Shift changes e.key on the number row ('4' becomes '$'), so read the physical key.
function shiftedDigit(e) {
  const match = e.shiftKey && /^(?:Digit|Numpad)(\d)$/.exec(e.code);
  return match ? match[1] : null;
}

const KEY_COMMANDS = {
  '-':          () => changeDurationCommand(-1),
  '+':          () => changeDurationCommand(1),
  Backspace:    backspaceCommand,
  t:            toggleTripletCommand,  // triplet group at the cursor, or back to plain notes
  T:            toggleTripletCommand,
  ArrowRight:   moveRightCommand,      // may append a rest or an empty bar
  ArrowLeft:    moveLeftCommand,
  ArrowUp:      () => moveCursorCommand(1),
  ArrowDown:    () => moveCursorCommand(-1),
};

// ── Keyboard event handler ────────────────────────────────────────────────────
// Undo/redo and file shortcuts use ⌘ and come from the app menu (see desktop/score-ipc.cjs).
export function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || document.body.classList.contains('modal-open') ||
        e.target.closest('input, textarea, select, button, [contenteditable="true"]')) return;

    const digit = shiftedDigit(e);
    if (digit) { handleDrumKey(digit, true); return; }
    if (DRUM_KEYS.has(e.key)) { handleDrumKey(e.key); return; }
    if (Object.hasOwn(KEY_COMMANDS, e.key)) {
      dispatch(KEY_COMMANDS[e.key]());
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
