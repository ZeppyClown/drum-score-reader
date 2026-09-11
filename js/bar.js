// ── Pure bar editing rules ────────────────────────────────────────────────────
// Every function here takes plain data and returns new data. Nothing in this
// file reads or writes `state`, touches the DOM, or calls render(), so the rules
// can be tested in Node. input.js decides what to call and stores the result.
//
// A note is { duration, dotted, drums, triplet? }. `drums` lists drum names from
// DRUMS in constants.js; several names make a chord, and an empty list is a rest.
// `triplet: true` marks one of three consecutive notes of the same duration that
// together take the time of two.
//
// When an edit is not allowed (bar full, overflow, would break a triplet) the
// function returns the SAME object it was given, so callers can skip render().

import { DURATIONS, DUR_TICKS, BAR_TICKS } from './constants.js';

const SHORTEST = DURATIONS[0];

// A rest is a note with no drums. It keeps its duration so later notes keep their timing.
export function isRest(note) {
  return note.drums.length === 0;
}

// Ticks consumed by a single note: 1.5× if dotted, 2/3 if part of a triplet.
// (Multiply before dividing so triplet ticks stay exact whole numbers.)
export function noteTicks(note) {
  const base   = DUR_TICKS[note?.duration ?? 'q'];
  const dotted = note?.dotted ? base * 1.5 : base;
  return note?.triplet ? (dotted * 2) / 3 : dotted;
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
  return SHORTEST;
}

// Start index of every triplet group: three consecutive triplet notes of one duration.
export function tripletStarts(bar) {
  const starts = [];
  for (let i = 0; i < bar.notes.length; i++) {
    const group = bar.notes.slice(i, i + 3);
    if (group.length === 3 && group.every(n => n.triplet && n.duration === group[0].duration)) {
      starts.push(i);
      i += 2;
    }
  }
  return starts;
}

// Start index of the triplet group containing index, or -1.
export function tripletGroupStart(bar, index) {
  return tripletStarts(bar).find(start => index >= start && index < start + 3) ?? -1;
}

function replaceNote(bar, index, note) {
  return { ...bar, notes: bar.notes.map((n, i) => (i === index ? note : n)) };
}

function replaceRange(bar, start, end, notes) {
  return { ...bar, notes: [...bar.notes.slice(0, start), ...notes, ...bar.notes.slice(end)] };
}

// ── Toggle a drum at index ───────────────────────────────────────────────────
//   1. Existing note (hit or rest) → add the drum to its chord, or remove it if
//      it is already there. Removing the last drum leaves a rest of the same length.
//   2. Past the end → append a plain note with just this drum, inheriting the
//      previous duration + dot if it fits.
export function toggleDrum(bar, index, drumId) {
  if (index < bar.notes.length) {
    const note  = bar.notes[index];
    const drums = note.drums.includes(drumId)
      ? note.drums.filter(d => d !== drumId)
      : [...note.drums, drumId];
    return replaceNote(bar, index, { ...note, drums });
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
      drums:    [drumId],
    }],
  };
}

// ── Toggle the dot on the note at index ──────────────────────────────────────
// Refused for 32nds (a dotted 32nd is 9 ticks and leaves gaps no plain rest can
// fill) and for triplet notes (it would break the group).
export function toggleDot(bar, index) {
  if (index >= bar.notes.length) return bar;
  const note = bar.notes[index];
  if (note.duration === SHORTEST || note.triplet) return bar;

  const baseTicks  = DUR_TICKS[note.duration ?? 'q'];
  const extraTicks = note.dotted ? -baseTicks * 0.5 : baseTicks * 0.5;
  if (barTicks(bar) + extraTicks > BAR_TICKS) return bar;  // would overflow

  return replaceNote(bar, index, { ...note, dotted: !note.dotted });
}

// ── Change the duration of the note at index (delta -1 shorter, +1 longer) ──
// Refused for triplet notes (it would break the group) and for making a dotted
// note a 32nd (see toggleDot).
export function changeDuration(bar, index, delta) {
  if (index >= bar.notes.length) return bar;
  const note    = bar.notes[index];
  if (note.triplet) return bar;
  const curDur  = note.duration ?? 'q';
  const durIdx  = DURATIONS.indexOf(curDur);
  const nextDur = DURATIONS[Math.max(0, Math.min(DURATIONS.length - 1, durIdx + delta))];
  if (nextDur === curDur || (nextDur === SHORTEST && note.dotted)) return bar;

  const newTicks = DUR_TICKS[nextDur] * (note.dotted ? 1.5 : 1);
  if (barTicks(bar) - noteTicks(note) + newTicks > BAR_TICKS) return bar;  // would overflow

  return replaceNote(bar, index, { ...note, duration: nextDur });
}

// ── Toggle a triplet group at index ──────────────────────────────────────────
// On a plain note of duration d: the next 2×d ticks become three triplet notes of
// duration d. Each triplet slot takes the drums of every note that started in its
// third of that span (several notes → one chord). Refused if a note crosses the
// span's end, the span reaches another triplet, or the bar has no room left.
// On a note inside a triplet group: the group becomes two plain notes of duration
// d. The first keeps slot 1's drums; the second combines slots 2 and 3.
export function toggleTriplet(bar, index) {
  if (index >= bar.notes.length) return bar;
  const start = tripletGroupStart(bar, index);
  return start >= 0 ? splitTriplet(bar, start) : makeTriplet(bar, index);
}

function makeTriplet(bar, index) {
  const first = bar.notes[index];
  if (first.triplet || first.dotted || first.duration === SHORTEST) return bar;

  const span   = 2 * DUR_TICKS[first.duration];
  const onsets = [];
  let ticks = 0;
  let end   = index;
  for (; end < bar.notes.length && ticks < span; end++) {
    if (bar.notes[end].triplet) return bar;  // would swallow part of another triplet
    onsets.push({ at: ticks, drums: bar.notes[end].drums });
    ticks += noteTicks(bar.notes[end]);
  }
  if (ticks > span) return bar;                                            // a note crosses the end
  if (ticks < span && BAR_TICKS - barTicks(bar) < span - ticks) return bar;  // no room left

  const slot  = span / 3;
  const group = [0, 1, 2].map(k => ({
    duration: first.duration,
    dotted:   false,
    triplet:  true,
    drums:    [...new Set(onsets.filter(o => Math.floor(o.at / slot) === k).flatMap(o => o.drums))],
  }));
  return replaceRange(bar, index, end, group);
}

function splitTriplet(bar, start) {
  const [a, b, c] = bar.notes.slice(start, start + 3);
  return replaceRange(bar, start, start + 3, [
    { duration: a.duration, dotted: false, drums: a.drums },
    { duration: a.duration, dotted: false, drums: [...new Set([...b.drums, ...c.drums])] },
  ]);
}

// ── Backspace at index ───────────────────────────────────────────────────────
// A rest is deleted (removedRest: true, so the cursor steps back) unless it is part
// of a triplet. A hit or chord becomes a rest of the same length, so later notes
// keep their timing.
export function backspaceAt(bar, index) {
  if (index >= bar.notes.length) return { bar, removedRest: false };
  const note = bar.notes[index];
  if (isRest(note)) {
    if (note.triplet) return { bar, removedRest: false };  // would break the triplet group
    return { bar: { ...bar, notes: bar.notes.filter((_, i) => i !== index) }, removedRest: true };
  }
  return { bar: replaceNote(bar, index, { ...note, drums: [] }), removedRest: false };
}

// ── Cursor movement ──────────────────────────────────────────────────────────
// moveRight may append a rest (bar not yet full) or a new empty bar (at the end).
export function moveRight(bars, cursor) {
  const bar = bars[cursor.barIndex];
  const toNextBar = () => ({
    bars:   cursor.barIndex === bars.length - 1 ? [...bars, { notes: [] }] : bars,
    cursor: { ...cursor, barIndex: cursor.barIndex + 1, noteIndex: 0 },
  });

  if (bar.notes.every(isRest)) return toNextBar();  // empty or rest-only bar
  if (cursor.noteIndex < bar.notes.length - 1) {
    return { bars, cursor: { ...cursor, noteIndex: cursor.noteIndex + 1 } };
  }

  const remaining = BAR_TICKS - barTicks(bar);
  if (remaining <= 0) return toNextBar();

  // Auto-rests are plain and NEVER dotted: a dotted auto-rest would break later navigation.
  const prevDur = bar.notes[cursor.noteIndex]?.duration ?? 'q';
  const rest    = {
    duration: DUR_TICKS[prevDur] <= remaining ? prevDur : fitDuration(remaining),
    dotted:   false,
    drums:    [],
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
