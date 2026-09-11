import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isRest, noteTicks, barTicks, fitDuration, toggleDrum, toggleDot, changeDuration,
  backspaceAt, moveRight, moveLeft,
} from '../js/bar.js';

function hit(duration, drums = ['snare'], dotted = false) {
  return { duration, dotted, drums };
}

function rest(duration, dotted = false) {
  return { duration, dotted, drums: [] };
}

// Freezing the input proves every rule returns new data instead of editing it.
function frozen(value) {
  Object.values(value).forEach(v => { if (v && typeof v === 'object') frozen(v); });
  return Object.freeze(value);
}

const bar = (...notes) => frozen({ notes });

test('ticks: durations, dots, and the quarter-note default', () => {
  assert.equal(noteTicks(hit('q')), 4);
  assert.equal(noteTicks(hit('q', ['snare'], true)), 6);
  assert.equal(noteTicks(hit('8', ['snare'], true)), 3);
  assert.equal(noteTicks({ drums: [] }), 4);
  assert.equal(barTicks(bar(hit('h'), rest('8'), hit('16'), hit('16'))), 12);
});

test('fitDuration picks the longest plain duration that fits', () => {
  assert.deepEqual([16, 15, 5, 3, 1, 0].map(fitDuration), ['w', 'h', 'q', '8', '16', '16']);
});

test('a note with no drums is a rest', () => {
  assert.equal(isRest(rest('q')), true);
  assert.equal(isRest(hit('q', ['kick', 'hi_hat_closed'])), false);
});

test('placing into an empty bar creates a quarter note with that drum', () => {
  assert.deepEqual(toggleDrum(bar(), 0, 'snare').notes, [hit('q')]);
});

test('a new note inherits the previous duration and dot only when it fits', () => {
  assert.deepEqual(toggleDrum(bar(hit('8', ['kick'], true)), 1, 'snare').notes[1],
    hit('8', ['snare'], true));
  const almostFull = bar(hit('h', ['snare'], true));  // 12 of 16 ticks
  assert.deepEqual(toggleDrum(almostFull, 1, 'snare').notes[1], hit('q'));
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
  assert.equal(noteTicks(toggled), 6);
});

test('a drum on a rest keeps the rest length', () => {
  assert.deepEqual(toggleDrum(bar(rest('8')), 0, 'ride_bell').notes[0], hit('8', ['ride_bell']));
});

test('open and closed hi-hat are different drums, so they chord rather than toggle', () => {
  const both = toggleDrum(bar(hit('8', ['hi_hat_closed'])), 0, 'hi_hat_open_full').notes[0];
  assert.deepEqual(both.drums, ['hi_hat_closed', 'hi_hat_open_full']);
});

test('toggleDot respects capacity and never dots a semiquaver', () => {
  assert.equal(toggleDot(bar(hit('q')), 0).notes[0].dotted, true);
  const sixteenth = bar(hit('16'));
  assert.equal(toggleDot(sixteenth, 0), sixteenth);
  const full = bar(hit('q'), hit('q'), hit('q'), hit('q'));
  assert.equal(toggleDot(full, 0), full);
  assert.equal(toggleDot(bar(hit('h', ['snare'], true), hit('q')), 0).notes[0].dotted, false);
});

test('changeDuration walks the ladder, clamps at the ends, and blocks overflow', () => {
  assert.equal(changeDuration(bar(hit('q')), 0, 1).notes[0].duration, 'h');
  assert.equal(changeDuration(bar(hit('q')), 0, -1).notes[0].duration, '8');
  const whole = bar(hit('w'));
  assert.equal(changeDuration(whole, 0, 1), whole);
  const sixteenth = bar(hit('16'));
  assert.equal(changeDuration(sixteenth, 0, -1), sixteenth);
  const crowded = bar(hit('h'), hit('q'), hit('q'));
  assert.equal(changeDuration(crowded, 1, 1), crowded);
});

test('backspace turns a chord into an equal rest, deletes a rest, and ignores the end', () => {
  const converted = backspaceAt(bar(hit('q', ['kick', 'crash'], true)), 0);
  assert.deepEqual(converted, { bar: { notes: [rest('q', true)] }, removedRest: false });
  assert.deepEqual(backspaceAt(bar(hit('q'), rest('q')), 1), { bar: { notes: [hit('q')] }, removedRest: true });
  const single = bar(hit('q'));
  assert.equal(backspaceAt(single, 1).bar, single);
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
