import test from 'node:test';
import assert from 'node:assert/strict';
import { noteGrid, passageQuery, addedMessage } from '../js/library-ui.js';
import { songEditor } from './fixture-scores.mjs';
import { execute, goToBarCommand } from '../js/commands.js';
import { scoreSnapshot } from '../js/score-snapshot.js';
import { selectBarsCommand } from '../js/selection.js';

test('noteGrid makes count and drum text rows from note order', () => {
  assert.deepEqual(noteGrid({ notes: [
    { duration: '8', drums: ['kick', 'hi_hat_closed'] },
    { duration: '8', drums: [] },
    { duration: '8', drums: ['snare'] },
  ] }), [
    { count: '1', drums: 'kick + hi hat closed' },
    { count: '1&', drums: 'rest' },
    { count: '2', drums: 'snare' },
  ]);
});

test('passageQuery inspects selected bars and includes complexity ranking', () => {
  let editor = songEditor();
  editor = execute(editor, selectBarsCommand(editor.bars[6].barId, editor.bars[7].barId));
  const query = passageQuery(editor);
  assert.deepEqual(query.bars.map(bar => bar.barNumber), [7, 8]);
  assert.ok(query.ranked.some(bar => bar.barNumber === 7));
  assert.deepEqual(query.bars[0].smallestNote, '16th');
});

test('passageQuery falls back to the cursor bar', () => {
  const editor = execute(songEditor(), goToBarCommand(9));
  assert.deepEqual(passageQuery(editor).bars.map(bar => bar.barNumber), [10]);
});

test('addedMessage names newly appended bars', () => {
  const before = songEditor();
  const after = { ...before, bars: [...before.bars, { barId: 'new-1' }, { barId: 'new-2' }] };
  assert.equal(addedMessage(before, after, 'Sixteenth Steps'), "Added 'Sixteenth Steps' as bars 11–12");
  assert.equal(addedMessage(before, { ...before, bars: before.bars }, 'Sixteenth Steps'), "Could not add 'Sixteenth Steps'.");
  assert.equal(scoreSnapshot(before).totalBars, 10);
});

test('fill requests only use note values the fill generator accepts', async () => {
  const { fillSubdivision } = await import('../js/library-ui.js');
  assert.deepEqual(['quarter', '8th', 'dotted 8th', '16th', 'dotted 16th', '32nd', 'triplet 8th', 'triplet 16th', undefined].map(fillSubdivision),
    ['8th', '8th', '8th', '16th', '16th', '16th', 'triplet 8th', '16th', '8th']);
});
