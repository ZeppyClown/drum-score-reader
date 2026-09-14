const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PageImports } = require('../desktop/page-import.cjs');

const PNG = 'data:image/png;base64,' + Buffer.from('fake page png').toString('base64');
const detection = {
  barCount: 3,
  pages: [{ page: 1, width: 1000, height: 800, image: PNG, systems: [
    { bars: [{ x: 400, y: 100, width: 300, height: 120 }, { x: 50, y: 100, width: 300, height: 120 }] },
    { bars: [{ x: 50, y: 400, width: 600, height: 120 }] },
  ] }],
};
const notesFor = n => [{ position: n, duration: 'quarter', drums: ['snare'] }];

async function setup(t, overrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'drumhub-page-import-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let n = 0;
  const crops = [];
  const imports = new PageImports({
    dir,
    idFactory: () => `00000000-0000-4000-8000-00000000000${++n}`,
    service: {
      segment: async () => detection,
      predictData: async (png, name) => {
        const box = JSON.parse(png.toString());
        if (overrides.failX === box.x) throw new Error('Recognition failed for this crop');
        return { notes: notesFor(box.x / 50), gridSlots: 32, model: 'baseline-14drum-v1' };
      },
    },
    luna: { recognize: async png => ({ bars: [{ notes: notesFor(8), uncertainties: [] }], gridSlots: 32, model: 'gpt-5.6-luna', message: '' }) },
    crop: async (pagePng, box) => { crops.push([pagePng.toString(), box.id]); return Buffer.from(JSON.stringify({ x: box.x })); },
    cloudEnabled: () => overrides.cloud ?? false,
  });
  return { dir, imports, crops };
}

test('opening a file saves the pages and suggests boxes in reading order', async t => {
  const { dir, imports } = await setup(t);
  const job = await imports.open('/scores/page.png');
  assert.equal(job.fileName, 'page.png');
  assert.deepEqual(job.boxes.map(b => [b.id, b.x, b.y]), [['box-1', 50, 100], ['box-2', 400, 100], ['box-3', 50, 400]]);
  assert.equal(job.pages[0].image, PNG);
  assert.deepEqual({ done: job.done, failed: job.failed, pending: job.pending }, { done: 0, failed: 0, pending: 3 });
  assert.equal((await fs.readFile(path.join(dir, job.jobId, 'page-1.png'))).toString(), 'fake page png');
});

test('transcribing crops each reviewed box in reading order and keeps successes when one fails', async t => {
  const { imports, crops } = await setup(t, { failX: 400 });
  const job = await imports.open('/scores/page.png');
  const events = [];
  const reviewed = [...job.boxes, { id: 'drawn-1', page: 1, x: 700, y: 110, width: 250, height: 100 }].reverse();
  const result = await imports.transcribe(job.jobId, reviewed, 'local', e => events.push(`${e.boxId}:${e.status}`));
  assert.deepEqual(result.boxes.map(b => b.id), ['box-1', 'box-2', 'drawn-1', 'box-3']);
  assert.deepEqual(crops.map(c => c[1]), ['box-1', 'box-2', 'drawn-1', 'box-3']);
  assert.equal(crops[0][0], 'fake page png');
  assert.deepEqual({ done: result.done, failed: result.failed, pending: result.pending }, { done: 3, failed: 1, pending: 0 });
  assert.match(result.results['box-2'].error, /Recognition failed/);
  assert.deepEqual(result.results['box-1'].bars[0].notes, notesFor(1));
  assert.ok(events.includes('box-2:failed') && events.includes('box-3:done'));
  const reloaded = await imports.load(job.jobId);
  assert.equal(reloaded.results['box-3'].status, 'done', 'results are on disk');
});

test('retry runs just the failed box; moved boxes and a new recogniser are transcribed again', async t => {
  const overrides = { failX: 400, cloud: true };
  const { imports, crops } = await setup(t, overrides);
  const job = await imports.open('/scores/page.png');
  await imports.transcribe(job.jobId, job.boxes, 'local');
  overrides.failX = null;
  crops.length = 0;
  const retried = await imports.retry(job.jobId, 'box-2');
  assert.deepEqual(crops.map(c => c[1]), ['box-2']);
  assert.equal(retried.failed, 0);
  crops.length = 0;
  const moved = retried.boxes.map(b => (b.id === 'box-3' ? { ...b, x: 60 } : b));
  await imports.transcribe(job.jobId, moved, 'local');
  assert.deepEqual(crops.map(c => c[1]), ['box-3'], 'only the moved box is redone');
  crops.length = 0;
  const luna = await imports.transcribe(job.jobId, moved, 'luna');
  assert.equal(crops.length, 3);
  assert.equal(luna.results['box-1'].model, 'gpt-5.6-luna');
});

test('Luna needs cloud help; bad boxes and unknown jobs are refused', async t => {
  const { imports } = await setup(t, { cloud: false });
  const job = await imports.open('/scores/page.png');
  await assert.rejects(imports.transcribe(job.jobId, job.boxes, 'luna'), /adult needs to turn on cloud help/);
  await assert.rejects(imports.transcribe(job.jobId, [{ ...job.boxes[0], x: 950 }], 'local'), /past the edge/);
  await assert.rejects(imports.transcribe(job.jobId, job.boxes, 'magic'), /local model or GPT-5.6 Luna/);
  await assert.rejects(imports.load('../../etc'), /Unknown page import/);
  await assert.rejects(imports.load('00000000-0000-4000-8000-000000000999'), /no longer available/);
});

test('cancel stops before the next box; unfinished jobs are listed for resuming, then discarded', async t => {
  const { imports } = await setup(t);
  const job = await imports.open('/scores/page.png');
  const result = await imports.transcribe(job.jobId, job.boxes, 'local', e => { if (e.status === 'done') imports.cancel(job.jobId); });
  assert.equal(result.canceled, true);
  assert.deepEqual({ done: result.done, pending: result.pending }, { done: 1, pending: 2 });
  const [listed] = await imports.recoverable();
  assert.equal(listed.jobId, job.jobId);
  assert.equal(listed.pending, 2);
  await imports.discard(job.jobId);
  assert.deepEqual(await imports.recoverable(), []);
});
