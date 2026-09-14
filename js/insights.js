// ── Offline insight cards ─────────────────────────────────────────────────────
// Turns score-analysis.js facts into short cards with clickable bar citations. No
// model involved: every sentence is a template filled with calculated facts. Pure.
//
// insights = { scoreId, revision, snapshotHash, cards: [{ kind, title, items: [{ text, citation? }] }] }
// citation = { fromBar, toBar, fromBarId, toBarId } — ids let a click find the same bars;
// the revision check in citationTarget() refuses clicks after the score has changed.

import {
  getScoreOverview, findComplexPassages, findPatterns, findFillCandidates,
} from './score-analysis.js';

const joinNumbers = numbers => (numbers.length === 1 ? String(numbers[0])
  : `${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`);
const minutes = seconds => (seconds < 60 ? `${Math.round(seconds)} seconds`
  : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`);

function citationFor(snap, fromBar, toBar = fromBar) {
  const idOf = n => snap.bars.find(b => b.barNumber === n)?.barId;
  return { fromBar, toBar, fromBarId: idOf(fromBar), toBarId: idOf(toBar) };
}

function overviewCard(snap) {
  const o = getScoreOverview(snap);
  if (o.error) return { kind: 'overview', title: 'Score', items: [{ text: o.error }] };
  const drums = o.drumsUsed.slice(0, 4).map(d => d.drum.replaceAll('_', ' ')).join(', ');
  return {
    kind: 'overview', title: 'Score',
    items: [
      { text: `${o.totalBars} bars of ${o.meter} at ${o.tempoBpm} BPM — about ${minutes(o.durationSeconds)}.` },
      { text: `Most used: ${drums || 'no drums yet'}.` },
      ...(o.smallestNote ? [{ text: `Shortest note: ${o.smallestNote.label}${o.smallestNote.bars.length > 1 ? ` (in ${o.smallestNote.bars.length} bars)` : ''}.`, citation: citationFor(snap, o.smallestNote.bars[0]) }] : []),
    ],
  };
}

function complexCard(snap) {
  const result = findComplexPassages(snap);
  if (result.error) return { kind: 'complex', title: 'Busiest notation', items: [{ text: result.error }] };
  const reasonsFor = p => result.ranked.filter(b => b.barNumber >= p.fromBar && b.barNumber <= p.toBar)
    .flatMap(b => b.reasons).slice(0, 2).join('; ');
  return {
    kind: 'complex', title: 'Busiest notation',
    items: result.passages.map(p => ({
      text: `notation score ${p.score}/100 — ${reasonsFor(p) || 'steady rhythm'}.`,
      citation: citationFor(snap, p.fromBar, p.toBar),
    })),
  };
}

function repeatsCard(snap) {
  const result = findPatterns(snap);
  if (result.error) return { kind: 'repeats', title: 'Repeats', items: [{ text: result.error }] };
  const items = [
    ...result.exactGroups.map(g => ({
      text: `same pattern in bars ${joinNumbers(g.barNumbers)} — learn it once.`,
      citation: citationFor(snap, g.barNumbers[0]),
    })),
    ...result.nearMatches.slice(0, 3).map(m => ({
      text: `${Math.round(m.similarity * 100)}% the same as bar ${m.bars[0]}.`,
      citation: citationFor(snap, m.bars[1]),
    })),
  ];
  return { kind: 'repeats', title: 'Repeats', items: items.length ? items : [{ text: 'No repeated bars found.' }] };
}

function fillsCard(snap) {
  const result = findFillCandidates(snap);
  if (result.error) return { kind: 'fills', title: 'Possible fills', items: [{ text: result.error }] };
  return {
    kind: 'fills', title: 'Possible fills',
    items: result.candidates.length
      ? result.candidates.slice(0, 3).map(c => ({
        text: `might be a fill — ${c.reasons.slice(0, 2).join('; ')}.`,
        citation: citationFor(snap, c.barNumber),
      }))
      : [{ text: 'No bars stand out as fills.' }],
  };
}

function reviewCard(snap) {
  const unreviewed = snap.bars.filter(b => !b.reviewed);
  return {
    kind: 'review', title: 'Check imported bars',
    items: unreviewed.length
      ? unreviewed.map(b => ({ text: `imported and not checked yet.`, citation: citationFor(snap, b.barNumber) }))
      : [{ text: 'Every imported bar has been checked.' }],
  };
}

export function buildInsights(snap) {
  return {
    scoreId: snap.scoreId, revision: snap.revision, snapshotHash: snap.snapshotHash,
    cards: [overviewCard(snap), complexCard(snap), repeatsCard(snap), fillsCard(snap), reviewCard(snap)],
  };
}

// Where a clicked citation points in the current editor, or why it cannot be followed.
export function citationTarget(editor, computed, citation) {
  if (editor.meta.scoreId !== computed.scoreId) return { ok: false, reason: 'This answer was for a different score.' };
  if (editor.meta.revision !== computed.revision) {
    return { ok: false, reason: 'The score has changed since this was worked out. Refresh to see up-to-date results.' };
  }
  const from = editor.bars.findIndex(b => b.barId === citation.fromBarId);
  const to = editor.bars.findIndex(b => b.barId === citation.toBarId);
  if (from < 0 || to < 0) return { ok: false, reason: 'Those bars are no longer in the score.' };
  return { ok: true, fromIndex: Math.min(from, to), toIndex: Math.max(from, to) };
}
