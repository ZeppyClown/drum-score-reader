import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isRest, noteTicks, barTicks, fitDuration, tripletStarts, tripletGroupStart,
  toggleDrum, toggleDot, changeDuration, toggleTriplet, backspaceAt, moveRight, moveLeft,
} from '../js/bar.js';
import { BAR_TICKS } from '../js/constants.js';

function hit(duration, drums = ['snare'], dotted = false) {
  return { duration, dotted, drums };
}

function rest(duration, dotted = false) {
  return { duration, dotted, drums: [] };
}

function trip(duration, drums = []) {
  return { duration, dotted: false, triplet: true, drums };
}

// Freezing the input proves every rule returns new data instead of editing it.
function frozen(value) {
  Object.values(value).forEach(v => { if (v && typeof v === 'object') frozen(v); });
  return Object.freeze(value);
}

const bar = (...notes) => frozen({ notes });

// ── Ticks and durations ──────────────────────────────────────────────────────

test('ticks: every supported note is a whole number of ticks', () => {
  assert.equal(BAR_TICKS, 192);
  assert.equal(noteTicks(hit('q')), 48);
  assert.equal(noteTicks(hit('q', ['snare'], true)), 72);
  assert.equal(noteTicks(hit('8', ['snare'], true)), 36);
  assert.equal(noteTicks(hit('16', ['snare'], true)), 18);
  assert.equal(noteTicks(hit('32')), 6);
  assert.equal(noteTicks(trip('8')), 16);
  assert.equal(noteTicks(trip('16')), 8);
  assert.equal(noteTicks(trip('q')), 32);
  assert.equal(noteTicks({ drums: [] }), 48);
  assert.equal(barTicks(bar(hit('h'), rest('8'), hit('16'), hit('16'))), 144);
});

test('fitDuration picks the longest plain duration that fits', () => {
  assert.deepEqual([192, 180, 60, 36, 12, 6, 0].map(fitDuration), ['w', 'h', 'q', '8', '16', '32', '32']);
});

test('a note with no drums is a rest', () => {
  assert.equal(isRest(rest('q')), true);
  assert.equal(isRest(hit('q', ['kick', 'hi_hat_closed'])), false);
});

// ── Drums and chords ─────────────────────────────────────────────────────────

test('placing into an empty bar creates a quarter note with that drum', () => {
  assert.deepEqual(toggleDrum(bar(), 0, 'snare').notes, [hit('q')]);
});

test('a new note inherits the previous duration and dot only when it fits', () => {
  assert.deepEqual(toggleDrum(bar(hit('8', ['kick'], true)), 1, 'snare').notes[1],
    hit('8', ['snare'], true));
  const almostFull = bar(hit('h', ['snare'], true));  // 144 of 192 ticks
  assert.deepEqual(toggleDrum(almostFull, 1, 'snare').notes[1], hit('q'));
});

test('a note added after a triplet is a plain note', () => {
  const after = toggleDrum(bar(trip('8'), trip('8'), trip('8')), 3, 'kick').notes[3];
  assert.deepEqual(after, hit('8', ['kick']));
});

test('placing into a full bar is refused and returns the same bar', () => {
  const full = bar(hit('w'));
  assert.equal(toggleDrum(full, 1, 'snare'), full);
});

test('pressing another drum builds a chord; pressing it again removes it', () => {
  const chord = toggleDrum(bar(hit('8', ['kick'])), 0, 'hi_hat_closed').notes[0];
  assert.deepEqual(chord, hit('8', ['kick', 'hi_hat_closed']));
  const withoutKick = toggleDrum(frozen({ notes: [chord] }), 0, 'kick').notes[0];
  assert.deepEqual(withoutKick, hit('8', ['hi_hat_closed']));
});

test('removing the last drum leaves a rest of the same length', () => {
  const toggled = toggleDrum(bar(hit('q', ['snare'], true)), 0, 'snare').notes[0];
  assert.equal(isRest(toggled), true);
  assert.equal(noteTicks(toggled), 72);
});

test('a drum on a rest keeps the rest length', () => {
  assert.deepEqual(toggleDrum(bar(rest('8')), 0, 'ride_bell').notes[0], hit('8', ['ride_bell']));
});

test('open and closed hi-hat are different drums, so they chord rather than toggle', () => {
  const both = toggleDrum(bar(hit('8', ['hi_hat_closed'])), 0, 'hi_hat_open_full').notes[0];
  assert.deepEqual(both.drums, ['hi_hat_closed', 'hi_hat_open_full']);
});

// ── Dots and durations ───────────────────────────────────────────────────────

test('toggleDot respects capacity; 16ths can be dotted but 32nds and triplets cannot', () => {
  assert.equal(toggleDot(bar(hit('q')), 0).notes[0].dotted, true);
  assert.equal(toggleDot(bar(hit('16')), 0).notes[0].dotted, true);
  const thirtySecond = bar(hit('32'));
  assert.equal(toggleDot(thirtySecond, 0), thirtySecond);
  const triplet = bar(trip('8', ['snare']), trip('8'), trip('8'));
  assert.equal(toggleDot(triplet, 0), triplet);
  const full = bar(hit('q'), hit('q'), hit('q'), hit('q'));
  assert.equal(toggleDot(full, 0), full);
  assert.equal(toggleDot(bar(hit('h', ['snare'], true), hit('q')), 0).notes[0].dotted, false);
});

test('changeDuration walks down to 32nds, clamps at the ends, and blocks overflow', () => {
  assert.equal(changeDuration(bar(hit('q')), 0, 1).notes[0].duration, 'h');
  assert.equal(changeDuration(bar(hit('16')), 0, -1).notes[0].duration, '32');
  const whole = bar(hit('w'));
  assert.equal(changeDuration(whole, 0, 1), whole);
  const thirtySecond = bar(hit('32'));
  assert.equal(changeDuration(thirtySecond, 0, -1), thirtySecond);
  const crowded = bar(hit('h'), hit('q'), hit('q'));
  assert.equal(changeDuration(crowded, 1, 1), crowded);
});

test('changeDuration refuses a dotted 32nd and any triplet note', () => {
  const dottedSixteenth = bar(hit('16', ['snare'], true));
  assert.equal(changeDuration(dottedSixteenth, 0, -1), dottedSixteenth);
  const triplet = bar(trip('8', ['snare']), trip('8'), trip('8'));
  assert.equal(changeDuration(triplet, 1, -1), triplet);
});

// ── Triplets ─────────────────────────────────────────────────────────────────

test('tripletStarts finds groups of three same-duration triplet notes', () => {
  const b = bar(trip('8'), trip('8'), trip('8'), hit('8'), trip('16'), trip('16'), trip('16'));
  assert.deepEqual(tripletStarts(b), [0, 4]);
  assert.equal(tripletGroupStart(b, 2), 0);
  assert.equal(tripletGroupStart(b, 3), -1);
  assert.equal(tripletGroupStart(b, 6), 4);
});

test('T on two eighths makes three triplet eighths in the same time', () => {
  const before = bar(hit('8', ['kick']), hit('8', ['snare']), hit('h', ['crash']));
  const after = toggleTriplet(before, 0);
  assert.deepEqual(after.notes, [trip('8', ['kick']), trip('8', ['snare']), trip('8'), hit('h', ['crash'])]);
  assert.equal(barTicks(after), barTicks(before));
});

test('each triplet slot collects the drums that started in its third of the span', () => {
  const before = bar(hit('8', ['kick']), hit('32', ['snare']), hit('32', ['hi_hat_closed']), hit('16', ['crash']));
  assert.deepEqual(toggleTriplet(before, 0).notes, [
    trip('8', ['kick']), trip('8', ['snare', 'hi_hat_closed']), trip('8', ['crash']),
  ]);
});

test('T at the end of a bar uses free room for the rest of the group', () => {
  const after = toggleTriplet(bar(hit('h', ['kick']), hit('q', ['snare'])), 1);
  assert.deepEqual(after.notes, [hit('h', ['kick']), trip('q', ['snare']), trip('q'), trip('q')]);
  assert.equal(barTicks(after), BAR_TICKS);
});

test('T is refused when a note crosses the group, the bar is full, or the note cannot be a triplet', () => {
  const crossing = bar(hit('8', ['kick']), hit('q', ['snare']));
  assert.equal(toggleTriplet(crossing, 0), crossing);
  const full = bar(hit('h'), hit('q'), hit('q'));
  assert.equal(toggleTriplet(full, 2), full);
  const thirtySecond = bar(hit('32'), hit('32'));
  assert.equal(toggleTriplet(thirtySecond, 0), thirtySecond);
  const dotted = bar(hit('8', ['snare'], true), hit('16'));
  assert.equal(toggleTriplet(dotted, 0), dotted);
  const intoTriplet = bar(hit('8'), trip('16'), trip('16'), trip('16'));
  assert.equal(toggleTriplet(intoTriplet, 0), intoTriplet);
});

test('T on any triplet note turns the group back into two plain notes', () => {
  const group = bar(trip('8', ['kick']), trip('8', ['snare']), trip('8', ['hi_hat_closed']), hit('h'));
  const after = toggleTriplet(group, 2);
  assert.deepEqual(after.notes, [hit('8', ['kick']), hit('8', ['snare', 'hi_hat_closed']), hit('h')]);
  assert.equal(barTicks(after), barTicks(group));
});

// ── Backspace and cursor movement ────────────────────────────────────────────

test('backspace turns a chord into an equal rest, deletes a rest, and ignores the end', () => {
  const converted = backspaceAt(bar(hit('q', ['kick', 'crash'], true)), 0);
  assert.deepEqual(converted, { bar: { notes: [rest('q', true)] }, removedRest: false });
  assert.deepEqual(backspaceAt(bar(hit('q'), rest('q')), 1), { bar: { notes: [hit('q')] }, removedRest: true });
  const single = bar(hit('q'));
  assert.equal(backspaceAt(single, 1).bar, single);
});

test('backspace clears a triplet hit but never deletes a triplet rest', () => {
  const group = bar(trip('8', ['kick']), trip('8'), trip('8'));
  assert.deepEqual(backspaceAt(group, 0).bar.notes[0], trip('8'));
  assert.deepEqual(backspaceAt(group, 1), { bar: group, removedRest: false });
});

test('moveRight skips empty bars, adding a new bar at the end of the score', () => {
  const bars = frozen([{ notes: [rest('q')] }]);
  const moved = moveRight(bars, frozen({ barIndex: 0, noteIndex: 0, position: 3 }));
  assert.deepEqual(moved.bars, [{ notes: [rest('q')] }, { notes: [] }]);
  assert.deepEqual(moved.cursor, { barIndex: 1, noteIndex: 0, position: 3 });
});

test('moveRight steps through existing notes before adding anything', () => {
  const bars = frozen([{ notes: [hit('q'), hit('q')] }]);
  const moved = moveRight(bars, frozen({ barIndex: 0, noteIndex: 0, position: 1 }));
  assert.equal(moved.bars, bars);
  assert.equal(moved.cursor.noteIndex, 1);
});

test('moveRight at the last note adds an undotted rest that fits', () => {
  const dotted = moveRight(frozen([{ notes: [hit('q', ['snare'], true)] }]), frozen({ barIndex: 0, noteIndex: 0 }));
  assert.deepEqual(dotted.bars[0].notes[1], rest('q'));
  const long = moveRight(frozen([{ notes: [hit('h', ['snare'], true)] }]), frozen({ barIndex: 0, noteIndex: 0 }));
  assert.deepEqual(long.bars[0].notes[1], rest('q'));
  assert.equal(long.cursor.noteIndex, 1);
});

test('moveRight from a full bar goes to the existing next bar without adding one', () => {
  const bars = frozen([{ notes: [hit('w')] }, { notes: [] }]);
  const moved = moveRight(bars, frozen({ barIndex: 0, noteIndex: 0 }));
  assert.equal(moved.bars, bars);
  assert.deepEqual(moved.cursor, { barIndex: 1, noteIndex: 0 });
});

test('moveLeft steps back within a bar, then to the last note of the previous bar', () => {
  const bars = frozen([{ notes: [hit('q'), hit('q')] }, { notes: [] }, { notes: [hit('h')] }]);
  assert.deepEqual(moveLeft(bars, { barIndex: 2, noteIndex: 1 }), { barIndex: 2, noteIndex: 0 });
  assert.deepEqual(moveLeft(bars, { barIndex: 1, noteIndex: 0 }), { barIndex: 0, noteIndex: 1 });
  assert.deepEqual(moveLeft(bars, { barIndex: 2, noteIndex: 0 }), { barIndex: 1, noteIndex: 0 });
  const start = frozen({ barIndex: 0, noteIndex: 0 });
  assert.equal(moveLeft(bars, start), start);
});
