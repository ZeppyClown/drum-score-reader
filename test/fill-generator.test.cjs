const test = require('node:test');
const assert = require('node:assert/strict');
const { FillGenerator, RESPONSE_SCHEMA } = require('../desktop/fill-generator.cjs');

const good = {
  notes: [
    { duration: '8', dotted: false, triplet: false, drums: ['snare'] },
    { duration: '8', dotted: false, triplet: false, drums: ['tom_hi'] },
    { duration: '8', dotted: false, triplet: false, drums: ['tom_mid'] },
    { duration: '8', dotted: false, triplet: false, drums: ['floor_tom_1'] },
    { duration: '8', dotted: false, triplet: false, drums: ['floor_tom_2'] },
    { duration: '8', dotted: false, triplet: false, drums: ['snare'] },
    { duration: '8', dotted: false, triplet: false, drums: ['tom_mid'] },
    { duration: '8', dotted: false, triplet: false, drums: ['crash', 'kick'] },
  ],
  idea: 'Walk down the toms and finish with a crash.',
};
const response = value => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
const request = { tempoBpm: 100, subdivision: '16th', level: 'intermediate', style: 'rock', bars: 1 };

test('cloud help is required before a fill request is sent', async () => {
  let calls = 0;
  const result = await new FillGenerator({ client: { createResponse: async () => { calls++; } } }).generate(request);
  assert.match(result.error, /adult needs to turn on cloud help/);
  assert.equal(calls, 0);
});

test('a valid fill is returned and the request is strict with store false', async () => {
  let sent;
  const result = await new FillGenerator({ cloudEnabled: () => true, client: {
    createResponse: async body => { sent = body; return response(good); },
  } }).generate(request);
  assert.equal(result.model, 'gpt-5.6-luna');
  assert.equal(result.notes.length, 8);
  assert.equal(sent.store, false);
  assert.equal(sent.reasoning.effort, 'low');
  assert.equal(sent.text.format.strict, true);
  assert.deepEqual(sent.text.format.schema.required, ['notes', 'idea']);
  assert.equal(sent.text.format.schema.additionalProperties, false);
  assert.deepEqual(sent.text.format.schema.properties.notes.items.required, ['duration', 'dotted', 'triplet', 'drums']);
});

test('an overfilled answer gets one repair round and false triplet keys are removed', async () => {
  const calls = [];
  const overfilled = { notes: [...good.notes, { duration: 'q', dotted: false, triplet: false, drums: [] }], idea: 'too long' };
  const result = await new FillGenerator({ cloudEnabled: () => true, client: {
    createResponse: async body => { calls.push(body); return response(calls.length === 1 ? overfilled : good); },
  } }).generate(request);
  assert.equal(calls.length, 2);
  assert.match(calls[1].input.at(-1).content[0].text, /overfill|complete 4\/4/i);
  assert.equal(result.notes.some(note => Object.hasOwn(note, 'triplet') && note.triplet === false), false);
});

test('a still-bad answer becomes an error', async () => {
  const bad = { notes: [{ duration: 'q', dotted: false, triplet: false, drums: ['unknown'] }], idea: 'bad' };
  let calls = 0;
  const result = await new FillGenerator({ cloudEnabled: () => true, client: {
    createResponse: async () => { calls++; return response(bad); },
  } }).generate(request);
  assert.equal(calls, 2);
  assert.match(result.error, /did not pass DrumHub's check|unknown drum/);
});

test('API errors never escape generate', async () => {
  const result = await new FillGenerator({ cloudEnabled: () => true, client: {
    createResponse: async () => { throw new Error('API failed'); },
  } }).generate(request);
  assert.deepEqual(result, { error: 'API failed' });
});

test('request validation covers tempo, subdivision, style and one-bar scope', async () => {
  const generator = new FillGenerator({ cloudEnabled: () => true, client: { createResponse: async () => response(good) } });
  for (const [key, value, pattern] of [
    ['tempoBpm', 20, /tempo/], ['subdivision', 'quarter', /subdivision/],
    ['style', 'x'.repeat(21), /style/], ['bars', 2, /one bar/],
  ]) {
    const result = await generator.generate({ ...request, [key]: value });
    assert.match(result.error, new RegExp(pattern.source, 'i'));
  }
});

test('schema is strict at the root and note levels', () => {
  assert.equal(RESPONSE_SCHEMA.additionalProperties, false);
  assert.equal(RESPONSE_SCHEMA.properties.notes.items.additionalProperties, false);
  assert.equal(RESPONSE_SCHEMA.properties.notes.items.properties.dotted.type, 'boolean');
  assert.equal(RESPONSE_SCHEMA.properties.notes.items.properties.triplet.type, 'boolean');
});

test('an idea that claims sticking or hands is dropped', async () => {
  const { FillGenerator } = require('../desktop/fill-generator.cjs');
  const notes = [{ duration: 'w', dotted: false, triplet: false, drums: ['crash'] }];
  const client = { createResponse: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ notes, idea: 'Lead with your right hand on the crash.' }) }] }] }) };
  const result = await new FillGenerator({ client, cloudEnabled: () => true }).generate({ tempoBpm: 100, subdivision: '8th', level: 'beginner', style: 'rock', bars: 1 });
  assert.equal(result.idea, '');
  assert.deepEqual(result.notes, [{ duration: 'w', dotted: false, drums: ['crash'] }]);
});
