import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAskRequest, questionScope } from '../js/ask-request.js';
import { validateSnapshot } from '../js/score-snapshot.js';
import { execute, goToBarCommand, createEditor } from '../js/commands.js';
import { selectBarsCommand } from '../js/selection.js';
import { createMeta } from '../js/score-document.js';
import { songEditor } from './fixture-scores.mjs';

test('selection questions use the selected bars, or the cursor bar, plus one bar either side for the tools', () => {
  let editor = execute(songEditor(), goToBarCommand(4));
  assert.deepEqual(questionScope(editor, 'selection'), { fromBar: 5, toBar: 5 });
  const cursor = buildAskRequest(editor, { questionId: 'explain-bar' });
  assert.deepEqual(cursor.scope, { fromBar: 5, toBar: 5 });
  assert.deepEqual(cursor.snapshot.range, { fromBar: 4, toBar: 6 });
  assert.equal(cursor.label, 'Explain these bars');
  editor = execute(editor, selectBarsCommand(editor.bars[9].barId, editor.bars[8].barId));
  const selected = buildAskRequest(editor, { question: 'What changes here?', kind: 'selection' });
  assert.deepEqual(selected.scope, { fromBar: 9, toBar: 10 });
  assert.deepEqual(selected.snapshot.range, { fromBar: 8, toBar: 10 });
  assert.equal(selected.question, 'What changes here?');
  assert.deepEqual(validateSnapshot(selected.snapshot), []);
});

test('score questions share the whole score, capped at 64 bars with the scope clamped to match', () => {
  assert.deepEqual(buildAskRequest(songEditor(), { questionId: 'find-repeats' }).snapshot.range, { fromBar: 1, toBar: 10 });
  const long = createEditor({ meta: createMeta(), bars: Array.from({ length: 80 }, () => ({ notes: [] })) });
  const request = buildAskRequest(long, { question: 'Overview?', kind: 'score' });
  assert.equal(request.snapshot.truncated, true);
  assert.deepEqual(request.scope, { fromBar: 1, toBar: 64 });
  assert.deepEqual(validateSnapshot(request.snapshot), []);
});
