// ── Side panel: Insights tab ──────────────────────────────────────────────────
// Offline cards from insights.js. Each "bars 7–8" button selects exactly those bars
// by id. Cards remember the revision they were built for; after any score change they
// are marked out of date and their buttons stop working until Refresh.

import { state } from './state.js';
import { dispatch, onEditorChange } from './editor-store.js';
import { scoreSnapshot } from './score-snapshot.js';
import { buildInsights, citationTarget } from './insights.js';
import { resolveSelection, rangeLabel, selectBarsCommand } from './selection.js';
import { goToBarCommand } from './commands.js';

let insights = null;

// Shared with agent-ui.js: select and scroll to a cited passage, or explain why not.
export function followCitation(computed, citation, report) {
  const target = citationTarget(state.editor, computed, citation);
  if (!target.ok) { report(target.reason); return false; }
  dispatch(selectBarsCommand(state.bars[target.fromIndex].barId, state.bars[target.toIndex].barId));
  dispatch(goToBarCommand(target.fromIndex));
  document.getElementById('score-cursor')?.scrollIntoView({ block: 'center', inline: 'nearest' });
  return true;
}

// "bars 7–8" button for a citation.
export function citationButton(computed, citation, report) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cite';
  button.textContent = rangeLabel(citation.fromBar, citation.toBar);
  button.addEventListener('click', () => { followCitation(computed, citation, report); button.blur(); });
  return button;
}

function renderCards(container, status) {
  const report = message => { status.textContent = message; };
  container.replaceChildren(...insights.cards.map(card => {
    const section = document.createElement('section');
    section.className = `insight-card insight-${card.kind}`;
    const heading = document.createElement('h3');
    heading.textContent = card.title;
    const list = document.createElement('ul');
    list.append(...card.items.map(item => {
      const li = document.createElement('li');
      if (item.citation) li.append(citationButton(insights, item.citation, report), ' ');
      li.append(item.text);
      return li;
    }));
    section.append(heading, list);
    return section;
  }));
}

export function initInsights() {
  const panel = document.getElementById('side-panel');
  const toggle = document.getElementById('panel-btn');
  const cards = document.getElementById('insights-cards');
  const status = document.getElementById('insights-status');
  const refresh = document.getElementById('insights-refresh');
  const selectionLabel = document.getElementById('selection-label');
  const tabs = [...panel.querySelectorAll('[role="tab"]')];

  function recompute() {
    insights = buildInsights(scoreSnapshot(state.editor));
    renderCards(cards, status);
    status.textContent = '';
    panel.classList.remove('stale');
  }

  function showSelection(editor) {
    const range = resolveSelection(editor);
    selectionLabel.textContent = range
      ? `Selected: ${rangeLabel(range.fromIndex + 1, range.toIndex + 1)}`
      : `No bars selected — questions use bar ${editor.cursor.barIndex + 1}. Click a bar; Shift-click to extend.`;
  }

  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    document.body.classList.toggle('panel-open', !panel.hidden);
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden && (!insights || insights.revision !== state.editor.meta.revision ||
        insights.scoreId !== state.editor.meta.scoreId)) recompute();
    toggle.blur();
  });
  refresh.addEventListener('click', () => { recompute(); refresh.blur(); });
  tabs.forEach(tab => tab.addEventListener('click', () => {
    tabs.forEach(other => {
      other.setAttribute('aria-selected', String(other === tab));
      document.getElementById(other.getAttribute('aria-controls')).hidden = other !== tab;
    });
    tab.blur();
  }));
  onEditorChange(editor => {
    showSelection(editor);
    const stale = insights && (insights.revision !== editor.meta.revision || insights.scoreId !== editor.meta.scoreId);
    panel.classList.toggle('stale', Boolean(stale));
    if (stale) status.textContent = 'The score changed. Press Refresh to update these results.';
  });
  showSelection(state.editor);
}
