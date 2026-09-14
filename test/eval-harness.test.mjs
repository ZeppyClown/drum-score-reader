import test from 'node:test';
import assert from 'node:assert/strict';

import { gradeAnswer, groundedSentences } from '../eval/score-agent/graders.mjs';
import { runEval, summarize } from '../eval/score-agent/run.mjs';
import { scoreSnapshot } from '../js/score-snapshot.js';
import { songEditor } from './fixture-scores.mjs';

const snap = scoreSnapshot(songEditor());
const ref = (fromBar, toBar = fromBar) => ({ fromBar, toBar, label: 'x', fromBarId: snap.bars[fromBar - 1].barId, toBarId: snap.bars[toBar - 1].barId });
const answer = overrides => ({ answer: 'Bars 7–8 are busy.', abstained: false, references: [ref(7, 8)], caveats: [], ...overrides });

test('graders pass a correct answer and name each failure in a wrong one', () => {
  assert.deepEqual(gradeAnswer(answer(), snap, { mustReference: [[7, 8]], mustMention: ['busy'], abstain: false }).failures, []);
  const wrong = gradeAnswer(answer({
    answer: 'Use your right hand in bar 9. Bar 3 is busy.',
    references: [ref(9), { fromBar: 30, toBar: 30, fromBarId: 'x', toBarId: 'x' }],
  }), snap, { mustReference: [[7, 8]], mustMention: ['sixteenth'], abstain: true, disclosesUnreviewed: true, mustNotReference: [[9, 9]] });
  const { checks } = wrong;
  assert.equal(checks.citationsValid, false);
  assert.equal(checks.requiredReferences, false);
  assert.equal(checks.forbiddenReferences, false);
  assert.equal(checks.facts, false);
  assert.equal(checks.abstention, false);
  assert.equal(checks.unreviewedDisclosure, false);
  assert.equal(checks.noUnsupportedClaims, false);
  assert.deepEqual(checks.groundedSentences.ungrounded, ['Bar 3 is busy.']);
});

test('grounding ignores sentences without bar numbers and accepts abstentions', () => {
  assert.deepEqual(groundedSentences(answer({ answer: 'Keep a steady beat. Bars 7–8 are busy.' }), snap), { total: 2, grounded: 2, ungrounded: [] });
  assert.equal(groundedSentences(answer({ answer: 'Bar 40 is not in this score.', abstained: true, references: [] }), snap).grounded, 1);
});

test('the offline run passes every release gate it can measure', async () => {
  const report = await runEval({ provider: 'offline' });
  const { metrics, gates } = summarize(report.results);
  assert.equal(metrics.graded, 8);
  assert.equal(metrics.skipped, 12);
  assert.equal(metrics.facts, 100);
  assert.ok(gates.every(g => g.passed !== false), JSON.stringify(gates));
  assert.match(report.questionBank.hash, /^[0-9a-f]{64}$/);
  assert.match(report.fixtures.song.hash, /^[0-9a-f]{64}$/);
});

test('a cloud run grades the model, counts fallbacks, tokens and cost, and fails gates on bad answers', async () => {
  const replies = {
    'What sticking should I use in bar 7?': { answer: "The score doesn't show sticking. Try asking how to count bar 7.", abstained: true, references: [{ fromBar: 7, toBar: 7, label: 'bar 7' }] },
    'What is the tempo of this song?': { answer: 'The tempo is 100 BPM.', abstained: false, references: [] },
    'Are there any accents in this song?': { answer: 'Accent the snare on beats 2 and 4.', abstained: false, references: [] },
  };
  const client = {
    configured: true,
    async createResponse(body) {
      const question = body.input[0].content[1].text.replace('Question: ', '');
      const reply = { suggestedQuestions: [], caveats: [], ...replies[question] };
      // Like a real model, look the score up once before answering.
      if (!body.input.some(item => item.type === 'function_call_output')) {
        return { status: 'completed', usage: { input_tokens: 1000, output_tokens: 100 },
          output: [{ type: 'function_call', call_id: 'c1', name: 'get_score_overview', arguments: '{}' }] };
      }
      return { status: 'completed', usage: { input_tokens: 1000, output_tokens: 100 },
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(reply) }] }] };
    },
  };
  const report = await runEval({ provider: 'openai', model: 'test-model', client, only: ['sticking', 'tempo', 'accents'] });
  const byId = Object.fromEntries(report.results.map(r => [r.id, r]));
  assert.equal(byId.sticking.mode, 'cloud');
  assert.deepEqual(byId.sticking.failures, []);
  assert.deepEqual(byId.tempo.failures, []);
  assert.equal(byId.accents.fellBack, true, 'the accent claim fails the checks twice, so the offline fallback answers');
  const { metrics, gates } = summarize(report.results, { inputPrice: 1, outputPrice: 10, provider: 'openai' });
  assert.equal(metrics.fallbacks, 1);
  assert.equal(metrics.modelAnswerRate, 66.7);
  assert.equal(gates.find(g => g.name.startsWith('Model answered')).passed, false, 'a fallback fails the model gate even when the shown answer is fine');
  assert.equal(metrics.tokens.input, 7000, 'three tool rounds, three answers and one repair');
  assert.equal(metrics.estimatedCostUsd, 0.014);
  assert.equal(gates.find(g => g.name.startsWith('Unavailable-fact')).passed, true);
});
