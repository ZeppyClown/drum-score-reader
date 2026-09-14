// ── Ask DrumHub answer contract ───────────────────────────────────────────────
// The strict JSON an answer must have, the local checks every answer passes before it
// is shown, and the caveats that code (not the model) always adds. Pure; shared by
// Electron main, the offline answers, and the evaluation harness.
//
// answer = {
//   answer: string, abstained: boolean,
//   references: [{ fromBar, toBar, label }], suggestedQuestions: [string], caveats: [string]
// }
// A final answer also carries mode, scoreId, revision, snapshotHash, and each
// reference gains fromBarId/toBarId so a click selects exactly those bars.

export const LIMITS = Object.freeze({ answer: 2000, references: 10, label: 60, suggestions: 3, suggestion: 120, caveats: 5, caveat: 300 });

export const ANSWER_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['answer', 'abstained', 'references', 'suggestedQuestions', 'caveats'],
  properties: {
    answer: { type: 'string', description: 'The reply, in short plain sentences for a young drummer.' },
    abstained: { type: 'boolean', description: 'true when the score or tools do not contain what was asked.' },
    references: {
      type: 'array', description: 'Every bar range a score-specific sentence relies on.',
      items: {
        type: 'object', additionalProperties: false, required: ['fromBar', 'toBar', 'label'],
        properties: {
          fromBar: { type: 'integer' }, toBar: { type: 'integer' },
          label: { type: 'string', description: 'Short link text, e.g. "bars 7–8".' },
        },
      },
    },
    suggestedQuestions: { type: 'array', items: { type: 'string' }, description: 'Up to 3 short follow-up questions.' },
    caveats: { type: 'array', items: { type: 'string' }, description: 'Limits of this answer, if any.' },
  },
};

// Facts the score model does not encode yet (plan §5). A sentence mentioning one is an
// unsupported claim unless the same sentence says it is not available.
const UNSUPPORTED = /\b(accent(?:s|ed)?|sticking|dynamics?|crescendo|decrescendo|diminuendo|forte|fortissimo|pianissimo|mezzo|ghost notes?|flams?|drags?|rolls?|tied|ties|repeat signs?|first ending|second ending|coda|left hand|right hand|left foot|right foot|leading hand|let (?:it|them) ring|choke|muffle|mute|rimshot|swing feel|[RL]{4,})\b/i;
// Only a sentence that says the notation does not show/record the fact is allowed —
// "Don't forget to use your right hand" is still a claim.
const UNAVAILABLE = /\b(?:does not|doesn['’]t|do not|don['’]t|is not|isn['’]t|are not|aren['’]t|not|never|can['’]t|cannot)\s+(?:\w+\s+)?(?:show|shown|record|recorded|include|included|mark|marked|written|write|say|tell|contain|have)\b|\bno (?:information|marking|markings)\b/i;

export function unsupportedClaims(text) {
  return String(text).split(/(?<=[.!?])\s+/).filter(sentence => UNSUPPORTED.test(sentence) && !UNAVAILABLE.test(sentence));
}

// Every bar number a sentence refers to: "bar 5", "bars 7–8", "bars 1, 2, 3 and 6", and a
// bare range like "7–8" (unless it is a tempo, percentage, count or time).
export function barMentions(text) {
  const numbers = new Set();
  const expand = (from, to) => { for (let n = Math.min(from, to); n <= Math.max(from, to) && n - from < 2000; n++) numbers.add(n); };
  const source = String(text);
  for (const m of source.matchAll(/\bbars?\s+(\d+(?:\s*(?:,|and|&|–|-|to|or)\s*\d+)*)/gi)) {
    const parts = m[1].split(/\s*(,|and|&|or)\s*/i).filter(p => /\d/.test(p));
    for (const part of parts) {
      const range = part.match(/(\d+)\s*(?:–|-|to)\s*(\d+)/i);
      if (range) expand(Number(range[1]), Number(range[2])); else numbers.add(Number(part));
    }
  }
  for (const m of source.matchAll(/(?<![\w.])(\d+)\s*[–-]\s*(\d+)(?!\s*(?:bpm|%|percent|times|seconds|s\b|minutes|out of|beats))(?!\w|\.\d)/gi)) {
    expand(Number(m[1]), Number(m[2]));
  }
  return [...numbers].sort((a, b) => a - b);
}

const isText = (v, max) => typeof v === 'string' && v.length <= max;
const barLabel = (from, to) => (from === to ? `bar ${from}` : `bars ${from}–${to}`);

// Structural and grounding checks. Returns { answer, problems }: problems are phrased as
// instructions so they can be sent back to the model for one repair attempt.
export function checkAnswer(raw, snapshot) {
  const problems = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { answer: null, problems: ['Reply with the JSON answer object.'] };
  if (!isText(raw.answer, LIMITS.answer) || !raw.answer.trim()) problems.push(`"answer" must be non-empty text of at most ${LIMITS.answer} characters.`);
  if (typeof raw.abstained !== 'boolean') problems.push('"abstained" must be true or false.');
  const refs = Array.isArray(raw.references) ? raw.references : [];
  if (!Array.isArray(raw.references) || refs.length > LIMITS.references) problems.push(`"references" must be a list of at most ${LIMITS.references}.`);
  const { fromBar: first, toBar: last } = snapshot.range;
  const references = [];
  for (const ref of refs.slice(0, LIMITS.references)) {
    const ok = ref && Number.isInteger(ref.fromBar) && Number.isInteger(ref.toBar) &&
      ref.fromBar >= first && ref.toBar <= last && ref.fromBar <= ref.toBar;
    if (!ok) {
      problems.push(`Reference ${JSON.stringify({ fromBar: ref?.fromBar, toBar: ref?.toBar })} is not a bar range you were given; only bars ${first}–${last} exist here. Remove it or use tool results.`);
    } else {
      references.push({ fromBar: ref.fromBar, toBar: ref.toBar, label: isText(ref.label, LIMITS.label) && ref.label.trim() ? ref.label.trim() : barLabel(ref.fromBar, ref.toBar) });
    }
  }
  const suggestions = Array.isArray(raw.suggestedQuestions) ? raw.suggestedQuestions.filter(q => isText(q, LIMITS.suggestion) && q.trim()).slice(0, LIMITS.suggestions) : [];
  const caveats = Array.isArray(raw.caveats) ? raw.caveats.filter(c => isText(c, LIMITS.caveat) && c.trim()).slice(0, LIMITS.caveats) : [];
  if (typeof raw.answer === 'string' && /\btools?\b|\bsnapshot\b|\bjson\b/i.test(raw.answer)) {
    problems.push('Do not mention tools, snapshots or JSON to the reader; say "the score" instead.');
  }
  const claims = unsupportedClaims(typeof raw.answer === 'string' ? raw.answer : '');
  if (claims.length) {
    problems.push(`The score does not record accents, sticking, dynamics, ornaments, ties, repeat signs, how a cymbal should ring, or which hand or foot to use. Remove or rephrase: ${claims.map(c => JSON.stringify(c)).join(' ')}`);
  }
  if (raw.abstained === false && typeof raw.answer === 'string') {
    const uncited = barMentions(raw.answer).filter(n => !references.some(r => n >= r.fromBar && n <= r.toBar));
    if (uncited.length) problems.push(`The answer mentions bar${uncited.length === 1 ? '' : 's'} ${uncited.join(', ')}, so add ${uncited.length === 1 ? 'it' : 'them'} to "references" (only bars ${first}–${last} can be used).`);
  }
  return {
    answer: problems.length ? null : { answer: raw.answer.trim(), abstained: raw.abstained, references, suggestedQuestions: suggestions, caveats },
    problems,
  };
}

// Caveats added by code for every final answer, so disclosure never depends on the model.
// A whole-score question only warns about unchecked bars the answer actually cites; a
// question about chosen bars always warns about unchecked bars among them.
export function requiredCaveats(snapshot, references, scope) {
  const wholeScore = scope && scope.fromBar <= 1 && scope.toBar >= snapshot.totalBars;
  const inScope = n => (scope && !wholeScore && n >= scope.fromBar && n <= scope.toBar) ||
    references.some(r => n >= r.fromBar && n <= r.toBar);
  const unchecked = snapshot.bars.filter(b => !b.reviewed && inScope(b.barNumber)).map(b => b.barNumber);
  const caveats = [];
  if (unchecked.length) {
    caveats.push(`${unchecked.length === 1 ? `Bar ${unchecked[0]} was` : `Bars ${unchecked.join(', ')} were`} imported and not checked yet, so facts that use ${unchecked.length === 1 ? 'that bar' : 'those bars'} might be wrong.`);
  }
  if (snapshot.truncated) {
    caveats.push(`Only bars ${snapshot.range.fromBar}–${snapshot.range.toBar} of ${snapshot.totalBars} were looked at.`);
  }
  return caveats;
}

// Adds ids, required caveats and version details to a checked answer.
export function finalizeAnswer(checked, snapshot, { mode, model = null, scope = null, extraCaveats = [] }) {
  const idOf = n => snapshot.bars.find(b => b.barNumber === n)?.barId ?? null;
  const references = checked.references.map(r => ({ ...r, fromBarId: idOf(r.fromBar), toBarId: idOf(r.toBar) }));
  const required = requiredCaveats(snapshot, references, scope);
  // Drop the model's own versions of warnings that code already gives.
  const modelCaveats = checked.caveats.filter(c => !(required.length && /not (?:been )?checked|imported|only bars|bars \d+.\d+ of|tools? cover/i.test(c)));
  const caveats = [...new Set([...required, ...extraCaveats, ...modelCaveats])].slice(0, LIMITS.caveats);
  return {
    mode, model,
    scoreId: snapshot.scoreId, revision: snapshot.revision, snapshotHash: snapshot.snapshotHash,
    answer: checked.answer, abstained: checked.abstained, references,
    suggestedQuestions: checked.suggestedQuestions, caveats,
  };
}
