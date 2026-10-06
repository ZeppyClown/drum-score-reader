// Bar reading by the fine-tuned Qwen server (QWEN_OMR_URL) instead of the local model.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { OmrService } = require('../desktop/omr-service.cjs');

const notes = [{ position: 0, duration: 'quarter', drums: ['kick', 'hi_hat_closed'] }];
const reply = (body, { ok = true, status = 200 } = {}) => ({ ok, status, json: async () => body });

function remote(options = {}) {
  const calls = [];
  const service = new OmrService({
    root: '/nonexistent', remoteUrl: 'https://omr.example/', remoteToken: 'secret', cloudEnabled: () => true,
    fetchImpl: async (...args) => { calls.push(args); return reply({ notes, model: 'qwen-test' }); },
    ...options,
  });
  return { service, calls };
}

test('a bar goes to the Qwen server with the token and never starts the local service', async () => {
  const { service, calls } = remote();
  const result = await service.predictData(Buffer.from('png bytes'), 'bar.png');
  assert.deepEqual(result, { notes, gridSlots: 32, model: 'qwen-test' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://omr.example/predict');
  assert.equal(calls[0][1].headers.authorization, 'Bearer secret');
  assert.equal(calls[0][1].body.get('image').size, 9);
  assert.equal(service.child, undefined);
});

test('a picked file is read and sent the same way', async () => {
  const { service, calls } = remote();
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'omr-remote-')), 'bar.png');
  await fs.writeFile(file, 'png bytes');
  assert.deepEqual((await service.predict(file)).notes, notes);
  assert.equal(calls.length, 1);
});

test('nothing is sent while cloud help is off', async () => {
  const { service, calls } = remote({ cloudEnabled: () => false });
  await assert.rejects(service.predictData(Buffer.from('x')), error => error.code === 'cloud_required' && /adult/.test(error.message));
  assert.equal(calls.length, 0);
});

test('nothing is sent to a server that is not https', async () => {
  const { service, calls } = remote({ remoteUrl: 'http://omr.example' });
  await assert.rejects(service.predictData(Buffer.from('x')), /https/);
  assert.equal(calls.length, 0);
});

test('server errors, bad output, oversized images and silence all give a plain message', async () => {
  const failing = body => remote({ fetchImpl: async () => body }).service.predictData(Buffer.from('x'));
  await assert.rejects(failing(reply({ error: { code: 'unreadable_answer', message: 'The model could not read this bar' } }, { ok: false, status: 422 })), /could not read this bar/);
  await assert.rejects(failing(reply({ notes: 'nope' })), /invalid output/);
  await assert.rejects(remote().service.predictData(Buffer.alloc(10 * 1024 * 1024 + 1)), /10 MB/);
  const silent = remote({ fetchImpl: async () => { throw new Error('socket hang up'); } });
  await assert.rejects(silent.service.predictData(Buffer.from('x')), /did not answer/);
});
