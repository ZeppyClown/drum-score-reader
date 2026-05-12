import { DRUM_KEYS, DRUM_DEFS, POSITIONS } from './constants.js';
import { state } from './state.js';
import { render } from './score.js';

// ── Place / toggle a drum note at the cursor's current beat ──────────────────
function placeNote(drumKey) {
  const def = DRUM_DEFS[drumKey];
  if (!def) return;

  const bar  = state.bars[state.cursor.barIndex];
  const beat = state.cursor.beat;
  const idx  = bar.notes.findIndex(n => n.beat === beat);

  if (idx >= 0 && !bar.notes[idx].isRest && bar.notes[idx].vexKey === def.vexKey) {
    // same drum note already here → toggle off, replace with a rest
    bar.notes = bar.notes.map((n, i) =>
      i === idx ? { beat, isRest: true, vexKey: 'b/4', stemDir: 0 } : n
    );
  } else if (idx >= 0) {
    // rest or different drum note → replace with this drum note
    bar.notes = bar.notes.map((n, i) =>
      i === idx ? { beat, vexKey: def.vexKey, stemDir: def.stemDir } : n
    );
  } else {
    // nothing at this beat → add drum note
    bar.notes = [...bar.notes, { beat, vexKey: def.vexKey, stemDir: def.stemDir }];
  }

  state.cursor.position = def.cursorPos;
  render();
}

function handleDrumKey(key) {
  const cell = document.querySelector(`#keypad [data-key="${key}"]`);
  if (cell) {
    cell.classList.add('pressed');
    setTimeout(() => cell.classList.remove('pressed'), 120);
  }
  placeNote(key);
}

// ── Keyboard ──────────────────────────────────────────────────────────────────
export function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (DRUM_KEYS.has(e.key)) { handleDrumKey(e.key); return; }

    if (e.key === 'ArrowRight') {
      const cur = state.cursor;
      const bar = state.bars[cur.barIndex];
      const hasRealNote = bar.notes.some(n => !n.isRest);

      if (hasRealNote && cur.beat < 3) {
        cur.beat++;
        if (!bar.notes.some(n => n.beat === cur.beat)) {
          bar.notes = [...bar.notes, { beat: cur.beat, isRest: true, vexKey: 'b/4', stemDir: 0 }];
        }
      } else {
        if (cur.barIndex === state.bars.length - 1) state.bars.push({ notes: [] });
        cur.barIndex++;
        cur.beat = 0;
      }
      render();
    }
    if (e.key === 'ArrowLeft') {
      const cur = state.cursor;
      if (cur.beat > 0) {
        cur.beat--;
      } else if (cur.barIndex > 0) {
        cur.barIndex--;
        const prevNotes = state.bars[cur.barIndex].notes;
        cur.beat = prevNotes.length > 0 ? Math.max(...prevNotes.map(n => n.beat)) : 0;
      }
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
