import test from 'node:test';
import assert from 'node:assert/strict';

import { describeBar, describeScore } from '../js/score-description.js';
import { importedProvenance, manualProvenance } from '../js/score-document.js';

const note = (...drums) => ({ duration: 'eighth', dotted: false, drums });

test('describeBar names each drum once in plain words and counts notes, not rests', () => {
  const bar = { notes: [note('kick', 'hi_hat_closed'), note(), note('snare', 'hi_hat_closed')], provenance: manualProvenance() };
  assert.equal(describeBar(bar, 0), 'Bar 1: 2 notes — kick, closed hi-hat, snare');
});

test('describeBar says when a bar is only rests, selected, under the cursor or not checked', () => {
  const bar = { notes: [note()], provenance: importedProvenance({ source: 'local_omr' }) };
  assert.equal(describeBar(bar, 2, { selected: true, current: true }),
    'Bar 3 (cursor here, selected): rests only; imported, not checked yet');
});

test('describeScore marks the selected range and the cursor bar', () => {
  const bars = ['a', 'b', 'c'].map(barId => ({ barId, notes: [note('ride')], provenance: manualProvenance() }));
  const editor = { bars, selection: { fromBarId: 'c', toBarId: 'b' }, cursor: { barIndex: 0 } };
  assert.deepEqual(describeScore(editor), [
    'Bar 1 (cursor here): 1 note — ride', 'Bar 2 (selected): 1 note — ride', 'Bar 3 (selected): 1 note — ride',
  ]);
});
