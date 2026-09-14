import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getScoreOverview, inspectBars, findPatterns, comparePassages, findFillCandidates,
  findComplexPassages, buildPracticePlan, countLabel, durationLabel, COMPLEXITY_WEIGHTS,
} from '../js/score-analysis.js';
import { scoreSnapshot } from '../js/score-snapshot.js';
import { execute, markReviewedCommand, goToBarCommand } from '../js/commands.js';
import { songEditor } from './fixture-scores.mjs';

// Fixture (test/fixture-scores.mjs), 4/4 at 100 BPM:
// 1–4 groove, 5 groove + extra kick on "3&", 6 groove, 7 busy 16th groove,
// 8 16th tom fill, 9 crash + groove, 10 triplets/rest/dotted quarter (imported, unreviewed)
const snap = () => scoreSnapshot(songEditor());

test('count labels and duration names read the way a drummer counts', () => {
  assert.deepEqual([0, 12, 24, 36, 48, 16, 32, 6, 8].map(countLabel),
    ['1', '1e', '1&', '1a', '2', '1trip', '1let', '1 (32nd)', '1 (triplet 16th)']);
  assert.equal(durationLabel({ writtenDuration: 'q', dotted: true, triplet: false }), 'dotted quarter');
  assert.equal(durationLabel({ writtenDuration: '8', dotted: false, triplet: true }), 'triplet 8th');
});

test('C1 overview matches the hand-counted fixture', () => {
  const overview = getScoreOverview(snap());
  assert.equal(overview.totalBars, 10);
  assert.deepEqual(overview.range, { fromBar: 1, toBar: 10 });
  assert.equal(overview.durationSeconds, 24);  // 10 bars × 4 beats × 0.6 s
  assert.equal(overview.tempoBpm, 100);
  assert.deepEqual(overview.meter, '4/4');
  assert.deepEqual(overview.drumsUsed.slice(0, 3), [
    { drum: 'hi_hat_closed', hits: 71 }, { drum: 'kick', hits: 24 }, { drum: 'snare', hits: 23 },
  ]);
  assert.deepEqual(overview.smallestNote, { label: '16th', bars: [7, 8] });
  assert.equal(overview.restCount, 1);
  assert.equal(overview.tripletGroups, 1);
  assert.equal(overview.chordCount, 37);
  assert.deepEqual(overview.unreviewedBars, [10]);
  assert.deepEqual(overview.emptyBars, []);
  assert.deepEqual(overview.incompleteBars, []);
});

test('C1 overview drops a bar from unreviewed once it is marked reviewed', () => {
  const editor = execute(songEditor(), markReviewedCommand(9));
  assert.deepEqual(getScoreOverview(scoreSnapshot(editor)).unreviewedBars, []);
});

test('C2 inspect gives beat-by-beat facts, counting and changes from the previous bar', () => {
  const { bars, missingBars } = inspectBars(snap(), { fromBar: 4, toBar: 5 });
  assert.deepEqual(missingBars, []);
  const [four, five] = bars;
  assert.equal(four.counting, '1 & 2 & 3 & 4 &');
  assert.deepEqual(four.events[0], {
    eventId: four.events[0].eventId, count: '1', onsetTicks: 0, duration: '8th',
    drums: ['hi_hat_closed', 'kick'], isRest: false, isChord: true,
  });
  assert.equal(four.smallestNote, '8th');
  assert.deepEqual(five.changesFromPrevious, { added: [{ count: '3&', drum: 'kick' }], removed: [] });
  assert.equal(four.reviewed, true);
  const [ten] = inspectBars(snap(), { fromBar: 10, toBar: 10 }).bars;
  assert.equal(ten.counting, '1 trip let (2) 3 4&');
  assert.equal(ten.reviewed, false);
  assert.equal(ten.source, 'local_omr');
  assert.equal(ten.warnings.length, 1);
});

test('C2 inspect reports bars that are not in the snapshot instead of inventing them', () => {
  const part = scoreSnapshot(songEditor(), { fromBar: 1, toBar: 3 });
  const result = inspectBars(part, { fromBar: 2, toBar: 12 });
  assert.deepEqual(result.bars.map(b => b.barNumber), [2, 3]);
  assert.deepEqual(result.missingBars, [4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test('C3 exact repeats have no false negatives; near repeats are thresholded and explained', () => {
  const patterns = findPatterns(snap());
  assert.deepEqual(patterns.exactGroups.map(g => g.barNumbers), [[1, 2, 3, 4, 6]]);
  assert.equal(patterns.threshold, 0.75);
  const near = patterns.nearMatches.find(m => m.bars.includes(5));
  assert.deepEqual(near.bars, [1, 5]);
  assert.equal(near.similarity, 0.92);
  assert.deepEqual(near.added, [{ count: '3&', drum: 'kick' }]);
  assert.equal(patterns.nearMatches.some(m => m.bars.includes(8)), false);
  assert.equal(findPatterns(snap(), { threshold: 0.95 }).nearMatches.length, 0);
});

test('C6 comparisons are symmetric', () => {
  const s = snap();
  const ab = comparePassages(s, 5, 7);
  const ba = comparePassages(s, 7, 5);
  assert.equal(ab.similarity, ba.similarity);
  assert.deepEqual(ab.added, ba.removed);
  assert.deepEqual(ab.removed, ba.added);
  assert.equal(ab.densityDelta, -ba.densityDelta);
  assert.deepEqual(ab.subdivision, { a: '8th', b: '16th', changed: true });
  assert.deepEqual(comparePassages(s, 1, 2).added, []);
  assert.equal(comparePassages(s, 1, 2).similarity, 1);
  assert.match(comparePassages(s, 1, 40).error, /Bar 40 is not/);
});

test('C4 the tom fill is the only fill candidate, worded as a candidate with its reasons', () => {
  const { candidates } = findFillCandidates(snap());
  assert.deepEqual(candidates.map(c => c.barNumber), [8]);
  const [fill] = candidates;
  assert.ok(fill.score >= 0.8, `score ${fill.score}`);
  assert.match(fill.reasons.join(' | '), /toms/);
  assert.match(fill.reasons.join(' | '), /crash on beat 1 of bar 9/);
  assert.match(fill.reasons.join(' | '), /no hi-hat/);
  assert.match(fill.label, /possible fill/i);
});

test('C5 complexity ranks the busy groove, tom fill and triplet bar above the plain grooves', () => {
  const result = findComplexPassages(snap());
  assert.equal(Object.values(COMPLEXITY_WEIGHTS).reduce((a, b) => a + b, 0), 1);
  assert.deepEqual(result.ranked.slice(0, 3).map(b => b.barNumber), [7, 8, 10]);
  const scores = Object.fromEntries(result.ranked.map(b => [b.barNumber, b.score]));
  for (const plain of [1, 2, 3, 4, 6]) assert.ok(scores[plain] < scores[10], `bar ${plain}`);
  assert.equal(scores[1], scores[2]);  // identical bars score identically
  assert.ok(result.ranked.every(b => b.score >= 0 && b.score <= 100));
  const top = result.ranked[0];
  assert.deepEqual(Object.keys(top.signals).sort(), Object.keys(COMPLEXITY_WEIGHTS).sort());
  assert.ok(top.reasons.length >= 2);
  assert.match(result.ranked.find(b => b.barNumber === 10).reasons.join(' | '), /including triplets/);
  assert.equal(JSON.stringify(result).includes('hands'), false);  // no limb claims (plan §5)
  assert.match(result.note, /notation complexity/);
  assert.deepEqual(result.passages[0], { fromBar: 7, toBar: 8, score: scores[7] });
  // ranking is stable: same input, same order
  assert.deepEqual(findComplexPassages(snap()).ranked, result.ranked);
});

test('practice plan: evidence-based steps, BPM kept in bounds, measurable success', () => {
  const plan = buildPracticePlan(snap(), { fromBar: 7, toBar: 8 });
  assert.deepEqual(plan.range, { fromBar: 7, toBar: 8 });
  assert.equal(plan.targetBpm, 100);
  assert.deepEqual(plan.steps.map(s => s.bpm), [null, 60, 80, 80, 100]);
  assert.ok(plan.steps.every(s => typeof s.successCondition === 'string' && s.successCondition.length > 10));
  assert.ok(plan.evidence.length > 0);
  assert.match(plan.steps[0].instruction, /1 e & a/);
  const slow = scoreSnapshot({ ...songEditor(), meta: { ...songEditor().meta, tempoBpm: 50 } });
  assert.ok(buildPracticePlan(slow, { fromBar: 1, toBar: 1 }).steps.every(s => s.bpm === null || s.bpm >= 40));
  assert.match(buildPracticePlan(snap(), { fromBar: 30, toBar: 31 }).error, /not in/);
});

test('analysis refuses meters it cannot count yet instead of guessing', () => {
  const waltz = { ...snap(), meter: { beats: 3, beatUnit: 4 } };
  for (const tool of [getScoreOverview, findPatterns, findFillCandidates, findComplexPassages]) {
    assert.match(tool(waltz).error, /4\/4/);
  }
});

test('selection survives in the snapshot for "this bar" questions', () => {
  const s = scoreSnapshot(execute(songEditor(), goToBarCommand(7)));
  assert.equal(s.selection.barNumber, 8);
  assert.equal(inspectBars(s, { fromBar: s.selection.barNumber, toBar: s.selection.barNumber }).bars[0].barNumber, 8);
});
