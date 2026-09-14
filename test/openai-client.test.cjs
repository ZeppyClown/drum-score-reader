const test = require('node:test');
const assert = require('node:assert/strict');
const { OpenAiClient, modelSettings, outputText } = require('../desktop/openai-client.cjs');
const { OpenAiOmr } = require('../desktop/openai-omr.cjs');

const ok = body => ({ ok: true, status: 200, json: async () => body });
const completed = text => ok({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });

test('import and agent models are separate settings with sensible fallbacks', () => {
  assert.deepEqual(modelSettings({}), { omr: 'gpt-5.6-luna', agent: 'gpt-5.6-luna' });
  assert.deepEqual(modelSettings({ OPENAI_MODEL: 'old' }), { omr: 'old', agent: 'gpt-5.6-luna' });
  assert.deepEqual(modelSettings({ OPENAI_MODEL: 'old', OPENAI_OMR_MODEL: 'omr', OPENAI_AGENT_MODEL: 'agent' }),
    { omr: 'omr', agent: 'agent' });
});

test('every request is sent with store:false, even if a caller asks otherwise', async () => {
  let sent;
  const client = new OpenAiClient({ apiKey: 'sk-test-12345678', fetchImpl: async (_url, init) => { sent = JSON.parse(init.body); return completed('hi'); } });
  await client.createResponse({ model: 'm', store: true, input: 'x' });
  assert.equal(sent.store, false);
});

test('the key never appears in the URL, body, log events or errors', async () => {
  const apiKey = 'sk-proj-SECRET-client-check-987654321';
  const calls = []; const logs = [];
  const client = new OpenAiClient({ apiKey, sleepImpl: async () => {}, log: event => logs.push(JSON.stringify(event)),
    fetchImpl: async (url, init) => { calls.push([url, init.body]); return { ok: false, status: 401, json: async () => ({ error: { message: `bad key ${apiKey}` } }) }; } });
  await assert.rejects(client.createResponse({ model: 'm', input: 'q' }), error => !error.message.includes(apiKey) && /\[redacted\]/.test(error.message));
  for (const [url, body] of calls) { assert.equal(url.includes(apiKey), false); assert.equal(body.includes(apiKey), false); }
  assert.ok(logs.length > 0);
  assert.equal(logs.some(line => line.includes(apiKey) || line.includes('"q"')), false);
});

test('the 404 hint names the setting for the feature that failed', async () => {
  const client = new OpenAiClient({ apiKey: 'x', fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({ error: { message: 'nope' } }) }) });
  await assert.rejects(client.createResponse({ model: 'm' }, { setting: 'OPENAI_AGENT_MODEL' }), /Check OPENAI_AGENT_MODEL/);
});

test('outputText reads only message items, so reasoning and tool calls are ignored', () => {
  const body = { output: [
    { type: 'reasoning', summary: [] },
    { type: 'function_call', name: 'inspect_bars', arguments: '{}' },
    { type: 'message', content: [{ type: 'output_text', text: '{"a":1}' }] },
  ] };
  assert.equal(outputText(body, 'the question'), '{"a":1}');
});

test('screenshot import uses the OMR model setting through the shared client', async () => {
  let sent;
  const client = new OpenAiClient({ apiKey: 'x', fetchImpl: async (_url, init) => { sent = JSON.parse(init.body); return completed(JSON.stringify({
    schemaVersion: 1, gridSlots: 32, status: 'ok', message: '', notes: [], uncertainties: [] })); } });
  const omr = new OpenAiOmr({ client, model: 'omr-model' });
  const result = await omr.recognize(Buffer.from('png'));
  assert.equal(sent.model, 'omr-model');
  assert.equal(result.model, 'omr-model');
});
