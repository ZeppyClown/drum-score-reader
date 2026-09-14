import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampPracticeTempo, playbackRange, transportStatus,
} from '../js/transport-ui.js';

const editor = (bars, extras = {}) => ({
  bars: bars.map((barId) => ({ barId, notes: [] })),
  cursor: { barIndex: 0, noteIndex: 0 },
  selection: null,
  meta: { tempoBpm: 100, meter: { beats: 4, beatUnit: 4 } },
  ...extras,
});

test('playbackRange uses the whole score unless looping is on', () => {
  const score = editor(['a', 'b', 'c', 'd']);
  assert.deepEqual(playbackRange(score, false), { fromBar: 1, toBar: 4, label: 'bars 1–4' });
  assert.deepEqual(playbackRange(score, true), { fromBar: 1, toBar: 1, label: 'bar 1' });
});

test('playbackRange uses selected bars or the cursor bar for a loop', () => {
  const score = editor(['a', 'b', 'c', 'd'], {
    cursor: { barIndex: 2, noteIndex: 0 },
    selection: { fromBarId: 'd', toBarId: 'c' },
  });
  assert.deepEqual(playbackRange(score, true), { fromBar: 3, toBar: 4, label: 'bars 3–4' });
  assert.deepEqual(playbackRange({ ...score, selection: null }, true), {
    fromBar: 3, toBar: 3, label: 'bar 3',
  });
});

test('clampPracticeTempo returns a whole practice tempo from 40 to 220', () => {
  assert.equal(clampPracticeTempo(39, 100), 40);
  assert.equal(clampPracticeTempo(220.6, 100), 220);
  assert.equal(clampPracticeTempo('137.4', 100), 137);
  assert.equal(clampPracticeTempo(Number.NaN, 100), 100);
});

test('transportStatus gives short plain-English status text', () => {
  assert.equal(transportStatus(), 'Ready to play.');
  assert.equal(transportStatus({ isPlaying: true, tempoBpm: 80 }), 'Playing at 80 BPM.');
  assert.equal(transportStatus({ viewOnly: true }), 'This score is view-only because it is not in 4/4.');
  assert.equal(transportStatus({ changed: true }), 'The score changed. Press Play to hear the new score.');
});
