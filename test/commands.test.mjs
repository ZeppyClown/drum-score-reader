import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createEditor, execute, undo, redo, canUndo, canRedo, isDirty, markSaved, HISTORY_LIMIT,
  toggleDrumCommand, toggleDotCommand, changeDurationCommand, toggleTripletCommand,
  backspaceCommand, moveRightCommand, moveLeftCommand, moveCursorCommand,
  importBarCommand, setMetadataCommand, markReviewedCommand, documentOf, isReadOnly,
} from '../js/commands.js';
import { createMeta, validateDocument, importedProvenance } from '../js/score-document.js';

function counter(prefix = 'id') {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function fresh() {
  const ids = counter();
  return createEditor({ meta: createMeta({ idFactory: ids }), bars: [{ notes: [] }], idFactory: ids });
}

// Everything except the revision, which always moves forward.
const content = editor => ({ ...documentOf(editor), revision: undefined, cursor: editor.cursor });

test('createEditor gives every bar and note an id and starts clean', () => {
  const editor = fresh();
  assert.equal(editor.bars[0].barId, 'id-2');
  assert.equal(editor.meta.revision, 0);
  assert.equal(isDirty(editor), false);
  assert.equal(canUndo(editor), false);
  assert.deepEqual(validateDocument(documentOf(editor)), []);
});

test('an edit increments the revision exactly once and records history', () => {
  const editor = execute(fresh(), toggleDrumCommand('snare'));
  assert.equal(editor.meta.revision, 1);
  assert.equal(editor.bars[0].notes[0].eventId, 'id-3');
  assert.deepEqual(editor.bars[0].notes[0].drums, ['snare']);
  assert.equal(editor.cursor.position, 5);
  assert.equal(isDirty(editor), true);
  assert.equal(canUndo(editor), true);
  assert.equal(editor.history.past[0].label, 'Add snare');
});

test('a refused edit returns the same editor', () => {
  let editor = fresh();
  editor = execute(editor, toggleDrumCommand('snare'));
  for (let i = 0; i < 3; i++) editor = execute(editor, changeDurationCommand(1));  // q → h → w
  assert.equal(editor.bars[0].notes[0].duration, 'w');
  assert.equal(execute(editor, changeDurationCommand(1)), editor);
  assert.equal(execute(editor, toggleDotCommand()), editor);
});

test('cursor moves do not touch the revision or history', () => {
  let editor = execute(fresh(), toggleDrumCommand('kick'));
  const moved = execute(editor, moveCursorCommand(1));
  assert.equal(moved.meta.revision, editor.meta.revision);
  assert.equal(moved.history, editor.history);
  assert.equal(moved.cursor.position, editor.cursor.position + 1);
  assert.equal(execute(moved, moveLeftCommand()).cursor.noteIndex, 0);
  const top = { ...moved, cursor: { ...moved.cursor, position: 10 } };
  assert.equal(execute(top, moveCursorCommand(1)), top);
});

test('moving right past the last note appends a rest as an undoable edit', () => {
  const editor = execute(fresh(), toggleDrumCommand('kick'));
  const moved = execute(editor, moveRightCommand());
  assert.equal(moved.bars[0].notes.length, 2);
  assert.equal(moved.meta.revision, 2);
  assert.deepEqual(content(undo(moved)), content(editor));
});

test('undo then redo restores the exact score and cursor, with revision still moving forward', () => {
  const steps = [
    toggleDrumCommand('kick'), toggleDrumCommand('hi_hat_closed'), changeDurationCommand(-1),
    moveRightCommand(), toggleDrumCommand('snare'), toggleTripletCommand(), backspaceCommand(),
    setMetadataCommand({ title: 'Groove', tempoBpm: 120 }),
  ];
  const states = [fresh()];
  for (const step of steps) states.push(execute(states.at(-1), step));
  let editor = states.at(-1);
  for (let i = states.length - 2; i >= 0; i--) {
    const before = editor.meta.revision;
    editor = undo(editor);
    assert.deepEqual(content(editor), content(states[i]), `undo to step ${i}`);
    assert.equal(editor.meta.revision, before + 1);
  }
  assert.equal(canUndo(editor), false);
  assert.equal(undo(editor), editor);
  for (let i = 1; i < states.length; i++) {
    editor = redo(editor);
    assert.deepEqual(content(editor), content(states[i]), `redo to step ${i}`);
  }
  assert.equal(canRedo(editor), false);
  assert.equal(redo(editor), editor);
});

test('a new edit after undo clears the redo stack', () => {
  let editor = execute(execute(fresh(), toggleDrumCommand('kick')), toggleDrumCommand('snare'));
  editor = undo(editor);
  assert.equal(canRedo(editor), true);
  editor = execute(editor, toggleDrumCommand('ride'));
  assert.equal(canRedo(editor), false);
});

test('history is bounded', () => {
  let editor = fresh();
  for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
    editor = execute(editor, setMetadataCommand({ tempoBpm: 60 + (i % 100) }));
  }
  assert.equal(editor.history.past.length, HISTORY_LIMIT);
});

test('dirty follows content: undoing back to the saved score is clean again', () => {
  let editor = markSaved(execute(fresh(), toggleDrumCommand('kick')));
  assert.equal(isDirty(editor), false);
  editor = execute(editor, toggleDrumCommand('snare'));
  assert.equal(isDirty(editor), true);
  editor = undo(editor);
  assert.equal(isDirty(editor), false);
  editor = execute(editor, moveCursorCommand(1));
  assert.equal(isDirty(editor), false);
});

test('importing into an empty score replaces the empty bar; otherwise it appends', () => {
  const imported = { notes: [{ duration: 'w', dotted: false, drums: ['crash'] }] };
  const provenance = importedProvenance({ source: 'local_omr', model: 'baseline-14drum-v1', warnings: ['shortened'] });
  let editor = execute(fresh(), importBarCommand({ bar: imported, provenance }));
  assert.equal(editor.bars.length, 1);
  assert.deepEqual(editor.bars[0].provenance, provenance);
  assert.deepEqual(editor.cursor, { barIndex: 0, noteIndex: 0, position: 1 });
  editor = execute(editor, importBarCommand({ bar: imported, provenance }));
  assert.equal(editor.bars.length, 2);
  assert.equal(editor.cursor.barIndex, 1);
  assert.notEqual(editor.bars[0].barId, editor.bars[1].barId);
  assert.deepEqual(validateDocument(documentOf(editor)), []);
});

test('editing an imported bar keeps it unreviewed; only markReviewed reviews it', () => {
  const provenance = importedProvenance({ source: 'openai_omr', model: 'gpt-5.6-luna' });
  let editor = execute(fresh(), importBarCommand({ bar: { notes: [] }, provenance }));
  editor = execute(editor, toggleDrumCommand('snare'));
  assert.equal(editor.bars[0].provenance.reviewed, false);
  editor = execute(editor, markReviewedCommand(0));
  assert.equal(editor.bars[0].provenance.reviewed, true);
  assert.equal(editor.bars[0].provenance.model, 'gpt-5.6-luna');
  assert.equal(execute(editor, markReviewedCommand(0)), editor);
  assert.equal(undo(editor).bars[0].provenance.reviewed, false);
});

test('setMetadata validates and ignores no-op changes', () => {
  const editor = fresh();
  assert.equal(execute(editor, setMetadataCommand({ title: editor.meta.title })), editor);
  assert.throws(() => execute(editor, setMetadataCommand({ tempoBpm: 10 })), /tempo/);
  assert.throws(() => execute(editor, setMetadataCommand({ title: 'x'.repeat(500) })), /title/);
  assert.throws(() => execute(editor, setMetadataCommand({ scoreId: 'hijack' })), /Cannot change scoreId/);
  const titled = execute(editor, setMetadataCommand({ title: '  Back in Black  ' }));
  assert.equal(titled.meta.title, 'Back in Black');
});

test('commands never mutate the editor they are given', () => {
  const editor = execute(fresh(), toggleDrumCommand('kick'));
  const frozen = JSON.stringify(editor);
  for (const command of [toggleDrumCommand('snare'), toggleDotCommand(), changeDurationCommand(-1),
    toggleTripletCommand(), backspaceCommand(), moveRightCommand(), moveCursorCommand(-1),
    setMetadataCommand({ tempoBpm: 100 })]) {
    execute(editor, command);
  }
  undo(editor);
  assert.equal(JSON.stringify(editor), frozen);
});

test('the score inside the editor is frozen, so in-place edits cannot hide unsaved changes', () => {
  const editor = markSaved(execute(fresh(), toggleDrumCommand('kick')));
  assert.throws(() => { editor.bars[0].notes[0].drums.push('snare'); }, TypeError);
  assert.throws(() => { editor.meta.title = 'changed'; }, TypeError);
  assert.throws(() => { editor.cursor.position = 3; }, TypeError);
  assert.equal(isDirty(editor), false);
});

test('a score in an unsupported meter is view-only: edits are refused, the cursor still moves', () => {
  const ids = counter();
  const meta = { ...createMeta({ idFactory: ids }), meter: { beats: 3, beatUnit: 4 } };
  const editor = createEditor({ meta, bars: [{ notes: [{ duration: 'h', dotted: true, drums: ['kick'] }] }], idFactory: ids });
  assert.equal(isReadOnly(editor), true);
  for (const command of [toggleDrumCommand('snare'), backspaceCommand(), setMetadataCommand({ tempoBpm: 100 }),
    importBarCommand({ bar: { notes: [] }, provenance: importedProvenance({ source: 'local_omr' }) })]) {
    assert.equal(execute(editor, command), editor);
  }
  assert.equal(execute(editor, moveCursorCommand(1)).cursor.position, 2);
});
