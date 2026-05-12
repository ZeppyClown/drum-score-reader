import { DRUM_KEYS, DRUM_DEFS, DURATIONS, DUR_TICKS, BAR_TICKS, POSITIONS } from './constants.js';
import { state } from './state.js';
import { render } from './score.js';

// ── Bar capacity helpers ──────────────────────────────────────────────────────

// Total ticks consumed by all notes currently in a bar.
// This is the ground truth for how full a bar is.
function barTicks(bar) {
  return bar.notes.reduce((sum, n) => sum + noteTicks(n), 0);
}

// Ticks consumed by a single note (1.5× base if dotted).
function noteTicks(note) {
  const base = DUR_TICKS[note?.duration ?? 'q'];
  return note?.dotted ? base * 1.5 : base;
}

// Largest standard (non-dotted) duration whose tick count fits within remainingTicks.
// Used to auto-create rests that never overflow the bar boundary.
function fitDuration(remainingTicks) {
  for (let i = DURATIONS.length - 1; i >= 0; i--) {
    if (DUR_TICKS[DURATIONS[i]] <= remainingTicks) return DURATIONS[i];
  }
  return '16';
}

// ── Place / toggle a drum note at the cursor's current position ───────────────
// drumKey: the key the user pressed (e.g. '8' for snare)
//
// Three cases depending on what is already at cursor.noteIndex:
//   1. Same drum note → toggle it off (replace with a rest, keep duration + dotted)
//   2. Different note or a rest → replace with the new drum note (keep duration + dotted)
//   3. Cursor past the end of the array (empty bar or no note here yet) → create new note
function placeNote(drumKey) {
  const def = DRUM_DEFS[drumKey];
  if (!def) return;  // key has no drum definition yet

  const bar = state.bars[state.cursor.barIndex];
  const idx = state.cursor.noteIndex;

  if (idx < bar.notes.length) {
    const existing = bar.notes[idx];
    if (!existing.isRest && existing.vexKey === def.vexKey) {
      // Case 1: same drum note → toggle off to rest, preserve duration + dotted
      bar.notes = bar.notes.map((n, i) =>
        i === idx ? { ...n, isRest: true, vexKey: 'b/4', stemDir: 0 } : n
      );
    } else {
      // Case 2: rest or different note → replace with drum note, preserve duration + dotted
      bar.notes = bar.notes.map((n, i) =>
        i === idx ? { ...n, isRest: false, vexKey: def.vexKey, stemDir: def.stemDir } : n
      );
    }
  } else {
    // Case 3: no note at this index yet — create one.
    // Inherit duration + dotted from the previous note if it fits; otherwise use fitDuration.
    const remaining = BAR_TICKS - barTicks(bar);
    if (remaining <= 0) return;  // bar is already full

    const prev       = bar.notes[idx - 1];
    const prevDur    = prev?.duration ?? 'q';
    const prevDotted = prev?.dotted ?? false;
    const prevTicks  = DUR_TICKS[prevDur] * (prevDotted ? 1.5 : 1);

    const dur    = prevTicks <= remaining ? prevDur    : fitDuration(remaining);
    const dotted = prevTicks <= remaining ? prevDotted : false;

    bar.notes = [...bar.notes, {
      duration: dur,
      dotted,
      vexKey:  def.vexKey,
      stemDir: def.stemDir,
      isRest:  false,
    }];
  }

  state.cursor.position = def.cursorPos;
  render();
}

// ── Toggle dotted on the note at the cursor position ─────────────────────────
// Blocks the toggle if it would make the bar overflow.
// Semi-quavers are blocked because 1.5 semiquaver ticks is non-integer.
function toggleDot() {
  const bar = state.bars[state.cursor.barIndex];
  const idx = state.cursor.noteIndex;
  if (idx >= bar.notes.length) return;

  const note      = bar.notes[idx];
  if (note.duration === '16') return;

  const newDotted  = !note.dotted;
  const baseTicks  = DUR_TICKS[note.duration ?? 'q'];
  // Adding a dot increases the note by half its base value; removing decreases it.
  const extraTicks = newDotted ? baseTicks * 0.5 : -baseTicks * 0.5;

  if (barTicks(bar) + extraTicks > BAR_TICKS) return;  // would overflow bar

  bar.notes = bar.notes.map((n, i) => i === idx ? { ...n, dotted: newDotted } : n);
  render();
}

// ── Change duration of the note at the cursor position ───────────────────────
// delta: -1 = shorter, +1 = longer
// Blocks the change if the new duration would overflow the bar.
function changeDuration(delta) {
  const bar = state.bars[state.cursor.barIndex];
  const idx = state.cursor.noteIndex;
  if (idx >= bar.notes.length) return;

  const note    = bar.notes[idx];
  const curDur  = note.duration ?? 'q';
  const durIdx  = DURATIONS.indexOf(curDur);
  const nextDur = DURATIONS[Math.max(0, Math.min(DURATIONS.length - 1, durIdx + delta))];
  if (nextDur === curDur) return;

  // Compute the tick difference between old and new duration
  const oldTicks  = noteTicks(note);
  const newTicks  = DUR_TICKS[nextDur] * (note.dotted ? 1.5 : 1);
  if (barTicks(bar) - oldTicks + newTicks > BAR_TICKS) return;  // would overflow

  bar.notes = bar.notes.map((n, i) => i === idx ? { ...n, duration: nextDur } : n);
  render();
}

// ── Shared handler for all drum key presses ───────────────────────────────────
function handleDrumKey(key) {
  if (key === '.') { toggleDot(); return; }
  const cell = document.querySelector(`#keypad [data-key="${key}"]`);
  if (cell) {
    cell.classList.add('pressed');
    setTimeout(() => cell.classList.remove('pressed'), 120);
  }
  placeNote(key);
}

// ── Keyboard event handler ────────────────────────────────────────────────────
export function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;

    if (DRUM_KEYS.has(e.key)) { handleDrumKey(e.key); return; }
    if (e.key === '-') { changeDuration(-1); return; }
    if (e.key === '+') { changeDuration(1);  return; }

    // ── Backspace ─────────────────────────────────────────────────────────────
    if (e.key === 'Backspace') {
      const cur = state.cursor;
      const bar = state.bars[cur.barIndex];
      const idx = cur.noteIndex;
      if (idx >= bar.notes.length) { render(); return; }

      if (bar.notes[idx].isRest) {
        // Delete the rest and move cursor back to the previous note
        bar.notes = bar.notes.filter((_, i) => i !== idx);
        if (cur.noteIndex > 0) cur.noteIndex--;
      } else {
        // Convert drum note → rest, preserving duration + dotted so tick count is unchanged
        bar.notes = bar.notes.map((n, i) =>
          i === idx ? { ...n, isRest: true, vexKey: 'b/4', stemDir: 0 } : n
        );
      }
      render();
      return;
    }

    // ── Arrow Right ───────────────────────────────────────────────────────────
    if (e.key === 'ArrowRight') {
      const cur = state.cursor;
      const bar = state.bars[cur.barIndex];
      const hasRealNote = bar.notes.some(n => !n.isRest);

      if (!hasRealNote) {
        // Empty or rest-only bar: skip straight to the next bar
        if (cur.barIndex === state.bars.length - 1) state.bars.push({ notes: [] });
        cur.barIndex++;
        cur.noteIndex = 0;
      } else if (cur.noteIndex < bar.notes.length - 1) {
        // Move to the next existing note in this bar
        cur.noteIndex++;
      } else {
        // At the last note in the bar — check if there's still room
        const remaining = BAR_TICKS - barTicks(bar);
        if (remaining > 0) {
          // Bar not yet full: auto-create a rest and move to it.
          // Use the same duration as the current note if it fits; otherwise shrink.
          const prev       = bar.notes[cur.noteIndex];
          const prevDur    = prev?.duration ?? 'q';
          const prevTicks  = DUR_TICKS[prevDur];  // auto-rests are never dotted
          const restDur    = prevTicks <= remaining ? prevDur : fitDuration(remaining);
          bar.notes = [...bar.notes, {
            duration: restDur,
            dotted:   false,   // auto-rests are NEVER dotted
            isRest:   true,
            vexKey:   'b/4',
            stemDir:  0,
          }];
          cur.noteIndex++;
        } else {
          // Bar is exactly full: move to the next bar
          if (cur.barIndex === state.bars.length - 1) state.bars.push({ notes: [] });
          cur.barIndex++;
          cur.noteIndex = 0;
        }
      }
      render();
    }

    // ── Arrow Left ────────────────────────────────────────────────────────────
    if (e.key === 'ArrowLeft') {
      const cur = state.cursor;
      if (cur.noteIndex > 0) {
        cur.noteIndex--;
      } else if (cur.barIndex > 0) {
        cur.barIndex--;
        const prevBar = state.bars[cur.barIndex];
        cur.noteIndex = Math.max(0, prevBar.notes.length - 1);
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
