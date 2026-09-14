// ── Review panel ──────────────────────────────────────────────────────────────
// Shows how many imported bars still need checking, jumps to the next one, and marks
// the cursor's bar reviewed. The warnings list shows the cursor bar's import notes.

import { state } from './state.js';
import { dispatch, onEditorChange } from './editor-store.js';
import { goToBarCommand, markReviewedCommand } from './commands.js';
import { needsReview, reviewSummary, nextUnreviewed } from './review.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function initReview() {
  const count = document.getElementById('review-count');
  const next = document.getElementById('review-next');
  const mark = document.getElementById('review-mark');
  const warnings = document.getElementById('import-warnings');

  function show(editor, previous) {
    const summary = reviewSummary(editor.bars);
    count.textContent = summary.count
      ? `${plural(summary.count, 'imported bar')} to check`
      : 'All bars checked';
    count.classList.toggle('needs-review', summary.count > 0);
    next.disabled = summary.count === 0;
    const i = editor.cursor.barIndex;
    const bar = editor.bars[i];
    mark.disabled = !needsReview(bar);
    mark.textContent = needsReview(bar) ? `Mark bar ${i + 1} checked` : `Bar ${i + 1} is checked`;
    const movedBar = !previous || previous.cursor.barIndex !== i || previous.bars[i] !== bar;
    if (movedBar) {
      warnings.replaceChildren(...(needsReview(bar) ? bar.provenance.warnings : []).map(message => {
        const item = document.createElement('li'); item.textContent = message; return item;
      }));
    }
  }

  next.addEventListener('click', () => {
    const index = nextUnreviewed(state.bars, state.cursor.barIndex);
    if (index >= 0) dispatch(goToBarCommand(index));
    next.blur();
  });
  mark.addEventListener('click', () => {
    dispatch(markReviewedCommand(state.cursor.barIndex));
    mark.blur();
  });
  onEditorChange(show);
  show(state.editor);
}
