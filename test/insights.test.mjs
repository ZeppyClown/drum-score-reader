import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSelection, selectBarsCommand, clickBarCommand, rangeLabel } from '../js/selection.js';
import { buildInsights, citationTarget } from '../js/insights.js';
import { execute, toggleDrumCommand, undo } from '../js/commands.js';
import { scoreSnapshot } from '../js/score-snapshot.js';
import { songEditor } from './fixture-scores.mjs';

test('selection is stored by bar id, resolves in reading order, and never changes the revision', () => {
  const editor = songEditor();
  const ids = editor.bars.map(b => b.barId);
  const selected = execute(editor, selectBarsCommand(ids[7], ids[6]));
  assert.deepEqual(resolveSelection(selected), { fromIndex: 6, toIndex: 7 });
  assert.equal(selected.meta.revision, editor.meta.revision);
  assert.equal(selected.history, editor.history);
  assert.equal(resolveSelection(editor), null);
  assert.equal(resolveSelection({ ...selected, selection: { fromBarId: 'gone', toBarId: ids[1] } }), null);
  assert.equal(execute(selected, selectBarsCommand(ids[7], ids[6])), selected);
  assert.equal(execute(selected, selectBarsCommand(null)).selection, null);
});

test('click selects one bar and moves the cursor; shift-click extends from the anchor', () => {
  let editor = execute(songEditor(), clickBarCommand(2, false));
  assert.deepEqual(resolveSelection(editor), { fromIndex: 2, toIndex: 2 });
  assert.equal(editor.cursor.barIndex, 2);
  editor = execute(editor, clickBarCommand(5, true));
  assert.deepEqual(resolveSelection(editor), { fromIndex: 2, toIndex: 5 });
  editor = execute(editor, clickBarCommand(0, true));
  assert.deepEqual(resolveSelection(editor), { fromIndex: 0, toIndex: 2 });
  assert.equal(execute(editor, clickBarCommand(99, false)), editor);
});

test('range labels read naturally', () => {
  assert.equal(rangeLabel(3, 3), 'bar 3');
  assert.equal(rangeLabel(7, 8), 'bars 7–8');
});

test('insight cards cite bars with ids and the revision they were computed for', () => {
  const editor = songEditor();
  const insights = buildInsights(scoreSnapshot(editor));
  assert.equal(insights.revision, editor.meta.revision);
  assert.equal(insights.scoreId, editor.meta.scoreId);
  assert.deepEqual(insights.cards.map(c => c.kind), ['overview', 'complex', 'repeats', 'fills', 'review']);
  const complex = insights.cards.find(c => c.kind === 'complex');
  assert.deepEqual(complex.items[0].citation, { fromBar: 7, toBar: 8, fromBarId: editor.bars[6].barId, toBarId: editor.bars[7].barId });
  assert.match(complex.items[0].text, /notation/i);
  const repeats = insights.cards.find(c => c.kind === 'repeats');
  assert.match(repeats.items[0].text, /bars 1, 2, 3, 4 and 6/);
  assert.match(repeats.items[1].text, /92% the same as bar 1/);
  assert.deepEqual(repeats.items[1].citation.fromBar, 5);
  const review = insights.cards.find(c => c.kind === 'review');
  assert.deepEqual(review.items.map(i => i.citation.fromBar), [10]);
  assert.equal(JSON.stringify(insights).includes('Ignore previous instructions'), false);
});

test('a citation only resolves on the same score and revision, by bar id', () => {
  const editor = songEditor();
  const insights = buildInsights(scoreSnapshot(editor));
  const citation = insights.cards.find(c => c.kind === 'complex').items[0].citation;
  assert.deepEqual(citationTarget(editor, insights, citation), { ok: true, fromIndex: 6, toIndex: 7 });
  const edited = execute(editor, toggleDrumCommand('crash'));
  assert.match(citationTarget(edited, insights, citation).reason, /changed/);
  assert.match(citationTarget(undo(edited), insights, citation).reason, /changed/);  // revision moved on
  const other = songEditor();
  assert.match(citationTarget(other, { ...insights, scoreId: 'another' }, citation).reason, /different score/);
});
