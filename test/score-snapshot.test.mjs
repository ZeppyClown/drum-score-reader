import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { scoreSnapshot, validateSnapshot, snapshotHash, MAX_SNAPSHOT_BARS } from '../js/score-snapshot.js';
import { sha256 } from '../js/sha256.js';
import { execute, toggleDrumCommand, moveCursorCommand, goToBarCommand } from '../js/commands.js';
import { songEditor, counter } from './fixture-scores.mjs';

test('sha256 matches Node crypto, including multi-block and non-ASCII text', () => {
  for (const text of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(1000), 'ドラム 🥁']) {
    assert.equal(sha256(text), crypto.createHash('sha256').update(text).digest('hex'));
  }
});

test('snapshot carries ids, revision, meter, tempo and the cursor selection — never the title', () => {
  const editor = execute(songEditor(), goToBarCommand(9));
  const snap = scoreSnapshot(editor);
  assert.equal(snap.schemaVersion, 1);
  assert.equal(snap.scoreId, editor.meta.scoreId);
  assert.equal(snap.revision, editor.meta.revision);
  assert.deepEqual(snap.meter, { beats: 4, beatUnit: 4 });
  assert.equal(snap.tempoBpm, 100);
  assert.equal(snap.totalBars, 10);
  assert.deepEqual(snap.range, { fromBar: 1, toBar: 10 });
  assert.equal(snap.truncated, false);
  assert.deepEqual(snap.selection, { barId: editor.bars[9].barId, eventId: editor.bars[9].notes[0].eventId, barNumber: 10 });
  assert.equal(JSON.stringify(snap).includes('Ignore previous instructions'), false);
  assert.match(snap.snapshotHash, /^[0-9a-f]{64}$/);
});

test('events have exact onset and duration ticks, including dots and triplets', () => {
  const snap = scoreSnapshot(songEditor());
  const triplets = snap.bars[9];
  assert.equal(triplets.barNumber, 10);
  assert.equal(triplets.reviewed, false);
  assert.equal(triplets.source, 'local_omr');
  assert.equal(triplets.warningCount, 1);
  assert.equal(JSON.stringify(triplets).includes('shortened'), false, 'warning text never enters a snapshot');
  assert.deepEqual(triplets.events.map(e => [e.onsetTicks, e.durationTicks, e.writtenDuration, e.dotted, e.triplet, e.isRest]), [
    [0, 16, '8', false, true, false],
    [16, 16, '8', false, true, false],
    [32, 16, '8', false, true, false],
    [48, 48, 'q', false, false, true],
    [96, 72, 'q', true, false, false],
    [168, 24, '8', false, false, false],
  ]);
  assert.deepEqual(snap.bars[0].events[0].drums, ['hi_hat_closed', 'kick']);  // sorted, stable
  assert.equal(snap.bars[0].reviewed, true);
  assert.equal(snap.bars[0].warningCount, 0);
});

test('the hash is stable for the same score and changes with any edit or revision', () => {
  const editor = songEditor({ idFactory: counter() });
  const again = songEditor({ idFactory: counter() });
  assert.equal(scoreSnapshot(editor).snapshotHash, scoreSnapshot(again).snapshotHash);
  const edited = execute(editor, toggleDrumCommand('crash'));
  assert.notEqual(scoreSnapshot(edited).snapshotHash, scoreSnapshot(editor).snapshotHash);
  const moved = execute(editor, moveCursorCommand(1));  // cursor slot only: same selection
  assert.equal(scoreSnapshot(moved).snapshotHash, scoreSnapshot(editor).snapshotHash);
  const snap = scoreSnapshot(editor);
  const { snapshotHash: hash, ...rest } = snap;
  assert.equal(snapshotHash(rest), hash);
});

test('ranges are bounded and clamped', () => {
  const editor = songEditor();
  const part = scoreSnapshot(editor, { fromBar: 7, toBar: 8 });
  assert.deepEqual(part.bars.map(b => b.barNumber), [7, 8]);
  assert.deepEqual(part.range, { fromBar: 7, toBar: 8 });
  assert.equal(part.totalBars, 10);
  assert.deepEqual(scoreSnapshot(editor, { fromBar: 0, toBar: 99 }).range, { fromBar: 1, toBar: 10 });
  assert.deepEqual(scoreSnapshot(editor, { fromBar: 9, toBar: 3 }).range, { fromBar: 3, toBar: 9 });
  const tight = scoreSnapshot(editor, { maxBars: 4 });
  assert.equal(tight.bars.length, 4);
  assert.equal(tight.truncated, true);
  assert.equal(MAX_SNAPSHOT_BARS, 64);
});

test('validateSnapshot accepts a real snapshot and rejects tampering', () => {
  const snap = scoreSnapshot(songEditor());
  assert.deepEqual(validateSnapshot(snap), []);
  const cases = [
    [{ ...snap, snapshotHash: 'f'.repeat(64) }, /hash/],
    [{ ...snap, revision: -1 }, /revision/],
    [{ ...snap, bars: snap.bars.map((b, i) => (i ? b : { ...b, events: [{ ...b.events[0], onsetTicks: 5 }, ...b.events.slice(1)] })) }, /onset/],
    [{ ...snap, bars: snap.bars.map((b, i) => (i ? b : { ...b, events: [{ ...b.events[0], drums: ['cowbell'] }] })) }, /drum/],
    [{ ...snap, bars: [...snap.bars, snap.bars[0]] }, /Duplicate|bar numbers/],
    [{ ...snap, extra: 'hi' }, /Unknown field/],
    [{ ...snap, selection: { barId: 'bogus', eventId: null, barNumber: 3 } }, /selection/],
    [{ ...snap, selection: { ...snap.selection, barNumber: 999 } }, /selection/],
    [{ ...snap, selection: { ...snap.selection, eventId: 'not-an-event' } }, /selection/],
    [{ ...snap, truncated: true }, /truncated/],
    [{ ...snap, bars: snap.bars.slice(0, 3) }, /bar numbers/],
    [null, /object/],
  ];
  for (const [bad, pattern] of cases) {
    const errors = validateSnapshot(bad);
    assert.ok(errors.some(e => pattern.test(e)), `${pattern} → ${errors}`);
  }
});
