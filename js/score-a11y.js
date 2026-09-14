// ── Score for screen readers and keyboard selection ──────────────────────────
// The drawn score is an SVG with no text a screen reader can use, so this keeps a
// visually hidden list of bars in words next to it ("Bar 3, selected: 8 notes —
// kick, snare, closed hi-hat; not checked yet"). Bars can also be selected without
// a mouse: S selects the bar under the cursor, Shift+S extends the selection to it.

import { state } from './state.js';
import { dispatch, onEditorChange } from './editor-store.js';
import { clickBarCommand } from './selection.js';
import { describeScore } from './score-description.js';

export function initScoreA11y() {
  const list = document.getElementById('score-description');
  const update = () => {
    list.replaceChildren(...describeScore(state.editor).map(text => {
      const item = document.createElement('li');
      item.textContent = text;
      return item;
    }));
  };
  onEditorChange(update);
  update();
  document.addEventListener('keydown', event => {
    if (event.code !== 'KeyS' || event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
        document.body.classList.contains('modal-open') ||
        event.target.closest('input, textarea, select, button, [contenteditable="true"]')) return;
    event.preventDefault();
    dispatch(clickBarCommand(state.editor.cursor.barIndex, event.shiftKey));
  });
}
