// ── Score details: title and tempo ────────────────────────────────────────────
// Both are undoable score edits (setMetadataCommand). Invalid values are refused
// with a message beside the fields and the field shows the score's value again.

import { state } from './state.js';
import { dispatch, onEditorChange } from './editor-store.js';
import { setMetadataCommand, isReadOnly } from './commands.js';

export function initDetails() {
  const title = document.getElementById('score-title');
  const tempo = document.getElementById('score-tempo');
  const error = document.getElementById('details-error');
  const meter = document.getElementById('score-meter');

  function show(editor) {
    if (document.activeElement !== title) title.value = editor.meta.title;
    if (document.activeElement !== tempo) tempo.value = editor.meta.tempoBpm;
    const { beats, beatUnit } = editor.meta.meter;
    const readOnly = isReadOnly(editor);
    meter.textContent = readOnly ? `${beats}/${beatUnit} · view only` : `${beats}/${beatUnit}`;
    meter.title = readOnly ? 'Only 4/4 scores can be edited for now. You can view and save this score.' : 'Only 4/4 is supported for now';
    title.disabled = tempo.disabled = readOnly;
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
