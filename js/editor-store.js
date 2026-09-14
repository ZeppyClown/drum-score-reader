// ── Live editor ───────────────────────────────────────────────────────────────
// The only place that replaces state.editor. Every change goes through commit():
// the new editor is stored, the score re-renders, and listeners (details bar,
// file autosave) hear about it. If rendering throws, the previous editor is put
// back so a bad import or edit can never leave a half-drawn score.

import { state } from './state.js';
import { render } from './score.js';
import { execute, undo, redo } from './commands.js';

const listeners = new Set();

export function onEditorChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function commit(next) {
  const previous = state.editor;
  if (next === previous) return false;
  state.editor = next;
  try { render(); }
  catch (error) { state.editor = previous; render(); throw error; }
  listeners.forEach(listener => listener(next, previous));
  return true;
}

export const dispatch = command => commit(execute(state.editor, command));
export const undoEdit = () => commit(undo(state.editor));
export const redoEdit = () => commit(redo(state.editor));
export const replaceEditor = editor => commit(editor);
