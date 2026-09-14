// ── Editor commands, revisions, and undo/redo ─────────────────────────────────
// Every change to the score goes through execute(editor, command), so ids,
// revision, history, and "unsaved changes" stay consistent no matter whether the
// change came from a key, the keypad, an import, or (later) an agent action.
// Pure: no state, DOM, or render(), so it is tested in Node. editor-store.js
// holds the live editor and re-renders.
//
// editor = {
//   meta:    document metadata (see score-document.js), including `revision`
//   bars:    the editor's bars, every bar and note carrying its id
//   cursor:  { barIndex, noteIndex, position }
//   history: { past: [entry], future: [entry] }, entry = { label, meta, bars, cursor }
//   saved:   { meta, bars } as last saved or opened, for isDirty()
//   idFactory
// }
//
// A command is { label, run(editor) } where run returns the changed parts
// ({ bars?, meta?, cursor? }) or null when the edit is refused. A command that only
// moves the cursor changes neither revision nor history.
//
// Revisions only move forward: undo and redo restore the exact earlier score but
// count as new revisions, so an answer computed for revision 7 can never be
// silently attached to different content that happens to reach revision 7 again.

import { DRUMS, POSITIONS } from './constants.js';
import {
  toggleDrum, toggleDot, changeDuration, toggleTriplet, tripletGroupStart,
  backspaceAt, moveRight, moveLeft,
} from './bar.js';
import {
  newId, withIds, toDocument, validateDocument, DocumentError, isEditableMeter,
} from './score-document.js';

export const HISTORY_LIMIT = 200;

// Scores in the editor are frozen, so an accidental in-place edit throws instead of
// silently changing the saved snapshot too (isDirty compares by identity). Already
// frozen parts are skipped, so each edit only freezes the objects it created.
function freeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}
const EDITABLE_META = ['title', 'tempoBpm'];

export function createEditor({ meta, bars, cursor = { barIndex: 0, noteIndex: 0, position: 1 }, idFactory = newId }) {
  const identified = freeze(withIds(bars, idFactory));
  freeze(meta);
  return {
    meta, bars: identified, cursor: freeze(cursor), idFactory,
    history: { past: [], future: [] },
    saved: { meta, bars: identified },
  };
}

export const documentOf = editor => toDocument(editor.meta, editor.bars);
// Scores in a meter other than 4/4 open view-only: the cursor moves, nothing changes.
export const isReadOnly = editor => !isEditableMeter(editor.meta.meter);
export const canUndo = editor => editor.history.past.length > 0;
export const canRedo = editor => editor.history.future.length > 0;

const sameMeta = (a, b) =>
  a.scoreId === b.scoreId && a.title === b.title && a.tempoBpm === b.tempoBpm &&
  a.meter.beats === b.meter.beats && a.meter.beatUnit === b.meter.beatUnit;

// Unsaved changes = the score differs from what was last saved. Bars are compared by
// reference: undo restores the very same objects, and edits always create new ones.
export function isDirty(editor) {
  return editor.bars !== editor.saved.bars || !sameMeta(editor.meta, editor.saved.meta);
}

export function markSaved(editor) {
  return { ...editor, saved: { meta: editor.meta, bars: editor.bars } };
}

const snapshot = (editor, label) => ({ label, meta: editor.meta, bars: editor.bars, cursor: editor.cursor });

export function execute(editor, command) {
  const result = command.run(editor);
  if (!result) return editor;
  const bars = result.bars ?? editor.bars;
  const meta = result.meta ?? editor.meta;
  const cursor = freeze(result.cursor ?? editor.cursor);
  if (bars === editor.bars && meta === editor.meta) {
    return cursor === editor.cursor ? editor : { ...editor, cursor };
  }
  if (isReadOnly(editor)) return editor;
  return {
    ...editor,
    meta: freeze({ ...meta, revision: editor.meta.revision + 1 }),
    bars: freeze(withIds(bars, editor.idFactory)),
    cursor,
    history: {
      past: [...editor.history.past, snapshot(editor, command.label)].slice(-HISTORY_LIMIT),
      future: [],
    },
  };
}

// Move one entry from `from` to `to`, restoring its score and cursor.
function travel(editor, from, to) {
  const stack = editor.history[from];
  if (!stack.length || isReadOnly(editor)) return editor;
  const entry = stack.at(-1);
  return {
    ...editor,
    meta: freeze({ ...entry.meta, revision: editor.meta.revision + 1 }),
    bars: entry.bars,
    cursor: entry.cursor,
    history: {
      [from]: stack.slice(0, -1),
      [to]: [...editor.history[to], snapshot(editor, entry.label)],
    },
  };
}

export const undo = editor => travel(editor, 'past', 'future');
export const redo = editor => travel(editor, 'future', 'past');

// ── Bar edits at the cursor ───────────────────────────────────────────────────

// Run a bar.js rule on the cursor's bar; null when the rule refused (same bar back).
function editCursorBar(editor, rule, cursor = editor.cursor) {
  const i = editor.cursor.barIndex;
  const bar = editor.bars[i];
  const next = rule(bar, editor.cursor.noteIndex);
  if (next === bar) return null;
  return { bars: editor.bars.map((b, j) => (j === i ? next : b)), cursor };
}

const drumLabel = drumId => drumId.replaceAll('_', ' ');

export function toggleDrumCommand(drumId) {
  if (!Object.hasOwn(DRUMS, drumId)) throw new Error(`Unknown drum: ${drumId}`);
  return {
    label: `Add ${drumLabel(drumId)}`,
    run: editor => editCursorBar(editor, (bar, index) => toggleDrum(bar, index, drumId),
      { ...editor.cursor, position: DRUMS[drumId].cursorPos }),
  };
}

export const toggleDotCommand = () => ({ label: 'Toggle dot', run: editor => editCursorBar(editor, toggleDot) });

export const changeDurationCommand = delta => ({
  label: delta < 0 ? 'Shorten note' : 'Lengthen note',
  run: editor => editCursorBar(editor, (bar, index) => changeDuration(bar, index, delta)),
});

// Splitting a triplet turns three notes into two, so keep the cursor inside the new pair.
export const toggleTripletCommand = () => ({
  label: 'Toggle triplet',
  run: editor => {
    const { barIndex, noteIndex } = editor.cursor;
    const start = tripletGroupStart(editor.bars[barIndex], noteIndex);
    const cursor = start >= 0 ? { ...editor.cursor, noteIndex: Math.min(noteIndex, start + 1) } : editor.cursor;
    return editCursorBar(editor, toggleTriplet, cursor);
  },
});

export const backspaceCommand = () => ({
  label: 'Delete',
  run: editor => {
    const { barIndex, noteIndex } = editor.cursor;
    const { bar, removedRest } = backspaceAt(editor.bars[barIndex], noteIndex);
    if (bar === editor.bars[barIndex]) return null;
    return {
      bars: editor.bars.map((b, i) => (i === barIndex ? bar : b)),
      cursor: removedRest && noteIndex > 0 ? { ...editor.cursor, noteIndex: noteIndex - 1 } : editor.cursor,
    };
  },
});

// ── Cursor ────────────────────────────────────────────────────────────────────

// Moving right can append a rest or an empty bar; that part is an undoable edit.
export const moveRightCommand = () => ({ label: 'Add rest', run: editor => moveRight(editor.bars, editor.cursor) });

export const moveLeftCommand = () => ({
  label: 'Move left',
  run: editor => {
    const cursor = moveLeft(editor.bars, editor.cursor);
    return cursor === editor.cursor ? null : { cursor };
  },
});

export const moveCursorCommand = delta => ({
  label: 'Move cursor',
  run: editor => {
    const position = editor.cursor.position + delta;
    if (position < 1 || position > POSITIONS) return null;
    return { cursor: { ...editor.cursor, position } };
  },
});

// ── Imports, review, metadata ─────────────────────────────────────────────────

// Adds an imported bar (a fresh bar id, the import's provenance). An untouched empty
// score is replaced rather than left with a blank first bar.
export const importBarCommand = ({ bar, provenance }) => ({
  label: 'Import bar',
  run: editor => {
    const imported = { provenance, notes: bar.notes };
    const empty = editor.bars.length === 1 && editor.bars[0].notes.length === 0;
    const bars = empty ? [imported] : [...editor.bars, imported];
    return { bars, cursor: { barIndex: bars.length - 1, noteIndex: 0, position: 1 } };
  },
});

export const markReviewedCommand = barIndex => ({
  label: 'Mark bar reviewed',
  run: editor => {
    const bar = editor.bars[barIndex];
    if (!bar || bar.provenance.reviewed) return null;
    const reviewed = { ...bar, provenance: { ...bar.provenance, reviewed: true } };
    return { bars: editor.bars.map((b, i) => (i === barIndex ? reviewed : b)) };
  },
});

// changes: { title?, tempoBpm? }. Throws DocumentError with a readable message for
// invalid values, so the caller can show it next to the field.
export function setMetadataCommand(changes) {
  const unknown = Object.keys(changes).find(key => !EDITABLE_META.includes(key));
  if (unknown) throw new DocumentError(`Cannot change ${unknown}`);
  return {
    label: 'Edit score details',
    run: editor => {
      const next = { ...editor.meta, ...changes };
      if (typeof next.title === 'string') next.title = next.title.trim();
      if (next.title === editor.meta.title && next.tempoBpm === editor.meta.tempoBpm) return null;
      const problem = validateDocument(toDocument(next, editor.bars))
        .find(error => /^(title|tempoBpm)/.test(error));
      if (problem) throw new DocumentError(problem);
      return { meta: next };
    },
  };
}
