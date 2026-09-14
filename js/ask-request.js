// ── Building an Ask DrumHub request ───────────────────────────────────────────
// Decides which bars a question is about and which bars the tools may see, then takes
// the snapshot. Pure, tested in Node.
//
// 'selection' questions are about the selected bars (or the cursor's bar); the tools
// also see one bar either side so "what changed?" can be answered. 'score' questions
// share the whole score, capped at MAX_SNAPSHOT_BARS (the answer then says so).

import { scoreSnapshot, MAX_SNAPSHOT_BARS } from './score-snapshot.js';
import { resolveSelection } from './selection.js';
import { SUGGESTED_QUESTIONS } from './offline-answers.js';

export function questionScope(editor, kind) {
  const total = editor.bars.length;
  if (kind === 'score') return { fromBar: 1, toBar: total };
  const range = resolveSelection(editor);
  const fromBar = range ? range.fromIndex + 1 : editor.cursor.barIndex + 1;
  const toBar = range ? range.toIndex + 1 : fromBar;
  return { fromBar, toBar };
}

// { questionId } for a suggested question, or { question, kind } for typed text.
export function buildAskRequest(editor, { questionId = null, question = null, kind = 'selection' }) {
  const suggested = SUGGESTED_QUESTIONS.find(q => q.id === questionId);
  const scopeKind = suggested ? suggested.scope : kind;
  const wanted = questionScope(editor, scopeKind);
  const total = editor.bars.length;
  const snapshot = scopeKind === 'score'
    ? scoreSnapshot(editor, { fromBar: 1, toBar: total })
    : scoreSnapshot(editor, { fromBar: Math.max(1, wanted.fromBar - 1), toBar: Math.min(total, wanted.toBar + 1) });
  const scope = {
    fromBar: Math.max(wanted.fromBar, snapshot.range.fromBar),
    toBar: Math.min(wanted.toBar, snapshot.range.toBar),
  };
  return {
    ...(suggested ? { questionId: suggested.id } : { question }),
    scope, snapshot,
    label: suggested ? suggested.text : question,
  };
}

export { MAX_SNAPSHOT_BARS };
