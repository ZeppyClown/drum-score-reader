// ── Entry point ───────────────────────────────────────────────────────────────
// Loaded as <script type="module"> from index.html.
// Imports the four initialisation functions and runs them in order.

import { render }                   from './js/score.js';
import { initKeyboard, initKeypad } from './js/input.js';
import { initMenu }                 from './js/menu.js';
import { initImport } from './js/import-ui.js';
import { initDetails } from './js/details-ui.js';
import { initFiles } from './js/file-ui.js';
import { initReview } from './js/review-ui.js';
import { initSelection } from './js/selection-ui.js';
import { initScoreA11y } from './js/score-a11y.js';
import { initInsights } from './js/insights-ui.js';
import { initAgentPanel } from './js/agent-ui.js';
import { initPageImport } from './js/page-import-ui.js';
import { mountTransport } from './js/transport-ui.js';
import { mountLibrary } from './js/library-ui.js';
import { mountPractice } from './js/practice-ui.js';
import { dispatch } from './js/editor-store.js';
import { showPlayhead } from './js/score.js';
import { onEditorChange } from './js/editor-store.js';
import { state } from './js/state.js';

// Register keyboard shortcuts and the floating keypad click handlers
initKeyboard();
initKeypad();

// Set up the side-menu (bars-per-line control)
initMenu();
initImport();

initDetails();
initReview();
initSelection();
initScoreA11y();
initInsights();
initAgentPanel();
initPageImport();

// Playback bar: plays the score, loops the selected bars, and highlights the note being played.
const transport = mountTransport(document.getElementById('transport'), {
  getEditor: () => state.editor,
  onChange: onEditorChange,
  onPosition: showPlayhead,
});
// Side panel tabs: exercise library and Fill Lab, practice and teacher view.
const library = mountLibrary(document.getElementById('library-tab'), { getEditor: () => state.editor, dispatch, onChange: onEditorChange });
if (window.practice) {
  mountPractice(document.getElementById('practice-tab'), { getEditor: () => state.editor, getPlaybackTempo: () => null });
} else {
  document.getElementById('tab-practice').hidden = true;
}
// Suggested actions from Ask DrumHub ("Practise at 60 BPM", "Loop bars 7–8", "Open the exercise …").
window.addEventListener('drumhub:effect', event => {
  const effect = event.detail;
  if (effect?.kind === 'playback') transport.applyPlaybackEffect(effect);
  if (effect?.kind === 'exercise' && library.openExercise(effect.exerciseId)) document.getElementById('tab-library').click();
});
// Space starts and stops playback when not typing.
document.addEventListener('keydown', event => {
  if (event.key !== ' ' || event.repeat || document.body.classList.contains('modal-open') ||
      event.target.closest('input, textarea, select, button, [contenteditable="true"]')) return;
  event.preventDefault();
  if (transport.isPlaying) transport.stop(); else transport.play();
});

// Draw the initial empty score, then offer to restore anything unsaved from a crash
render();
initFiles();
