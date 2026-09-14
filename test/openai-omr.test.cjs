const test = require('node:test');
const assert = require('node:assert/strict');
const { OpenAiOmr } = require('../desktop/openai-omr.cjs');

const transcription = {
  schemaVersion: 1, gridSlots: 32, status: 'ok', message: '',
  notes: [{ position: 0, duration: 'quarter', drums: ['kick', 'hi_hat_closed'] }],
  uncertainties: [],
};

function apiResponse(text = JSON.stringify(transcription), { ok = true, status = 200,
  responseStatus = 'completed' } = {}) {
  return { ok, status, json: async () => ok ? ({
    status: responseStatus,
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
  }) : ({ error: { message: text } }) };
}

test('OpenAI sends the clipboard PNG to Luna at original detail with a strict schema', async () => {
  let call;
  const openai = new OpenAiOmr({ apiKey: 'test-key', fetchImpl: async (...args) => {
    call = args; return apiResponse();
  } });
  const png = Buffer.from('png bytes');
  const result = await openai.recognize(png);
  assert.deepEqual(result.notes, transcription.notes);
  assert.equal(result.model, 'gpt-5.6-luna');
  assert.equal(call[0], 'https://api.openai.com/v1/responses');
  assert.equal(call[1].headers.authorization, 'Bearer test-key');
  const request = JSON.parse(call[1].body);
  assert.equal(request.model, 'gpt-5.6-luna');
  assert.equal(request.store, false);
  assert.equal(request.reasoning.effort, 'medium');
  assert.equal(request.input[0].content[1].type, 'input_image');
  assert.equal(request.input[0].content[1].detail, 'original');
  assert.equal(request.input[0].content[1].image_url,
    `data:image/png;base64,${png.toString('base64')}`);
  assert.equal(request.text.format.type, 'json_schema');
  assert.equal(request.text.format.strict, true);
  assert.equal(request.text.format.schema.properties.gridSlots.enum[0], 32);
});

test('OpenAI errors explain missing setup, API rejection, bad output and crop requirements', async () => {
  await assert.rejects(new OpenAiOmr({ apiKey: '' }).recognize(Buffer.from('x')), /OPENAI_API_KEY/);
  await assert.rejects(new OpenAiOmr({ apiKey: 'x', fetchImpl: async () => apiResponse('bad key',
    { ok: false, status: 403 }) }).recognize(Buffer.from('x')), /not allowed.*bad key/);
  await assert.rejects(new OpenAiOmr({ apiKey: 'x', fetchImpl: async () => apiResponse('not json')
  }).recognize(Buffer.from('x')), /invalid transcription JSON/);
  await assert.rejects(new OpenAiOmr({ apiKey: 'x', fetchImpl: async () => apiResponse(JSON.stringify({
    ...transcription, status: 'needs_crop', message: 'Crop to one bar.', notes: [],
  })) }).recognize(Buffer.from('x')), /Crop to one bar/);
});

test('OpenAI API errors identify key, request, model and quota failures', async () => {
  const rejected = (message, status) => new OpenAiOmr({ apiKey: 'x', fetchImpl: async () =>
    apiResponse(message, { ok: false, status }), sleepImpl: async () => {} }).recognize(Buffer.from('x'));
  await assert.rejects(rejected('invalid key', 401), /API key is invalid/);
  await assert.rejects(rejected('Invalid JSON payload', 400), /request configuration/);
  await assert.rejects(rejected('model missing', 404), /model is unavailable/);
  await assert.rejects(rejected('too many requests', 429), /quota or rate limit/);
});

test('OpenAI exposes refusals and incomplete responses', async () => {
  const refusal = new OpenAiOmr({ apiKey: 'x', fetchImpl: async () => ({
    ok: true, status: 200, json: async () => ({ status: 'completed', output: [{
      type: 'message', content: [{ type: 'refusal', refusal: 'Cannot inspect this image.' }],
    }] }),
  }) });
  await assert.rejects(refusal.recognize(Buffer.from('x')), /refused.*Cannot inspect/);
  const incomplete = new OpenAiOmr({ apiKey: 'x', fetchImpl: async () => ({
    ok: true, status: 200, json: async () => ({
      status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [],
    }),
  }) });
  await assert.rejects(incomplete.recognize(Buffer.from('x')), /incomplete.*max_output_tokens/);
});

test('OpenAI retries temporary server failures and preserves the PNG request', async () => {
  const calls = [];
  const delays = [];
  const responses = [
    apiResponse('temporary server problem', { ok: false, status: 503 }),
    apiResponse('temporary server problem', { ok: false, status: 503 }),
    apiResponse(),
  ];
  const openai = new OpenAiOmr({
    apiKey: 'x',
    fetchImpl: async (...args) => { calls.push(args); return responses.shift(); },
    sleepImpl: async delay => { delays.push(delay); },
    retryDelayMs: 100,
    randomImpl: () => 0,
  });
  const result = await openai.recognize(Buffer.from('same png'));
  assert.equal(result.status, 'ok');
  assert.equal(calls.length, 3);
  assert.deepEqual(delays, [100, 200]);
  assert.equal(calls[0][1].body, calls[1][1].body);
  assert.equal(calls[1][1].body, calls[2][1].body);
});

test('OpenAI reports persistent server failure after bounded retries', async () => {
  let calls = 0;
  const openai = new OpenAiOmr({
    apiKey: 'x',
    fetchImpl: async () => {
      calls += 1;
      return apiResponse('temporary server problem', { ok: false, status: 503 });
    },
    sleepImpl: async () => {},
  });
  await assert.rejects(openai.recognize(Buffer.from('x')), /still unavailable after 3 attempts/);
  assert.equal(calls, 3);
});

test('OpenAI does not retry a bad request', async () => {
  let calls = 0;
  const openai = new OpenAiOmr({
    apiKey: 'x',
    fetchImpl: async () => {
      calls += 1;
      return apiResponse('Invalid JSON payload', { ok: false, status: 400 });
    },
    sleepImpl: async () => { throw new Error('must not sleep'); },
  });
  await assert.rejects(openai.recognize(Buffer.from('x')), /request configuration/);
  assert.equal(calls, 1);
});
