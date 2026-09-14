// ── Side panel: Ask DrumHub tab ───────────────────────────────────────────────
// Suggested questions always work (offline answers). Typed questions need cloud help,
// which only an adult can turn on (desktop/agent-ipc.cjs asks for confirmation). Answers
// show clickable bar references; after the score changes, an answer is labelled as
// being about an earlier version and its references stop working.

import { state } from './state.js';
import { onEditorChange } from './editor-store.js';
import { buildAskRequest } from './ask-request.js';
import { SUGGESTED_QUESTIONS } from './offline-answers.js';
import { citationButton } from './insights-ui.js';

const $ = id => document.getElementById(id);
let status = { cloudEnabled: false, cloudConfigured: false, model: null };
let current = null;  // the answer on screen
let busy = false;

function item(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function showMode() {
  $('ask-mode-text').textContent = status.cloudEnabled
    ? `Cloud help is on (adult mode): typed questions go to OpenAI ${status.model ?? ''}.`
    : 'Offline answers: worked out on this computer. Nothing is sent anywhere.';
  $('ask-cloud-toggle').textContent = status.cloudEnabled ? 'Turn off cloud help' : 'Turn on cloud help…';
  $('ask-input').disabled = !status.cloudEnabled || busy;
  $('ask-input').placeholder = status.cloudEnabled
    ? 'Ask about this score, e.g. "What changes in bar 5?"'
    : 'Typing your own question needs cloud help, which an adult can turn on.';
  $('ask-submit').disabled = !status.cloudEnabled || busy;
  document.querySelectorAll('#ask-suggestions button').forEach(b => { b.disabled = busy; });
}

function isStale(answer) {
  return answer.scoreId !== state.editor.meta.scoreId || answer.revision !== state.editor.meta.revision;
}

function showAnswer(question, answer) {
  current = answer;
  const report = message => { $('ask-status').textContent = message; };
  $('ask-answer').hidden = false;
  $('ask-question').textContent = question;
  $('ask-text').textContent = answer.answer;
  $('ask-references').replaceChildren(...answer.references.map(ref => citationButton(answer, ref, report)));
  $('ask-caveats').replaceChildren(...answer.caveats.map(c => item('li', c)));
  $('ask-followups').replaceChildren(...answer.suggestedQuestions.map(text => {
    const suggested = SUGGESTED_QUESTIONS.find(q => q.text === text);
    if (!suggested && !status.cloudEnabled) return item('span', '');
    const button = item('button', text, 'followup');
    button.type = 'button';
    button.addEventListener('click', () => ask(suggested ? { questionId: suggested.id } : { question: text, kind: $('ask-scope').value }));
    return button;
  }));
  $('ask-meta').textContent = answer.mode === 'cloud'
    ? `Answered by ${answer.model} using DrumHub's own score facts.`
    : 'Offline answer, worked out on this computer.';
  $('ask-stale').hidden = !isStale(answer);
  $('ask-answer').classList.toggle('stale', isStale(answer));
}

async function ask(spec) {
  if (busy) return;
  const request = buildAskRequest(state.editor, spec);
  busy = true;
  $('ask-busy').hidden = false;
  $('ask-status').textContent = '';
  showMode();
  try {
    const { label, ...payload } = request;
    const answer = await window.agent.ask(payload);
    if (answer.canceled) { $('ask-status').textContent = 'Stopped.'; return; }
    if (answer.error) { $('ask-status').textContent = answer.error; return; }
    showAnswer(label, answer);
  } catch (error) {
    $('ask-status').textContent = `Ask DrumHub failed: ${error.message}`;
  } finally {
    busy = false;
    $('ask-busy').hidden = true;
    showMode();
  }
}

// Grow the question box with its text instead of scrolling inside it.
function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

export async function initAgentPanel() {
  if (!window.agent) { $('tab-ask').hidden = true; return; }
  $('ask-suggestions').replaceChildren(...SUGGESTED_QUESTIONS.map(q => {
    const button = item('button', q.text);
    button.type = 'button';
    button.addEventListener('click', () => { ask({ questionId: q.id }); button.blur(); });
    return button;
  }));
  $('ask-form').addEventListener('submit', event => {
    event.preventDefault();
    const question = $('ask-input').value.trim();
    if (question) ask({ question, kind: $('ask-scope').value });
  });
  $('ask-input').addEventListener('input', event => autoGrow(event.target));
  $('ask-input').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('ask-form').requestSubmit(); }
  });
  $('ask-cancel').addEventListener('click', () => window.agent.cancel());
  $('ask-cloud-toggle').addEventListener('click', async () => {
    const next = await window.agent.setCloud(!status.cloudEnabled);
    if (next.error) $('ask-status').textContent = next.error;
    status = { ...status, ...next };
    showMode();
  });
  onEditorChange(() => {
    if (!current) return;
    $('ask-stale').hidden = !isStale(current);
    $('ask-answer').classList.toggle('stale', isStale(current));
  });
  const loaded = await window.agent.status();
  if (!loaded.error) status = loaded;
  showMode();
}
