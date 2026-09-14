// ── Offline answers ───────────────────────────────────────────────────────────
// Answers to the suggested questions built only from local analysis, in the same
// contract as cloud answers (agent-contract.js). This is what students get, and what
// everyone gets without an API key or network (plan §4 D5). Pure.

import { getScoreOverview, inspectBars, findComplexPassages, findPatterns, buildPracticePlan } from './score-analysis.js';
import { finalizeAnswer } from './agent-contract.js';

// scope 'selection': the selected bars (or the cursor bar); 'score': the whole score.
export const SUGGESTED_QUESTIONS = Object.freeze([
  { id: 'explain-bar', text: 'Explain these bars', scope: 'selection' },
  { id: 'count-bar', text: 'How do I count it?', scope: 'selection' },
  { id: 'practice-plan', text: 'How should I practise these bars?', scope: 'selection' },
  { id: 'find-complex', text: 'Find the most complex part', scope: 'score' },
  { id: 'find-repeats', text: 'What repeats?', scope: 'score' },
  { id: 'overview', text: 'Give me an overview', scope: 'score' },
]);

const label = (from, to) => (from === to ? `bar ${from}` : `bars ${from}–${to}`);
const name = drum => drum.replaceAll('_', ' ');
const list = items => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const ref = (fromBar, toBar = fromBar) => ({ fromBar, toBar, label: label(fromBar, toBar) });
// Consecutive bar numbers as ranges: [1,2,3,4,6] → [1–4, 6].
const refsFor = numbers => [...new Set(numbers)].sort((a, b) => a - b).reduce((ranges, n) => {
  const last = ranges.at(-1);
  if (last && last.toBar === n - 1) return [...ranges.slice(0, -1), { ...last, toBar: n, label: label(last.fromBar, n) }];
  return [...ranges, ref(n)];
}, []);
const reply = (answer, references = [], extra = {}) => ({
  answer, abstained: false, references, suggestedQuestions: [], caveats: [], ...extra,
});

function describeBar(bar) {
  if (bar.hits === 0) return `Bar ${bar.barNumber} is all rests.`;
  const drums = [...new Set(bar.events.flatMap(e => e.drums))].map(name);
  const chords = bar.events.filter(e => e.isChord).length;
  const parts = [`Bar ${bar.barNumber} has ${bar.hits} hit${bar.hits === 1 ? '' : 's'} on ${list(drums)}`];
  if (bar.smallestNote) parts.push(`the shortest note is a ${bar.smallestNote}`);
  if (chords) parts.push(`${chords} ${chords === 1 ? 'time' : 'times'} two or more drums play together`);
  if (bar.rests) parts.push(`${bar.rests} rest${bar.rests === 1 ? '' : 's'}`);
  if (bar.tripletGroups) parts.push(`${bar.tripletGroups} triplet group${bar.tripletGroups === 1 ? '' : 's'}`);
  return `${parts.join(', ')}.`;
}

function changeSentence(bar) {
  const { added, removed } = bar.changesFromPrevious ?? { added: [], removed: [] };
  if (!added.length && !removed.length) return `Bar ${bar.barNumber} is the same as the bar before.`;
  const say = hits => list(hits.map(h => `${name(h.drum)} on ${h.count}`));
  return `Bar ${bar.barNumber} ${[added.length && `adds ${say(added)}`, removed.length && `drops ${say(removed)}`].filter(Boolean).join(' and ')}.`;
}

// Up to four bars from the scope, or null when none of them were shared.
function scopeBars(snap, { fromBar, toBar }) {
  const { bars } = inspectBars(snap, { fromBar, toBar: Math.min(toBar, fromBar + 3) });
  return bars?.length ? bars : null;
}
const notShared = ({ fromBar, toBar }) => reply(`${label(fromBar, toBar)} ${fromBar === toBar ? 'is' : 'are'} not in the part of the score that was shared.`, [], { abstained: true });

const ANSWERS = {
  'explain-bar': (snap, scope) => {
    const bars = scopeBars(snap, scope);
    if (!bars) return notShared(scope);
    return reply(bars.map((b, i) => (i === 0 ? describeBar(b) : changeSentence(b))).join(' '),
      [ref(bars[0].barNumber, bars.at(-1).barNumber)]);
  },
  'count-bar': (snap, scope) => {
    const bars = scopeBars(snap, scope);
    if (!bars) return notShared(scope);
    const lines = bars.map(b => `Bar ${b.barNumber}: ${b.counting.replace(/(\d)(e|&|a|trip|let)(?![a-z])/g, '$1 $2')}`);
    return reply(`Count out loud, one word per note. Numbers in brackets are rests — count them silently. ${lines.join('. ')}.`,
      [ref(bars[0].barNumber, bars.at(-1).barNumber)]);
  },
  'practice-plan': (snap, { fromBar, toBar }) => {
    const plan = buildPracticePlan(snap, { fromBar, toBar });
    if (plan.error) return reply(plan.error, [], { abstained: true });
    const steps = plan.steps.map((s, i) => `${i + 1}. ${s.title}${s.bpm ? ` at ${s.bpm} BPM` : ''}: ${s.instruction} Done when: ${s.successCondition}`);
    return reply(steps.join(' '), [ref(fromBar, toBar)]);
  },
  'find-complex': snap => {
    const result = findComplexPassages(snap);
    const [top] = result.passages;
    const reasons = result.ranked.filter(b => b.barNumber >= top.fromBar && b.barNumber <= top.toBar).flatMap(b => b.reasons).slice(0, 3);
    return reply(`The busiest notation is in ${label(top.fromBar, top.toBar)} (notation score ${top.score} out of 100): ${list(reasons) || 'it has the most notes'}. This is about how busy the notes are, not how hard they will feel for you.`,
      result.passages.map(p => ref(p.fromBar, p.toBar)));
  },
  'find-repeats': snap => {
    const { exactGroups, nearMatches } = findPatterns(snap);
    if (!exactGroups.length && !nearMatches.length) return reply('No bars repeat in this part of the score.');
    const sentences = [
      ...exactGroups.map(g => `Bars ${list(g.barNumbers.map(String))} are exactly the same, so you only need to learn that pattern once.`),
      ...nearMatches.slice(0, 2).map(m => `Bar ${m.bars[1]} is ${Math.round(m.similarity * 100)}% the same as bar ${m.bars[0]}.`),
    ];
    return reply(sentences.join(' '), refsFor([
      ...exactGroups.flatMap(g => g.barNumbers),
      ...nearMatches.slice(0, 2).flatMap(m => m.bars),
    ]).slice(0, 10));
  },
  overview: snap => {
    const o = getScoreOverview(snap);
    const complex = findComplexPassages(snap).passages[0];
    const drums = o.drumsUsed.slice(0, 4).map(d => name(d.drum));
    return reply(`This score has ${o.totalBars} bars of ${o.meter} at ${o.tempoBpm} BPM, about ${Math.round(o.durationSeconds)} seconds long. It mostly uses ${list(drums)}${o.smallestNote ? `, and the shortest note is a ${o.smallestNote.label}` : ''}. The busiest notation is in ${label(complex.fromBar, complex.toBar)}.`,
      [ref(complex.fromBar, complex.toBar)]);
  },
};

// questionId from SUGGESTED_QUESTIONS; scope { fromBar, toBar } for selection questions.
export function offlineAnswer(snapshot, { questionId, scope }) {
  const question = SUGGESTED_QUESTIONS.find(q => q.id === questionId);
  const range = question?.scope === 'selection' ? scope : { fromBar: snapshot.range.fromBar, toBar: snapshot.range.toBar };
  const unsupported = snapshot.meter.beats !== 4 || snapshot.meter.beatUnit !== 4;
  let checked;
  if (!question) {
    checked = reply('Typing your own question needs cloud help, which only an adult can turn on. Try one of the suggested questions — they work offline.', [], { abstained: true });
  } else if (unsupported) {
    checked = reply(`Offline answers only work for 4/4 scores for now; this one is in ${snapshot.meter.beats}/${snapshot.meter.beatUnit}.`, [], { abstained: true });
  } else {
    checked = ANSWERS[questionId](snapshot, range);
  }
  const follow = SUGGESTED_QUESTIONS.filter(q => q.id !== questionId).slice(0, 3).map(q => q.text);
  return finalizeAnswer({ ...checked, suggestedQuestions: follow }, snapshot, { mode: 'offline', scope: range });
}
