// Page and PDF import jobs (master plan B3): detect bars, let the user review the boxes,
// transcribe each box with the local model or GPT-5.6 Luna, and keep every result on
// disk as it arrives. A failed box never loses the others, can be retried on its own,
// and an interrupted job can be resumed after a restart. Runs in Electron main; image
// cropping, recognition and the service are injected so this file is tested in Node.
//
// Folder per job: <dir>/<jobId>/job.json and page-<n>.png. job.json holds the reviewed
// boxes (in reading order) and one result per box:
//   { status: 'done' | 'failed', key, bars: [{ notes, uncertainties }], gridSlots, model, error }
// `key` records the box position and recogniser; moving a box or switching recogniser
// makes its old result stale, so it is transcribed again.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { readingOrder, boxesFromSegmentation, validateBoxes } = require('../js/page-boxes.js');

const RECOGNIZERS = ['local', 'luna'];
const JOB_ID = /^[0-9a-f-]{36}$/;

const boxKey = (box, recognizer) => `${box.page}:${box.x},${box.y},${box.width},${box.height}:${recognizer}`;

function dataUrlToBuffer(dataUrl) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? '');
  if (!match) throw new Error('A page image could not be read.');
  return Buffer.from(match[1], 'base64');
}

class PageImports {
  // service: { segment(filePath), predictData(buffer, name) }
  // luna: { recognize(pngBuffer) } — only used when cloudEnabled() is true
  // crop(pagePng, { x, y, width, height }) → PNG buffer of that region
  constructor({ dir, service, luna, crop, cloudEnabled = () => false, idFactory = crypto.randomUUID,
    now = () => new Date().toISOString(), writeAtomic = null, lunaConcurrency = 2 }) {
    Object.assign(this, { dir, service, luna, crop, cloudEnabled, idFactory, now, lunaConcurrency });
    this.writeAtomic = writeAtomic ?? (async (file, text) => { await fs.writeFile(`${file}.tmp`, text); await fs.rename(`${file}.tmp`, file); });
    this.running = new Map();   // jobId → { canceled }
  }

  jobDir(jobId) {
    if (!JOB_ID.test(String(jobId))) throw new Error('Unknown page import.');
    return path.join(this.dir, jobId);
  }

  async readJob(jobId) {
    try { return JSON.parse(await fs.readFile(path.join(this.jobDir(jobId), 'job.json'), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') throw new Error('That page import is no longer available.');
      throw error;
    }
  }

  async saveJob(job) {
    await this.writeAtomic(path.join(this.jobDir(job.jobId), 'job.json'), `${JSON.stringify(job)}\n`);
  }

  async pageImages(job) {
    return Promise.all(job.pages.map(async page => ({
      ...page,
      image: `data:image/png;base64,${(await fs.readFile(path.join(this.jobDir(job.jobId), `page-${page.page}.png`))).toString('base64')}`,
    })));
  }

  // The file → pages with suggested boxes. Everything is saved before returning.
  async open(filePath) {
    const detected = await this.service.segment(filePath);
    if (!detected.pages?.length) throw new Error('No pages were found in that file.');
    const jobId = this.idFactory();
    const folder = this.jobDir(jobId);
    await fs.mkdir(folder, { recursive: true });
    for (const page of detected.pages) {
      await fs.writeFile(path.join(folder, `page-${page.page}.png`), dataUrlToBuffer(page.image));
    }
    const job = {
      jobId, fileName: path.basename(filePath), createdAt: this.now(), recognizer: 'local',
      pages: detected.pages.map(({ page, width, height }) => ({ page, width, height })),
      boxes: boxesFromSegmentation(detected.pages),
      results: {},
    };
    await this.saveJob(job);
    return this.summary(job, await this.pageImages(job));
  }

  summary(job, pages = null) {
    const counts = { done: 0, failed: 0, pending: 0 };
    for (const box of job.boxes) {
      const result = job.results[box.id];
      const current = result && result.key === boxKey(box, job.recognizer);
      counts[current ? result.status : 'pending'] += 1;
    }
    return {
      jobId: job.jobId, fileName: job.fileName, createdAt: job.createdAt, recognizer: job.recognizer,
      boxes: job.boxes, results: job.results, total: job.boxes.length, ...counts,
      ...(pages ? { pages } : {}),
    };
  }

  // Save the reviewed boxes (put in reading order) and the recogniser, then transcribe
  // every box without a current result. onProgress({ jobId, boxId, index, total, status, result }).
  async transcribe(jobId, boxes, recognizer, onProgress = () => {}) {
    if (!RECOGNIZERS.includes(recognizer)) throw new Error('Choose the local model or GPT-5.6 Luna.');
    if (recognizer === 'luna' && !this.cloudEnabled()) {
      throw new Error('GPT-5.6 Luna sends the bar images to OpenAI, so an adult needs to turn on cloud help first.');
    }
    if (this.running.has(jobId)) throw new Error('This page is already being transcribed.');
    let job = await this.readJob(jobId);
    const problems = validateBoxes(boxes, job.pages);
    if (problems.length) throw new Error(problems[0]);
    const ordered = readingOrder(boxes.map(({ id, page, x, y, width, height }) => ({ id, page, x, y, width, height })));
    job = { ...job, recognizer, boxes: ordered };
    await this.saveJob(job);
    const pending = ordered.filter(box => job.results[box.id]?.key !== boxKey(box, recognizer));
    return this.run(job, pending, onProgress);
  }

  async retry(jobId, boxId, onProgress = () => {}) {
    if (this.running.has(jobId)) throw new Error('This page is already being transcribed.');
    const job = await this.readJob(jobId);
    const box = job.boxes.find(b => b.id === boxId);
    if (!box) throw new Error('That bar box is no longer on the page.');
    if (job.recognizer === 'luna' && !this.cloudEnabled()) {
      throw new Error('GPT-5.6 Luna sends the bar images to OpenAI, so an adult needs to turn on cloud help first.');
    }
    return this.run(job, [box], onProgress);
  }

  cancel(jobId) {
    const state = this.running.get(jobId);
    if (state) state.canceled = true;
    return Boolean(state);
  }

  async run(startJob, pending, onProgress) {
    const state = { canceled: false };
    this.running.set(startJob.jobId, state);
    let job = startJob;
    const pagePngs = new Map();
    const pagePng = async number => {
      if (!pagePngs.has(number)) pagePngs.set(number, await fs.readFile(path.join(this.jobDir(job.jobId), `page-${number}.png`)));
      return pagePngs.get(number);
    };
    // Results are written one at a time, in any finishing order, so job.json stays whole.
    let saving = Promise.resolve();
    const record = (box, result) => {
      job = { ...job, results: { ...job.results, [box.id]: result } };
      const snapshot = job;
      saving = saving.then(() => this.saveJob(snapshot));
      onProgress({ jobId: job.jobId, boxId: box.id, index: job.boxes.indexOf(box) + 1, total: job.boxes.length, status: result.status, result });
      return saving;
    };
    const transcribeBox = async box => {
      const key = boxKey(box, job.recognizer);
      onProgress({ jobId: job.jobId, boxId: box.id, index: job.boxes.indexOf(box) + 1, total: job.boxes.length, status: 'working' });
      try {
        const png = await this.crop(await pagePng(box.page), box);
        if (job.recognizer === 'luna') {
          const result = await this.luna.recognize(png);
          await record(box, { status: 'done', key, bars: result.bars, gridSlots: result.gridSlots, model: result.model, note: result.message || '' });
        } else {
          const result = await this.service.predictData(png, `${box.id}.png`);
          await record(box, { status: 'done', key, bars: [{ notes: result.notes, uncertainties: [] }], gridSlots: result.gridSlots, model: result.model ?? 'local model' });
        }
      } catch (error) {
        await record(box, { status: 'failed', key, error: error.message });
      }
    };
    try {
      const workers = job.recognizer === 'luna' ? this.lunaConcurrency : 1;
      const queue = [...pending];
      await Promise.all(Array.from({ length: Math.min(workers, queue.length) }, async () => {
        while (queue.length && !state.canceled) await transcribeBox(queue.shift());
      }));
      await saving;
      return { ...this.summary(job), canceled: state.canceled };
    } finally {
      this.running.delete(job.jobId);
    }
  }

  // Jobs that were opened but never added to a score, newest first.
  async recoverable() {
    let names;
    try { names = await fs.readdir(this.dir); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const jobs = [];
    for (const name of names.filter(n => JOB_ID.test(n))) {
      try { jobs.push(this.summary(await this.readJob(name))); } catch { /* skip damaged jobs */ }
    }
    return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async load(jobId) {
    const job = await this.readJob(jobId);
    return this.summary(job, await this.pageImages(job));
  }

  // Remove a job once its bars were added to a score, or when the user throws it away.
  async discard(jobId) {
    if (this.running.has(jobId)) this.cancel(jobId);
    await fs.rm(this.jobDir(jobId), { recursive: true, force: true });
  }
}

module.exports = { PageImports, boxKey };
