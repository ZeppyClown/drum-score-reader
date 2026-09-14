// ── Score details: title and tempo ────────────────────────────────────────────
// Both are undoable score edits (setMetadataCommand). Invalid values are refused
// with a message beside the fields and the field shows the score's value again.

import { state } from './state.js';
import { dispatch, onEditorChange } from './editor-store.js';
import { setMetadataCommand } from './commands.js';

export function initDetails() {
  const title = document.getElementById('score-title');
  const tempo = document.getElementById('score-tempo');
  const error = document.getElementById('details-error');

  function show(editor) {
    if (document.activeElement !== title) title.value = editor.meta.title;
    if (document.activeElement !== tempo) tempo.value = editor.meta.tempoBpm;
  }

  function apply(changes, field) {
    try {
      dispatch(setMetadataCommand(changes));
      error.textContent = '';
    } catch (problem) {
      error.textContent = problem.message.replace('tempoBpm', 'Tempo').replace(/^title/, 'Title');
    }
    field.blur();
    show(state.editor);
  }

  title.addEventListener('change', () => apply({ title: title.value }, title));
  tempo.addEventListener('change', () => apply({ tempoBpm: Number(tempo.value) }, tempo));
  for (const field of [title, tempo]) {
    field.addEventListener('keydown', e => {
      if (e.key === 'Escape') field.value = field === title ? state.editor.meta.title : state.editor.meta.tempoBpm;
      if (e.key === 'Enter' || e.key === 'Escape') field.blur();
    });
  }
  onEditorChange(show);
  show(state.editor);
}
