import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PlaybackError, buildSchedule, eventsBetween, positionAt,
} from '../js/playback-schedule.js';

const hit = (eventId, duration = 'q', drums = ['snare'], extra = {}) => ({
  eventId, duration, dotted: false, drums, ...extra,
});
const rest = (eventId, duration = 'q', extra = {}) => hit(eventId, duration, [], extra);
const bars = (...notes) => [{ barId: 'bar-1', provenance: {}, notes }];
const options = (overrides = {}) => ({
  tempoBpm: 120, meter: { beats: 4, beatUnit: 4 }, fromBar: 1, toBar: 1, ...overrides,
});

test('simultaneous chord hits share an exact time and hits are sorted by drum', () => {
  const schedule = buildSchedule(bars(hit('a', 'q', ['snare', 'kick'])), options());
  assert.deepEqual(schedule.hits.map(({ time, drum }) => ({ time, drum })), [
    { time: 0, drum: 'kick' }, { time: 0, drum: 'snare' },
  ]);
  assert.ok(Object.isFrozen(schedule) && Object.isFrozen(schedule.hits[0]));
});

test('dotted quarter followed by an eighth uses 72 then 24 ticks', () => {
  const schedule = buildSchedule(bars(
    hit('a', 'q', ['kick'], { dotted: true }), hit('b', '8'),
  ), options());
  assert.deepEqual(schedule.hits.map(h => h.time), [0, 0.75]);
});

test('triplet 16-tick notes at 120 BPM are exactly 1/6 second apart', () => {
  const schedule = buildSchedule(bars(
    hit('a', '8', ['snare'], { triplet: true }),
    hit('b', '8', ['snare'], { triplet: true }),
    hit('c', '8', ['snare'], { triplet: true }),
  ), options());
  assert.deepEqual(schedule.hits.map(h => h.time), [0, 1 / 6, 1 / 3]);
});

test('rests produce no hits but still advance the onset', () => {
  const schedule = buildSchedule(bars(rest('r', 'q'), hit('a', 'q')), options());
  assert.deepEqual(schedule.hits.map(({ noteIndex, time }) => ({ noteIndex, time })), [
    { noteIndex: 1, time: 0.5 },
  ]);
});

test('underfilled bars keep their full meter length', () => {
  const schedule = buildSchedule(bars(hit('a', 'q'), rest('r', 'q')), options());
  assert.equal(schedule.loopSeconds, 2);
  assert.deepEqual(schedule.bars, [{ barIndex: 0, startTime: 0, endTime: 2 }]);
});

test('four count-in clicks precede the first hit by four beats', () => {
  const schedule = buildSchedule(bars(hit('a')), options({ countInBeats: 4 }));
  assert.deepEqual(schedule.clicks.filter(c => c.countIn).map(c => c.time), [0, 0.5, 1, 1.5]);
  assert.equal(schedule.hits[0].time, 2);
  assert.equal(schedule.countInSeconds, 2);
});

test('metronome clicks accent each bar start', () => {
  const twoBars = [
    { barId: 'bar-1', provenance: {}, notes: [hit('a')] },
    { barId: 'bar-2', provenance: {}, notes: [hit('b')] },
  ];
  const schedule = buildSchedule(twoBars, options({ toBar: 2 }));
  assert.deepEqual(schedule.clicks.filter(c => !c.countIn).map(c => [c.time, c.accent]), [
    [0, true], [0.5, false], [1, false], [1.5, false],
    [2, true], [2.5, false], [3, false], [3.5, false],
  ]);
});

test('tempo changes scale all times', () => {
  const slow = buildSchedule(bars(hit('a'), hit('b')), options({ tempoBpm: 60 }));
  const fast = buildSchedule(bars(hit('a'), hit('b')), options({ tempoBpm: 120 }));
  assert.equal(slow.hits[1].time, fast.hits[1].time * 2);
  assert.equal(slow.loopSeconds, fast.loopSeconds * 2);
});

test('bar range selection starts selected bars at zero', () => {
  const source = [1, 2, 3, 4].map((_, i) => ({
    barId: `bar-${i + 1}`, provenance: {}, notes: [hit(`e-${i + 1}`)],
  }));
  const schedule = buildSchedule(source, options({ fromBar: 3, toBar: 4 }));
  assert.deepEqual(schedule.bars.map(b => [b.barIndex, b.startTime]), [[2, 0], [3, 2]]);
  assert.deepEqual(schedule.hits.map(h => [h.barIndex, h.time]), [[2, 0], [3, 2]]);
});

test('eventsBetween crosses a loop boundary without duplicate first-pass items', () => {
  const schedule = buildSchedule(bars(hit('a'), hit('b')), options({ loop: true }));
  const events = eventsBetween(schedule, 1.75, 2.25, { loop: true });
  assert.deepEqual(events.hits.map(h => [h.eventId, h.time, h.loopIndex]), [
    ['b', 1.5, 0], ['a', 2, 1],
  ].filter(([, time]) => time >= 1.75 && time < 2.25));
  assert.deepEqual(events.hits, [{ ...schedule.hits[0], time: 2, loopIndex: 1 }]);
});

test('10,000 loop offsets use the exact loop-index formula', () => {
  const schedule = buildSchedule(bars(hit('a'), hit('b')), options({ countInBeats: 1, loop: true }));
  const events = eventsBetween(schedule, 0, 20001, { loop: true });
  const late = events.hits.find(h => h.loopIndex === 10000 && h.eventId === 'a');
  assert.equal(late.time, 10000 * schedule.loopSeconds + schedule.hits[0].time);
});

test('positionAt finds onsets and the last note between onsets', () => {
  const schedule = buildSchedule(bars(hit('a', 'q'), hit('b', 'q')), options());
  assert.deepEqual(positionAt(schedule, 0), { barIndex: 0, noteIndex: 0, loopIndex: 0 });
  assert.deepEqual(positionAt(schedule, 0.75), { barIndex: 0, noteIndex: 1, loopIndex: 0 });
  assert.equal(positionAt(schedule, 2), null);
  assert.equal(positionAt(buildSchedule(bars(hit('a')), options({ countInBeats: 1 })), 0.25), null);
});

test('positionAt follows looping passages after the count-in', () => {
  const schedule = buildSchedule(bars(hit('a')), options({ countInBeats: 1, loop: true }));
  assert.deepEqual(positionAt(schedule, schedule.loopSeconds + schedule.countInSeconds), {
    barIndex: 0, noteIndex: 0, loopIndex: 1,
  });
});

test('invalid playback options throw PlaybackError with plain-English messages', () => {
  const invalid = [
    options({ tempoBpm: 19 }), options({ tempoBpm: 120.5 }),
    options({ fromBar: 0 }), options({ toBar: 2 }), options({ fromBar: 1, toBar: 0 }),
  ];
  for (const badOptions of invalid) assert.throws(() => buildSchedule(bars(hit('a')), badOptions), PlaybackError);
});
