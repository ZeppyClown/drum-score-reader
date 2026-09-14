// Requires the local released bundle and backend runtime; run with npm run test:service.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { OmrService } = require('../desktop/omr-service.cjs');
const root = path.resolve(__dirname, '..');

test('released service: readiness, process reuse, prediction, errors, crash recovery and shutdown', async () => {
  const service = new OmrService({ root });
  try {
    const [health, again] = await Promise.all([service.start(), service.start()]);
    assert.deepEqual(again, health);
    assert.equal(health.grid_slots, 32);
    const pid = service.child.pid;
    const images = path.join(root, 'ml/data/training/dataset/images');
    const image = '21 Guns Drum Tab by Green Day _ Songsterr Tabs with Rhythm_bar003.png';
    const result = await service.predict(path.join(images, image));
    assert.ok(result.notes.length > 0);
    assert.equal(result.model_sha256, health.model_sha256);
    assert.equal(service.child.pid, pid);
    await assert.rejects(service.predict(path.join(root, 'package.json')), /PNG or JPEG/);
    await assert.rejects(service.predict(path.join(root, 'missing-image.png')), /ENOENT/);
    const child = service.child;
    await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGKILL'); });
    await service.start();
    assert.notEqual(service.child.pid, pid);
    const url = service.url;
    await service.stop();
    await assert.rejects(fetch(`${url}/health`));
    assert.equal(service.child, null);
  } finally { await service.stop(); }
});

test('missing artifacts and Python failures are actionable and retryable', async () => {
  const missing = new OmrService({ root, bundle: path.join(root, 'missing-bundle') });
  await assert.rejects(missing.start(), /Missing omr.onnx.*OMR_BUNDLE/);
  await assert.rejects(missing.start(), /Missing omr.onnx/);
  const noPython = new OmrService({ root, python: '/nonexistent-python' });
  await assert.rejects(noPython.start(), /OMR_PYTHON/);
  const timeout = new OmrService({ root, startupTimeout: 1 });
  await assert.rejects(timeout.start(), /timed out/);
  assert.equal(timeout.child, null);
});
