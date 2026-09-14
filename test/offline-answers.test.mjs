import test from 'node:test';
import assert from 'node:assert/strict';

import { offlineAnswer, SUGGESTED_QUESTIONS } from '../js/offline-answers.js';
import { checkAnswer, unsupportedClaims, requiredCaveats, barMentions } from '../js/agent-contract.js';
import { runTool, toolOutput, TOOL_DEFINITIONS, TOOL_NAMES, MAX_INSPECT_BARS } from '../js/agent-tools.js';
import { scoreSnapshot } from '../js/score-snapshot.js';
import { songEditor } from './fixture-scores.mjs';

const snap = () => scoreSnapshot(songEditor());
const bars = (fromBar, toBar = fromBar) => ({ fromBar, toBar });

test('every suggested question has an offline answer that passes the answer checks', () => {
  for (const q of SUGGESTED_QUESTIONS) {
    const answer = offlineAnswer(snap(), { questionId: q.id, scope: bars(7, 8) });
    assert.equal(answer.mode, 'offline', q.id);
    const { problems } = checkAnswer(answer, snap());
    assert.deepEqual(problems, [], `${q.id}: ${answer.answer}`);
    assert.ok(answer.references.every(r => r.fromBarId && r.toBarId), q.id);
    assert.equal(answer.revision, snap().revision);
  }
});

test('offline answers state calculated facts', () => {
  const s = snap();
  assert.match(offlineAnswer(s, { questionId: 'count-bar', scope: bars(10) }).answer, /Bar 10: 1 trip let \(2\) 3 4 &/);
  assert.match(offlineAnswer(s, { questionId: 'find-complex', scope: null }).answer, /bars 7–8 \(notation score 50 out of 100\)/);
  const repeats = offlineAnswer(s, { questionId: 'find-repeats', scope: null });
  assert.match(repeats.answer, /Bars 1, 2, 3, 4 and 6 are exactly the same/);
  assert.deepEqual(repeats.references.map(r => [r.fromBar, r.toBar]), [[1, 6], [9, 9]]);
  assert.match(offlineAnswer(s, { questionId: 'explain-bar', scope: bars(4, 5) }).answer, /Bar 5 adds kick on 3&/);
  assert.match(offlineAnswer(s, { questionId: 'practice-plan', scope: bars(7, 8) }).answer, /Slow at 60 BPM/);
  assert.match(offlineAnswer(s, { questionId: 'overview', scope: null }).answer, /10 bars of 4\/4 at 100 BPM/);
});

test('offline answers always disclose unchecked imported bars in scope', () => {
  const answer = offlineAnswer(snap(), { questionId: 'explain-bar', scope: bars(10) });
  assert.ok(answer.caveats.some(c => /Bar 10 was imported and not checked yet/.test(c)));
  const clean = offlineAnswer(snap(), { questionId: 'explain-bar', scope: bars(1) });
  assert.equal(clean.caveats.some(c => /imported/.test(c)), false);
});

test('free-text questions offline explain that cloud help is needed; missing bars abstain', () => {
  const answer = offlineAnswer(snap(), { questionId: null, scope: bars(1) });
  assert.equal(answer.abstained, true);
  assert.match(answer.answer, /needs cloud help, which only an adult can turn on/);
  const part = scoreSnapshot(songEditor(), { fromBar: 1, toBar: 3 });
  assert.equal(offlineAnswer(part, { questionId: 'explain-bar', scope: bars(9) }).abstained, true);
});

test('unsupported claims are caught unless the sentence says the fact is not available', () => {
  assert.deepEqual(unsupportedClaims('Play it with your right hand. Keep it steady.'), ['Play it with your right hand.']);
  assert.deepEqual(unsupportedClaims('Accent the snare on 2.'), ['Accent the snare on 2.']);
  assert.deepEqual(unsupportedClaims('The score does not show sticking or accents.'), []);
  assert.deepEqual(unsupportedClaims('Try RLRL on the toms.'), ['Try RLRL on the toms.']);
  assert.deepEqual(unsupportedClaims('Bar 5 adds a kick on 3&.'), []);
  assert.deepEqual(unsupportedClaims("Don't forget to use your right hand in bar 7."), ["Don't forget to use your right hand in bar 7."]);
  assert.deepEqual(unsupportedClaims("No, accent the snare."), ['No, accent the snare.']);
  assert.deepEqual(unsupportedClaims("The notation doesn't include dynamics."), []);
});

test('barMentions finds single bars, lists, ranges and bare ranges but not tempos or counts', () => {
  assert.deepEqual(barMentions('Bars 1, 2, 3, 4 and 6 repeat.'), [1, 2, 3, 4, 6]);
  assert.deepEqual(barMentions('See bar 5 and bars 7–8.'), [5, 7, 8]);
  assert.deepEqual(barMentions('The busiest part is 7-9.'), [7, 8, 9]);
  assert.deepEqual(barMentions('Practise at 60–80 BPM for 3-4 minutes, beat 2 and 4.'), []);
});

test('checkAnswer rejects references outside the shared bars and bar numbers without references', () => {
  const part = scoreSnapshot(songEditor(), { fromBar: 6, toBar: 8 });
  const base = { answer: 'Bar 7 is busy.', abstained: false, references: [{ fromBar: 7, toBar: 7, label: 'bar 7' }], suggestedQuestions: [], caveats: [] };
  assert.deepEqual(checkAnswer(base, part).problems, []);
  assert.match(checkAnswer({ ...base, references: [{ fromBar: 2, toBar: 2, label: 'bar 2' }] }, part).problems.join(), /only bars 6–8 exist/);
  assert.match(checkAnswer({ ...base, references: [{ fromBar: 8, toBar: 7, label: 'x' }] }, part).problems.join(), /not a bar range/);
  assert.match(checkAnswer({ ...base, references: [] }, part).problems.join(), /mentions bar 7, so add it to "references"/);
  assert.match(checkAnswer({ ...base, answer: 'The busiest part is 7–8.', references: [{ fromBar: 7, toBar: 7, label: 'bar 7' }] }, part).problems.join(), /mentions bar 8/);
  assert.deepEqual(checkAnswer({ ...base, answer: 'Play it at 60–80 BPM, 3–4 times.', references: [] }, part).problems, []);
  assert.match(checkAnswer({ ...base, answer: '' }, part).problems.join(), /non-empty/);
  assert.match(checkAnswer('nope', part).problems.join(), /JSON answer object/);
  const trimmed = checkAnswer({ ...base, suggestedQuestions: ['a', 'b', 'c', 'd'], caveats: ['x'.repeat(301)] }, part).answer;
  assert.equal(trimmed.suggestedQuestions.length, 3);
  assert.deepEqual(trimmed.caveats, []);
});

test('required caveats cover truncated snapshots', () => {
  const tight = scoreSnapshot(songEditor(), { maxBars: 5 });
  assert.deepEqual(requiredCaveats(tight, [], null), ['Only bars 1–5 of 10 were looked at.']);
});

test('tools: strict definitions, local results, and errors instead of crashes', () => {
  assert.deepEqual(TOOL_NAMES, ['get_score_overview', 'inspect_bars', 'find_complex_passages', 'find_patterns',
    'compare_passages', 'find_fill_candidates', 'build_practice_plan']);
  for (const def of TOOL_DEFINITIONS) {
    assert.equal(def.strict, true);
    assert.equal(def.parameters.additionalProperties, false);
    assert.deepEqual(def.parameters.required, Object.keys(def.parameters.properties));
  }
  const s = snap();
  assert.equal(runTool('get_score_overview', '{}', s).totalBars, 10);
  assert.equal(runTool('inspect_bars', '{"fromBar":1,"toBar":20}', s).bars.length, MAX_INSPECT_BARS);
  assert.match(runTool('inspect_bars', '{"fromBar":1,"toBar":20}', s).note, /first 8 bars/);
  assert.match(runTool('inspect_bars', '{"fromBar":40,"toBar":41}', s).error, /Bars 1–10 are available/);
  assert.match(runTool('inspect_bars', '{"fromBar":"one"}', s).error, /whole bar numbers/);
  assert.match(runTool('compare_passages', '{"barA":5,"barB":99}', s).error, /Bar 99/);
  assert.equal(runTool('find_patterns', '{"threshold":null}', s).threshold, 0.75);
  assert.equal(runTool('find_complex_passages', '{"top":null}', s).passages.length, 2);
  assert.match(runTool('delete_score', '{}', s).error, /Unknown tool/);
  assert.match(runTool('inspect_bars', '{nope', s).error, /not valid JSON/);
  const inspected = toolOutput(runTool('inspect_bars', '{"fromBar":1,"toBar":2}', s));
  assert.equal(inspected.includes(s.bars[0].barId) || /barId|eventId/.test(inspected), false, 'ids never reach the model');
  assert.match(toolOutput({ big: 'x'.repeat(30000) }), /too large/);
});
