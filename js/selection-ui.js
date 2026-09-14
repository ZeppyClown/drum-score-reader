// ── Selecting bars on the score ───────────────────────────────────────────────
// Click a bar to select it (and move the cursor there); Shift-click to extend.

import { dispatch } from './editor-store.js';
import { barAt } from './score.js';
import { clickBarCommand } from './selection.js';

export function initSelection() {
  document.getElementById('score').addEventListener('click', event => {
    const svg = event.currentTarget.querySelector('svg');
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    const index = barAt(event.clientX - box.left, event.clientY - box.top);
    if (index >= 0) dispatch(clickBarCommand(index, event.shiftKey));
  });
}
