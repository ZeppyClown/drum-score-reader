const test = require('node:test');
const assert = require('node:assert/strict');
const { ScoreAgent, INSTRUCTIONS } = require('../desktop/score-agent.cjs');
const { scoreSnapshot } = require('../js/score-snapshot.js');
const { songEditor } = require('./fixture-scores.mjs');

const snap = () => scoreSnapshot(songEditor());
const call = (name, args, id = `call_${name}`) => ({ type: 'function_call', id: `fc_${id}`, call_id: id, name, arguments: JSON.stringify(args) });
const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque' };
const message = answer => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(answer) }] });
const answer = (overrides = {}) => ({ answer: 'Bars 7–8 have the busiest notes: sixteenth notes all the way through.', abstained: false,
  references: [{ fromBar: 7, toBar: 8, label: 'bars 7–8' }], suggestedQuestions: ['How do I count it?'], caveats: [], ...overrides });

// A scripted OpenAI: each createResponse returns the next body and records a copy of the request.
function scripted(...outputs) {
  const requests = [];
  return {
    requests,
    configured: true,
    apiKey: 'sk-test-agent-123456',
    async createResponse(body, options) {
      requests.push({ body: JSON.parse(JSON.stringify(body)), options });
      const next = outputs.shift();
      if (next instanceof Error) throw next;
      if (typeof next === 'function') return next(body, options);
      return { status: 'completed', output: next, usage: { input_tokens: 100, output_tokens: 20, output_tokens_details: { reasoning_tokens: 5 } } };
    },
  };
}

let clock = 0;
const agentWith = (client, extra = {}) => new ScoreAgent({ client, model: 'agent-model', settings: () => ({ cloudEnabled: true }), now: () => (clock += 2000), ...extra });
const ask = (agent, overrides = {}) => agent.ask({ question: 'Where is the hardest part?', scope: { fromBar: 1, toBar: 10 }, snapshot: snap(), ...overrides });

test('tool loop: the model calls a tool, gets local facts, then answers with checked references', async () => {
  const client = scripted([reasoning, call('find_complex_passages', { top: null })], [message(answer())]);
  const result = await ask(agentWith(client));
  assert.equal(result.mode, 'cloud');
  assert.equal(result.model, 'agent-model');
  assert.equal(result.answer, answer().answer);
  assert.deepEqual(result.references.map(r => [r.fromBar, r.toBar, Boolean(r.fromBarId)]), [[7, 8, true]]);
  assert.deepEqual(result.usage.toolCalls, ['find_complex_passages']);
  assert.equal(result.usage.inputTokens, 200);
  assert.equal(result.revision, snap().revision);
  assert.ok(Number.isFinite(result.latencyMs));

  const [first, second] = client.requests;
  assert.equal(first.body.model, 'agent-model');
  assert.equal(first.body.instructions, INSTRUCTIONS);
  assert.deepEqual(first.body.tools.map(t => t.name).length, 7);
  assert.equal(first.body.text.format.strict, true);
  assert.deepEqual(first.body.include, ['reasoning.encrypted_content']);
  assert.equal(first.options.setting, 'OPENAI_AGENT_MODEL');
  assert.equal(JSON.stringify(first.body).includes('Ignore previous instructions'), false, 'title never sent');
  assert.equal(JSON.stringify(first.body).includes('hi_hat_closed'), false, 'notes only arrive through tools');
  assert.deepEqual(second.body.input.slice(1, 3), [reasoning, call('find_complex_passages', { top: null })]);
  const output = second.body.input[3];
  assert.equal(output.type, 'function_call_output');
  assert.equal(output.call_id, 'call_find_complex_passages');
  assert.deepEqual(JSON.parse(output.output).passages[0], { fromBar: 7, toBar: 8, score: 50 });
});

test('unchecked imported bars are always disclosed, even if the model forgets', async () => {
  const client = scripted([message(answer({ answer: 'Bar 10 has triplets.', references: [{ fromBar: 10, toBar: 10, label: 'bar 10' }] }))]);
  const result = await ask(agentWith(client), { scope: { fromBar: 10, toBar: 10 } });
  assert.ok(result.caveats.some(c => /Bar 10 was imported and not checked yet/.test(c)));
});

test('an invalid reference gets one repair round; a fixed answer is accepted', async () => {
  const client = scripted(
    [message(answer({ references: [{ fromBar: 12, toBar: 14, label: 'bars 12–14' }] }))],
    [message(answer())],
  );
  const result = await ask(agentWith(client));
  assert.equal(result.mode, 'cloud');
  assert.equal(result.usage.repaired, true);
  const repair = client.requests[1].body.input.at(-1).content[0].text;
  assert.match(repair, /only bars 1–10 exist here/);
});

test('an answer that still fails the checks falls back to a true offline answer', async () => {
  const bad = message(answer({ answer: 'Use your right hand to lead bar 7.', references: [{ fromBar: 7, toBar: 7, label: 'bar 7' }] }));
  const client = scripted([bad], [bad]);
  const result = await ask(agentWith(client), { questionId: 'find-complex', question: undefined });
  assert.equal(result.mode, 'offline');
  assert.match(result.answer, /busiest notation is in bars 7–8/);
  assert.equal(result.usage.inputTokens, 200, 'tokens from the failed attempts are still reported');
  assert.ok(result.caveats.some(c => /Cloud help could not answer \(the answer did not pass DrumHub's checks: The score does not record/.test(c)));
});

test('API errors, refusals and bad JSON fall back offline; free-text fallback abstains', async () => {
  const failing = scripted(new Error('OpenAI timed out. Check your connection and retry.'));
  const result = await ask(agentWith(failing));
  assert.equal(result.mode, 'offline');
  assert.equal(result.abstained, true);
  assert.ok(result.caveats[0].includes('OpenAI timed out'));
  const refused = scripted([{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }]);
  assert.equal((await ask(agentWith(refused), { questionId: 'overview' })).mode, 'offline');
  const garbage = scripted([{ type: 'message', content: [{ type: 'output_text', text: 'not json' }] }], [message(answer())]);
  assert.equal((await ask(agentWith(garbage))).mode, 'cloud');
});

test('tool rounds are bounded: after the limit the model must answer without tools', async () => {
  const loop = () => [call('get_score_overview', {})];
  const client = scripted(loop(), loop(), [message(answer())]);
  const result = await ask(agentWith(client, { maxToolRounds: 2 }));
  assert.equal(result.mode, 'cloud');
  assert.deepEqual(client.requests.map(r => r.body.tool_choice), ['auto', 'auto', 'none']);
});

test('bad tool arguments return an error to the model instead of crashing', async () => {
  const client = scripted([call('inspect_bars', { fromBar: 50, toBar: 60 })], [message(answer())]);
  await ask(agentWith(client));
  const output = JSON.parse(client.requests[1].body.input.at(-1).output);
  assert.match(output.error, /Bars 1–10 are available/);
});

test('with cloud help off or no key, no request is made and the offline answer is used', async () => {
  const client = scripted();
  const off = agentWith(client, { settings: () => ({ cloudEnabled: false }) });
  const result = await ask(off, { questionId: 'count-bar', question: undefined, scope: { fromBar: 10, toBar: 10 } });
  assert.equal(result.mode, 'offline');
  assert.match(result.answer, /1 trip let \(2\) 3 4 &/);
  assert.equal(client.requests.length, 0);
  const noKey = agentWith({ ...scripted(), configured: false });
  assert.equal((await ask(noKey)).mode, 'offline');
});

test('requests are validated before anything is sent', async () => {
  const client = scripted();
  const agent = agentWith(client);
  await assert.rejects(ask(agent, { question: 'x'.repeat(501) }), /under 500 characters/);
  await assert.rejects(ask(agent, { question: '   ' }), /Type a question/);
  await assert.rejects(ask(agent, { questionId: 'delete-everything' }), /Unknown suggested question/);
  await assert.rejects(ask(agent, { snapshot: { ...snap(), snapshotHash: '0'.repeat(64) } }), /could not be checked/);
  await assert.rejects(ask(agent, { scope: { fromBar: 3, toBar: 30 } }), /not part of the shared score/);
  assert.equal(client.requests.length, 0);
});

test('one question at a time, a short pause between questions, and a daily limit', async () => {
  let release;
  const client = scripted(() => new Promise(resolve => { release = () => resolve({ status: 'completed', output: [message(answer())] }); }), [message(answer())]);
  let now = 10000;
  const agent = new ScoreAgent({ client, settings: () => ({ cloudEnabled: true }), now: () => now, minIntervalMs: 1500, dailyLimit: 2 });
  const first = ask(agent);
  await assert.rejects(ask(agent), /Wait for the current answer/);
  release();
  assert.equal((await first).mode, 'cloud');
  now += 500;
  await assert.rejects(ask(agent), /wait a moment/);
  now += 2000;
  assert.equal((await ask(agent)).mode, 'cloud');
  now += 2000;
  const limited = await ask(agent, { questionId: 'overview' });
  assert.equal(limited.mode, 'offline');
  assert.match(limited.caveats[0], /limit of 2 cloud questions/);
});

test('cancel stops the question and reports it as canceled', async () => {
  const client = scripted((_body, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Canceled.')));
  }));
  const agent = agentWith(client);
  const pending = ask(agent);
  agent.cancel();
  assert.equal((await pending).canceled, true);
  assert.equal(agent.inFlight, null);
});

test('the daily limit is loaded from and saved to the usage store, and counts only sent questions', async () => {
  const saved = [];
  const store = { load: () => ({ day: new Date(0).toISOString().slice(0, 10), cloudQuestions: 1, inputTokens: 5, outputTokens: 1 }), save: u => saved.push(u) };
  let now = 1000;
  const client = scripted([message(answer())]);
  const agent = new ScoreAgent({ client, settings: () => ({ cloudEnabled: true }), now: () => (now += 5000), dailyLimit: 2, usageStore: store });
  assert.equal((await ask(agent)).mode, 'cloud');
  assert.equal(agent.usage.cloudQuestions, 2);
  assert.equal(saved.at(-1).cloudQuestions, 2);
  const limited = await ask(agent, { questionId: 'overview' });
  assert.match(limited.caveats[0], /limit of 2/);
  assert.equal(client.requests.length, 1);
});
