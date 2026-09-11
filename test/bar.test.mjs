import test from 'node:test';
import assert from 'node:assert/strict';

import {
  noteTicks, barTicks, fitDuration, placeDrum, toggleDot, changeDuration,
  backspaceAt, moveRight, moveLeft,
} from '../js/bar.js';
import { DRUM_DEFS } from '../js/constants.js';

const SNARE = DRUM_DEFS['8'];
const HH_CLOSED = DRUM_DEFS['7'];
const HH_OPEN = DRUM_DEFS['4'];

function hit(duration, def = SNARE, dotted = false) {
  return { duration, dotted, vexKey: def.vexKey, stemDir: def.stemDir, noteType: def.noteType, isRest: false };
}

function rest(duration, dotted = false) {
  return { duration, dotted, isRest: true, vexKey: 'b/4', stemDir: 0 };
}

// Freezing the input proves every rule returns new data instead of editing it.
function frozen(value) {
  Object.values(value).forEach(v => { if (v && typeof v === 'object') frozen(v); });
  return Object.freeze(value);
}

const bar = (...notes) => frozen({ notes });

test('ticks: durations, dots, and the quarter-note default', () => {
  assert.equal(noteTicks(hit('q')), 4);
  assert.equal(noteTicks(hit('q', SNARE, true)), 6);
  assert.equal(noteTicks(hit('8', SNARE, true)), 3);
  assert.equal(noteTicks({}), 4);
  assert.equal(barTicks(bar(hit('h'), rest('8'), hit('16'), hit('16'))), 12);
});

test('fitDuration picks the longest plain duration that fits', () => {
  assert.deepEqual([16, 15, 5, 3, 1, 0].map(fitDuration), ['w', 'h', 'q', '8', '16', '16']);
});

test('placing into an empty bar creates a quarter note from the drum definition', () => {
  assert.deepEqual(placeDrum(bar(), 0, SNARE).notes, [hit('q')]);
});

test('a new note inherits the previous duration and dot only when it fits', () => {
  assert.deepEqual(placeDrum(bar(hit('8', SNARE, true)), 1, SNARE).notes[1], hit('8', SNARE, true));
  const almostFull = bar(hit('h', SNARE, true));  // 12 of 16 ticks
  assert.deepEqual(placeDrum(almostFull, 1, SNARE).notes[1], hit('q'));
});

test('placing into a full bar is refused and returns the same bar', () => {
  const full = bar(hit('w'));
  assert.equal(placeDrum(full, 1, SNARE), full);
});

test('the same drum toggles to a rest of the same length; another drum replaces it', () => {
  const dotted = bar(hit('q', SNARE, true));
  const toggled = placeDrum(dotted, 0, SNARE).notes[0];
  assert.equal(toggled.isRest, true);
  assert.equal(noteTicks(toggled), 6);
  assert.deepEqual(placeDrum(bar(rest('8')), 0, SNARE).notes[0], hit('8'));
});

test('open and closed hi-hat share a staff position but are different drums', () => {
  const replaced = placeDrum(bar(hit('8', HH_CLOSED)), 0, HH_OPEN).notes[0];
  assert.equal(replaced.isRest, false);
  assert.equal(replaced.noteType, 'cx');
});

test('toggleDot respects capacity and never dots a semiquaver', () => {
  assert.equal(toggleDot(bar(hit('q')), 0).notes[0].dotted, true);
  const sixteenth = bar(hit('16'));
  assert.equal(toggleDot(sixteenth, 0), sixteenth);
  const full = bar(hit('q'), hit('q'), hit('q'), hit('q'));
  assert.equal(toggleDot(full, 0), full);
  assert.equal(toggleDot(bar(hit('h', SNARE, true), hit('q')), 0).notes[0].dotted, false);
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

test('backspace turns a hit into an equal rest, deletes a rest, and ignores the end', () => {
  const converted = backspaceAt(bar(hit('q', SNARE, true)), 0);
  assert.deepEqual(converted.bar.notes[0], { ...hit('q', SNARE, true), isRest: true, vexKey: 'b/4', stemDir: 0 });
  assert.equal(converted.removedRest, false);
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
  const dotted = moveRight(frozen([{ notes: [hit('q', SNARE, true)] }]), frozen({ barIndex: 0, noteIndex: 0 }));
  assert.deepEqual(dotted.bars[0].notes[1], rest('q'));
  const long = moveRight(frozen([{ notes: [hit('h', SNARE, true)] }]), frozen({ barIndex: 0, noteIndex: 0 }));
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
