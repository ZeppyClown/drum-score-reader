// ── Pure bar editing rules ────────────────────────────────────────────────────
// Every function here takes plain data and returns new data. Nothing in this
// file reads or writes `state`, touches the DOM, or calls render(), so the rules
// can be tested in Node. input.js decides what to call and stores the result.
//
// When an edit is not allowed (bar full, overflow, nothing at the index) the
// function returns the SAME object it was given, so callers can skip render().

import { DURATIONS, DUR_TICKS, BAR_TICKS } from './constants.js';

// A rest always sits on the middle line and has no stem.
const REST_FIELDS = { isRest: true, vexKey: 'b/4', stemDir: 0 };

// Ticks consumed by a single note (1.5× base if dotted).
export function noteTicks(note) {
  const base = DUR_TICKS[note?.duration ?? 'q'];
  return note?.dotted ? base * 1.5 : base;
}

// Total ticks consumed by all notes currently in a bar.
export function barTicks(bar) {
  return bar.notes.reduce((sum, n) => sum + noteTicks(n), 0);
}

// Largest standard (non-dotted) duration whose tick count fits within remainingTicks.
export function fitDuration(remainingTicks) {
  for (let i = DURATIONS.length - 1; i >= 0; i--) {
    if (DUR_TICKS[DURATIONS[i]] <= remainingTicks) return DURATIONS[i];
  }
  return '16';
}

function replaceNote(bar, index, note) {
  return { ...bar, notes: bar.notes.map((n, i) => (i === index ? note : n)) };
}

// ── Place / toggle a drum note at index ──────────────────────────────────────
//   1. Same drum note → toggle it off (rest, keep duration + dotted)
//   2. Different note or a rest → replace with the new drum (keep duration + dotted)
//   3. Past the end → append, inheriting the previous duration + dot if it fits
export function placeDrum(bar, index, def) {
  if (index < bar.notes.length) {
    const existing = bar.notes[index];
    const sameNote = !existing.isRest &&
      existing.vexKey === def.vexKey &&
      (existing.noteType ?? 'n') === def.noteType;
    return replaceNote(bar, index, sameNote
      ? { ...existing, ...REST_FIELDS, noteType: 'n' }
      : { ...existing, isRest: false, vexKey: def.vexKey, stemDir: def.stemDir, noteType: def.noteType });
  }

  const remaining = BAR_TICKS - barTicks(bar);
  if (remaining <= 0) return bar;  // bar is already full

  const prev       = bar.notes[index - 1];
  const prevDur    = prev?.duration ?? 'q';
  const prevDotted = prev?.dotted ?? false;
  const fits       = DUR_TICKS[prevDur] * (prevDotted ? 1.5 : 1) <= remaining;

  return {
    ...bar,
    notes: [...bar.notes, {
      duration: fits ? prevDur : fitDuration(remaining),
      dotted:   fits ? prevDotted : false,
      vexKey:   def.vexKey,
      stemDir:  def.stemDir,
      noteType: def.noteType,
      isRest:   false,
    }],
  };
}

// ── Toggle the dot on the note at index ──────────────────────────────────────
// Semiquavers are blocked because 1.5 semiquaver ticks is non-integer.
export function toggleDot(bar, index) {
  if (index >= bar.notes.length) return bar;
  const note = bar.notes[index];
  if (note.duration === '16') return bar;

  const baseTicks  = DUR_TICKS[note.duration ?? 'q'];
  const extraTicks = note.dotted ? -baseTicks * 0.5 : baseTicks * 0.5;
  if (barTicks(bar) + extraTicks > BAR_TICKS) return bar;  // would overflow

  return replaceNote(bar, index, { ...note, dotted: !note.dotted });
}

// ── Change the duration of the note at index (delta -1 shorter, +1 longer) ──
export function changeDuration(bar, index, delta) {
  if (index >= bar.notes.length) return bar;
  const note    = bar.notes[index];
  const curDur  = note.duration ?? 'q';
  const durIdx  = DURATIONS.indexOf(curDur);
  const nextDur = DURATIONS[Math.max(0, Math.min(DURATIONS.length - 1, durIdx + delta))];
  if (nextDur === curDur) return bar;

  const newTicks = DUR_TICKS[nextDur] * (note.dotted ? 1.5 : 1);
  if (barTicks(bar) - noteTicks(note) + newTicks > BAR_TICKS) return bar;  // would overflow

  return replaceNote(bar, index, { ...note, duration: nextDur });
}

// ── Backspace at index ───────────────────────────────────────────────────────
// A rest is deleted (removedRest: true, so the cursor steps back).
// A drum hit becomes a rest of the same length, so later notes keep their timing.
export function backspaceAt(bar, index) {
  if (index >= bar.notes.length) return { bar, removedRest: false };
  if (bar.notes[index].isRest) {
    return { bar: { ...bar, notes: bar.notes.filter((_, i) => i !== index) }, removedRest: true };
  }
  return { bar: replaceNote(bar, index, { ...bar.notes[index], ...REST_FIELDS }), removedRest: false };
}

// ── Cursor movement ──────────────────────────────────────────────────────────
// moveRight may append a rest (bar not yet full) or a new empty bar (at the end).
export function moveRight(bars, cursor) {
  const bar = bars[cursor.barIndex];
  const toNextBar = () => ({
    bars:   cursor.barIndex === bars.length - 1 ? [...bars, { notes: [] }] : bars,
    cursor: { ...cursor, barIndex: cursor.barIndex + 1, noteIndex: 0 },
  });

  if (!bar.notes.some(n => !n.isRest)) return toNextBar();  // empty or rest-only bar
  if (cursor.noteIndex < bar.notes.length - 1) {
    return { bars, cursor: { ...cursor, noteIndex: cursor.noteIndex + 1 } };
  }

  const remaining = BAR_TICKS - barTicks(bar);
  if (remaining <= 0) return toNextBar();

  // Auto-rests are NEVER dotted: a dotted auto-rest would break later navigation.
  const prevDur = bar.notes[cursor.noteIndex]?.duration ?? 'q';
  const rest    = {
    duration: DUR_TICKS[prevDur] <= remaining ? prevDur : fitDuration(remaining),
    dotted:   false,
    ...REST_FIELDS,
  };
  return {
    bars:   bars.map((b, i) => (i === cursor.barIndex ? { ...b, notes: [...b.notes, rest] } : b)),
    cursor: { ...cursor, noteIndex: cursor.noteIndex + 1 },
  };
}

export function moveLeft(bars, cursor) {
  if (cursor.noteIndex > 0) return { ...cursor, noteIndex: cursor.noteIndex - 1 };
  if (cursor.barIndex === 0) return cursor;
  const barIndex = cursor.barIndex - 1;
  return { ...cursor, barIndex, noteIndex: Math.max(0, bars[barIndex].notes.length - 1) };
}
