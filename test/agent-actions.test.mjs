import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTION_SCHEMA, ACTION_TYPES, actionCommand, applyConfirmed, describeAction,
  finalizeActions, validateActions,
} from '../js/agent-actions.js';
import { EXERCISES } from '../js/exercise-catalogue.js';
import { execute } from '../js/commands.js';
import { scoreSnapshot } from '../js/score-snapshot.js';
import { songEditor } from './fixture-scores.mjs';

const fields = (type, values = {}) => ({
  type, fromBar: null, toBar: null, tempoBpm: null, exerciseId: null,
  reason: 'This will help you practise.', ...values,
});

test('action schema is a strict, bounded array with nullable unused fields', () => {
  assert.deepEqual(ACTION_TYPES, ['select_bars', 'set_loop', 'set_tempo', 'open_exercise']);
  assert.equal(ACTION_SCHEMA.type, 'array');
  // Limits live in validateActions; strict structured outputs may refuse length/count keywords.
  assert.equal(JSON.stringify(ACTION_SCHEMA).match(/maxItems|minLength|maxLength/), null);
  const item = ACTION_SCHEMA.items;
  assert.equal(item.type, 'object');
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(item.required, ['type', 'fromBar', 'toBar', 'tempoBpm', 'exerciseId', 'reason']);
  assert.deepEqual(item.properties.fromBar.type, ['integer', 'null']);
  assert.deepEqual(item.properties.toBar.type, ['integer', 'null']);
  assert.deepEqual(item.properties.tempoBpm.type, ['integer', 'null']);
  assert.deepEqual(item.properties.exerciseId.type, ['string', 'null']);
  assert.equal(item.properties.reason.type, 'string');
});

test('validates every action type and normalizes the strict fields', () => {
  const editor = songEditor();
  const snapshot = scoreSnapshot(editor);
  const raw = [
    fields('select_bars', { fromBar: 7, toBar: 8 }),
    fields('set_loop', { fromBar: 2, toBar: 2 }),
    fields('set_tempo', { tempoBpm: 140 }),
  ];
  const result = validateActions(raw, { snapshot, editor, exercises: EXERCISES });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.actions, raw);
  assert.deepEqual(validateActions([fields('open_exercise', { exerciseId: 'sixteenth-hat-grid' })], {
    snapshot, editor, exercises: EXERCISES,
  }).actions, [fields('open_exercise', { exerciseId: 'sixteenth-hat-grid' })]);
});

test('rejects malformed actions, invalid ranges, tempos, exercises and unused values', () => {
  const editor = songEditor();
  const snapshot = scoreSnapshot(editor, { fromBar: 3, toBar: 8 });
  const cases = [
    [null, /actions array/],
    [[fields('nope')], /type/],
    [[{ ...fields('select_bars'), fromBar: 7 }], /missing|whole bar/],
    [[{ ...fields('select_bars'), fromBar: 7, toBar: 8, tempoBpm: 80 }], /unused.*tempoBpm/],
    [[fields('select_bars', { fromBar: 2, toBar: 8 })], /snapshot/],
    [[fields('select_bars', { fromBar: 1, toBar: 9 })], /snapshot/],
    [[fields('select_bars', { fromBar: 9, toBar: 11 })], /snapshot|score/],
    [[fields('select_bars', { fromBar: 7.5, toBar: 8 })], /whole bar/],
    [[fields('set_tempo', { tempoBpm: 39 })], /40 to 220/],
    [[fields('set_tempo', { tempoBpm: 141 })], /within 40%/],
    [[fields('set_tempo', { tempoBpm: 70.5 })], /whole-number/],
    [[fields('open_exercise', { exerciseId: 'not-in-catalogue' })], /exerciseId/],
    [[{ ...fields('set_tempo', { tempoBpm: 70 }), extra: null }], /unknown field/],
    [[fields('set_tempo', { tempoBpm: 70, reason: '' })], /reason/],
  ];
  for (const [raw, pattern] of cases) {
    const result = validateActions(raw, { snapshot, editor, exercises: EXERCISES });
    assert.equal(result.actions.length, 0, `${pattern} should drop the invalid action`);
    assert.ok(result.problems.some(problem => pattern.test(problem)), `${pattern} → ${result.problems}`);
  }
  const tooMany = validateActions([fields('set_tempo', { tempoBpm: 60 }), fields('set_tempo', { tempoBpm: 61 }), fields('set_tempo', { tempoBpm: 62 }), fields('set_tempo', { tempoBpm: 63 })], { snapshot, editor, exercises: EXERCISES });
  assert.equal(tooMany.actions.length, 3);
  assert.match(tooMany.problems.join(' '), /at most 3/);
});

test('drops duplicate proposals while keeping the first one', () => {
  const editor = songEditor();
  const action = fields('select_bars', { fromBar: 7, toBar: 8, reason: 'Try this busy part.' });
  const result = validateActions([action, { ...action, reason: 'The same bars are useful.' }], {
    snapshot: scoreSnapshot(editor), editor, exercises: EXERCISES,
  });
  assert.deepEqual(result.actions, [action]);
  assert.ok(result.problems.some(problem => /duplicate/i.test(problem)));
});

test('describes actions in child-friendly preview language', () => {
  assert.equal(describeAction(fields('select_bars', { fromBar: 7, toBar: 8 })), 'Select bars 7–8');
  assert.equal(describeAction(fields('set_loop', { fromBar: 7, toBar: 8 })), 'Loop bars 7–8');
  assert.equal(describeAction(fields('set_tempo', { tempoBpm: 70, scoreTempoBpm: 100 })), 'Practise at 70 BPM (the score is 100 BPM)');
  assert.equal(describeAction(fields('open_exercise', { exerciseId: 'sixteenth-hat-grid' })), "Open the exercise 'Sixteenth Hat Grid'");
});

test('finalizes actions with score version, bar IDs and unique IDs', () => {
  const editor = songEditor();
  const snapshot = scoreSnapshot(editor);
  const action = fields('set_loop', { fromBar: 7, toBar: 8 });
  const [final] = finalizeActions([action], snapshot);
  assert.deepEqual(final, {
    ...action,
    scoreId: snapshot.scoreId,
    revision: snapshot.revision,
    fromBarId: editor.bars[6].barId,
    toBarId: editor.bars[7].barId,
    id: `action-${snapshot.scoreId}-${snapshot.revision}-1`,
  });
});

test('confirmation and stale-version checks protect proposed actions', () => {
  const editor = songEditor();
  const snapshot = scoreSnapshot(editor);
  const action = finalizeActions([fields('select_bars', { fromBar: 7, toBar: 8 })], snapshot)[0];
  assert.deepEqual(applyConfirmed(editor, action, { confirmed: false }), { editor, effect: null });
  assert.deepEqual(applyConfirmed(editor, { ...action, revision: action.revision + 1 }, { confirmed: true }), { editor, effect: null });
  assert.deepEqual(applyConfirmed(editor, { ...action, scoreId: 'another-score' }, { confirmed: true }), { editor, effect: null });
});

test('selection and loop actions change selection only, not score data', () => {
  const before = songEditor();
  const snapshot = scoreSnapshot(before);
  const notes = before.bars;
  const selection = finalizeActions([fields('select_bars', { fromBar: 7, toBar: 8 })], snapshot)[0];
  const loop = finalizeActions([fields('set_loop', { fromBar: 7, toBar: 8 })], snapshot)[0];
  const selected = applyConfirmed(before, selection, { confirmed: true });
  const looped = applyConfirmed(before, loop, { confirmed: true });
  assert.deepEqual(selected.editor.selection, { fromBarId: before.bars[6].barId, toBarId: before.bars[7].barId });
  assert.deepEqual(looped.editor.selection, selected.editor.selection);
  assert.equal(selected.editor.meta.revision, before.meta.revision);
  assert.equal(looped.editor.meta.revision, before.meta.revision);
  assert.equal(selected.editor.bars, notes);
  assert.equal(looped.editor.bars, notes);
  assert.equal(selected.effect, null);
  assert.deepEqual(looped.effect, { kind: 'playback', loop: true });
});

test('tempo and exercise actions return effects without editing the score', () => {
  const before = songEditor();
  const snapshot = scoreSnapshot(before);
  const tempo = finalizeActions([fields('set_tempo', { tempoBpm: 70 })], snapshot)[0];
  const exercise = finalizeActions([fields('open_exercise', { exerciseId: 'sixteenth-hat-grid' })], snapshot)[0];
  const changedTempo = applyConfirmed(before, tempo, { confirmed: true });
  const opened = applyConfirmed(before, exercise, { confirmed: true });
  assert.equal(changedTempo.editor, before);
  assert.deepEqual(changedTempo.effect, { kind: 'playback', tempoBpm: 70 });
  assert.equal(changedTempo.editor.meta.tempoBpm, 100);
  assert.equal(opened.editor, before);
  assert.deepEqual(opened.effect, { kind: 'exercise', exerciseId: 'sixteenth-hat-grid' });
});

test('action commands remain inert until execute or applyConfirmed runs them', () => {
  const editor = songEditor();
  const action = finalizeActions([fields('select_bars', { fromBar: 7, toBar: 8 })], scoreSnapshot(editor))[0];
  const { command } = actionCommand(action, editor);
  assert.equal(editor.selection, null);
  const applied = execute(editor, command);
  assert.equal(editor.selection, null);
  assert.deepEqual(applied.selection, { fromBarId: editor.bars[6].barId, toBarId: editor.bars[7].barId });
});
