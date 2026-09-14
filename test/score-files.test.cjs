const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ScoreFiles, SCORE_EXTENSION } = require('../desktop/score-files.cjs');
const { ScoreSession } = require('../desktop/score-session.cjs');
const { createMeta, withIds, toDocument } = require('../js/score-document.js');

function makeDoc(title = 'Groove') {
  let n = 0;
  const ids = () => `id-${++n}`;
  const meta = createMeta({ idFactory: ids, title });
  return toDocument(meta, withIds([{ notes: [{ duration: 'w', dotted: false, drums: ['crash'] }] }], ids));
}

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'drumhub-files-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function filesIn(t) {
  const dir = await tempDir(t);
  const files = new ScoreFiles({ dataDir: path.join(dir, 'userData') });
  return { dir, files };
}

// ── ScoreFiles ───────────────────────────────────────────────────────────────

test('save writes readable JSON atomically and load reads it back', async t => {
  const { dir, files } = await filesIn(t);
  const target = path.join(dir, `groove${SCORE_EXTENSION}`);
  const { hash } = await files.save(target, makeDoc());
  const text = await fs.readFile(target, 'utf8');
  assert.match(text, /"title": "Groove"/);
  const loaded = await files.load(target);
  assert.deepEqual(loaded.doc, makeDoc());
  assert.equal(loaded.hash, hash);
  assert.deepEqual((await fs.readdir(dir)).filter(name => name.includes('.tmp')), []);
});

test('a crash while saving leaves the last good save untouched', async t => {
  const { dir, files } = await filesIn(t);
  const target = path.join(dir, `groove${SCORE_EXTENSION}`);
  await files.save(target, makeDoc('Good'));
  const good = await fs.readFile(target, 'utf8');
  for (const failAt of ['write', 'sync', 'rename']) {
    const crashing = new ScoreFiles({ dataDir: path.join(dir, 'userData'), fault: step => {
      if (step === failAt) throw new Error(`simulated crash during ${step}`);
    } });
    await assert.rejects(crashing.save(target, makeDoc('Half written')), /simulated crash/);
    assert.equal(await fs.readFile(target, 'utf8'), good, failAt);
  }
  assert.deepEqual((await fs.readdir(dir)).filter(name => name !== 'userData'), [`groove${SCORE_EXTENSION}`]);
});

test('save refuses an invalid document without touching the file', async t => {
  const { dir, files } = await filesIn(t);
  const target = path.join(dir, `groove${SCORE_EXTENSION}`);
  await files.save(target, makeDoc());
  const before = await fs.readFile(target, 'utf8');
  await assert.rejects(files.save(target, { ...makeDoc(), tempoBpm: 9000 }), /tempo/);
  assert.equal(await fs.readFile(target, 'utf8'), before);
});

test('files from a newer DrumHub are refused and never rewritten', async t => {
  const { dir, files } = await filesIn(t);
  const target = path.join(dir, `future${SCORE_EXTENSION}`);
  const future = JSON.stringify({ ...makeDoc(), schemaVersion: 9, newThing: true });
  await fs.writeFile(target, future);
  await assert.rejects(files.load(target), err => err.code === 'future_version');
  assert.equal(await fs.readFile(target, 'utf8'), future);
});

test('load rejects huge, missing and non-score files with readable messages', async t => {
  const { dir, files } = await filesIn(t);
  await assert.rejects(files.load(path.join(dir, 'missing.drumhub.json')), /could not be found/);
  const big = path.join(dir, 'big.drumhub.json');
  await fs.writeFile(big, Buffer.alloc(files.maxBytes + 1, 32));
  await assert.rejects(files.load(big), /too large/);
  const notes = path.join(dir, 'notes.drumhub.json');
  await fs.writeFile(notes, 'hello');
  await assert.rejects(files.load(notes), /not valid JSON/);
});

test('recovery copies are written, listed newest first, and cleared', async t => {
  const { files } = await filesIn(t);
  const a = makeDoc('First');
  const b = { ...makeDoc('Second'), scoreId: 'score-b' };
  let clock = 1000;
  files.now = () => clock;
  await files.writeRecovery(a, { filePath: '/scores/a.drumhub.json', diskHash: 'abc' });
  clock = 2000;
  await files.writeRecovery(b, { filePath: null, diskHash: null });
  const entries = await files.listRecovery();
  assert.deepEqual(entries.map(e => [e.doc.title, e.savedAt, e.filePath]),
    [['Second', 2000, null], ['First', 1000, '/scores/a.drumhub.json']]);
  await files.clearRecovery('score-b');
  assert.deepEqual((await files.listRecovery()).map(e => e.doc.title), ['First']);
  await files.clearRecovery('does-not-exist');
});

test('corrupt or future recovery files are skipped, not deleted', async t => {
  const { files } = await filesIn(t);
  await files.writeRecovery(makeDoc('Fine'), {});
  await fs.writeFile(path.join(files.recoveryDir, 'broken.json'), '{');
  await fs.writeFile(path.join(files.recoveryDir, 'future.json'),
    JSON.stringify({ savedAt: 5, filePath: null, diskHash: null, document: { ...makeDoc(), schemaVersion: 4 } }));
  assert.deepEqual((await files.listRecovery()).map(e => e.doc.title), ['Fine']);
  assert.equal((await fs.readdir(files.recoveryDir)).length, 3);
});

test('recovery file names cannot escape the recovery folder', async t => {
  const { files } = await filesIn(t);
  await assert.rejects(files.writeRecovery({ ...makeDoc(), scoreId: '../../evil' }, {}), /scoreId/);
  await assert.rejects(files.clearRecovery('../evil'), /Invalid score id/);
});

test('recent files keep the newest ten without duplicates', async t => {
  const { files } = await filesIn(t);
  for (let i = 0; i < 12; i++) await files.addRecent(`/scores/${i}.drumhub.json`);
  await files.addRecent('/scores/5.drumhub.json');
  const recent = await files.recent();
  assert.equal(recent.length, 10);
  assert.equal(recent[0], '/scores/5.drumhub.json');
  assert.equal(recent.filter(p => p === '/scores/5.drumhub.json').length, 1);
  await fs.writeFile(files.recentFile, 'garbage');
  assert.deepEqual(await files.recent(), []);
});

// ── ScoreSession (dialogs are scripted) ──────────────────────────────────────

function scriptedDialogs(answers) {
  const asked = [];
  const take = kind => {
    asked.push(kind);
    if (!answers[kind]?.length) throw new Error(`unexpected ${kind} dialog`);
    return answers[kind].shift();
  };
  return {
    asked,
    chooseSavePath: async defaultName => take('save') ?? null,
    chooseOpenPath: async () => take('open') ?? null,
    confirmConflict: async () => take('conflict'),
  };
}

test('first save asks for a path, adds the extension, and clears recovery', async t => {
  const { dir, files } = await filesIn(t);
  const dialogs = scriptedDialogs({ save: [path.join(dir, 'My Groove')] });
  const session = new ScoreSession({ files, dialogs });
  await files.writeRecovery(makeDoc(), {});
  const result = await session.save(makeDoc());
  assert.deepEqual(result, { saved: true, name: `My Groove${SCORE_EXTENSION}` });
  assert.equal(session.filePath, path.join(dir, `My Groove${SCORE_EXTENSION}`));
  assert.deepEqual(await files.listRecovery(), []);
  assert.deepEqual(await files.recent(), [session.filePath]);
  const again = await session.save({ ...makeDoc(), tempoBpm: 100 });
  assert.equal(again.saved, true);
  assert.deepEqual(dialogs.asked, ['save']);
});

test('cancelling the save dialog writes nothing', async t => {
  const { dir, files } = await filesIn(t);
  const session = new ScoreSession({ files, dialogs: scriptedDialogs({ save: [null] }) });
  assert.deepEqual(await session.save(makeDoc()), { canceled: true });
  assert.equal(session.filePath, null);
  assert.deepEqual((await fs.readdir(dir)).filter(n => n !== 'userData'), []);
});

test('saving over a file changed on disk asks first and can cancel or overwrite', async t => {
  const { dir, files } = await filesIn(t);
  const target = path.join(dir, `groove${SCORE_EXTENSION}`);
  await files.save(target, makeDoc());
  const dialogs = scriptedDialogs({ conflict: ['cancel', 'overwrite'] });
  const session = new ScoreSession({ files, dialogs });
  await session.open(target);
  await fs.writeFile(target, JSON.stringify({ ...makeDoc('Edited elsewhere') }));
  const elsewhere = await fs.readFile(target, 'utf8');
  assert.deepEqual(await session.save(makeDoc('Mine')), { canceled: true });
  assert.equal(await fs.readFile(target, 'utf8'), elsewhere);
  assert.equal((await session.save(makeDoc('Mine'))).saved, true);
  assert.match(await fs.readFile(target, 'utf8'), /"title": "Mine"/);
  assert.deepEqual(dialogs.asked, ['conflict', 'conflict']);
});

test('a conflict can be resolved with Save As', async t => {
  const { dir, files } = await filesIn(t);
  const target = path.join(dir, `groove${SCORE_EXTENSION}`);
  await files.save(target, makeDoc());
  const copy = path.join(dir, `copy${SCORE_EXTENSION}`);
  const session = new ScoreSession({ files, dialogs: scriptedDialogs({ conflict: ['saveAs'], save: [copy] }) });
  await session.open(target);
  await fs.rm(target);
  assert.equal((await session.save(makeDoc('Copy'))).saved, true);
  assert.equal(session.filePath, copy);
});

test('open reports cancel and errors without changing the current file', async t => {
  const { dir, files } = await filesIn(t);
  const target = path.join(dir, `groove${SCORE_EXTENSION}`);
  await files.save(target, makeDoc());
  const bad = path.join(dir, `bad${SCORE_EXTENSION}`);
  await fs.writeFile(bad, '{');
  const session = new ScoreSession({ files, dialogs: scriptedDialogs({ open: [null] }) });
  await session.open(target);
  assert.deepEqual(await session.open(), { canceled: true });
  assert.match((await session.open(bad)).error, /not valid JSON/);
  assert.equal(session.filePath, target);
  const opened = await session.open(target);
  assert.equal(opened.name, `groove${SCORE_EXTENSION}`);
  assert.deepEqual(opened.doc, makeDoc());
});

test('autosave writes a recovery copy only for unsaved changes and restore keeps the file link', async t => {
  const { dir, files } = await filesIn(t);
  const target = path.join(dir, `groove${SCORE_EXTENSION}`);
  await files.save(target, makeDoc());
  const session = new ScoreSession({ files, dialogs: scriptedDialogs({}) });
  await session.open(target);
  await session.autosave(makeDoc('Unsaved edit'), true);
  const [entry] = await files.listRecovery();
  assert.equal(entry.doc.title, 'Unsaved edit');
  assert.equal(entry.filePath, target);

  const restarted = new ScoreSession({ files, dialogs: scriptedDialogs({}) });
  const recovered = await restarted.takeRecovery();
  assert.equal(recovered.doc.title, 'Unsaved edit');
  assert.equal(recovered.name, `groove${SCORE_EXTENSION}`);
  assert.equal(restarted.filePath, target);
  assert.equal((await restarted.save(recovered.doc)).saved, true);  // no conflict: same disk hash

  await session.autosave(makeDoc('Back to saved'), false);
  assert.deepEqual(await files.listRecovery(), []);
  await assert.rejects(session.autosave({ ...makeDoc(), bars: [] }, true), /at least one bar/);
});

test('discarding clears the recovery copy and New forgets the file', async t => {
  const { dir, files } = await filesIn(t);
  const session = new ScoreSession({ files, dialogs: scriptedDialogs({ save: [path.join(dir, 'a')] }) });
  await session.save(makeDoc());
  await session.autosave(makeDoc('Changed'), true);
  await session.discard(makeDoc().scoreId);
  assert.deepEqual(await files.listRecovery(), []);
  session.newScore();
  assert.equal(session.filePath, null);
});

test('a failing recent-files update does not break open or re-link Save to the wrong file', async t => {
  const { dir, files } = await filesIn(t);
  const first = path.join(dir, `first${SCORE_EXTENSION}`);
  const second = path.join(dir, `second${SCORE_EXTENSION}`);
  await files.save(first, makeDoc('First'));
  await files.save(second, { ...makeDoc('Second'), scoreId: 'second' });
  const session = new ScoreSession({ files, dialogs: scriptedDialogs({}) });
  await session.open(first);
  files.addRecent = async () => { throw new Error('disk full'); };
  const opened = await session.open(second);
  assert.equal(opened.doc.title, 'Second');
  assert.equal(session.filePath, second);
  assert.equal((await session.save({ ...opened.doc, tempoBpm: 99 })).saved, true);
});

test('saving a different score never overwrites the linked file without Save As', async t => {
  const { dir, files } = await filesIn(t);
  const target = path.join(dir, `groove${SCORE_EXTENSION}`);
  await files.save(target, makeDoc());
  const before = await fs.readFile(target, 'utf8');
  const session = new ScoreSession({ files, dialogs: scriptedDialogs({ save: [null] }) });
  await session.open(target);
  assert.deepEqual(await session.save({ ...makeDoc('Other'), scoreId: 'someone-else' }), { canceled: true });
  assert.equal(await fs.readFile(target, 'utf8'), before);
});

test('concurrent save, autosave and open run one at a time', async t => {
  const { dir, files } = await filesIn(t);
  const target = path.join(dir, `groove${SCORE_EXTENSION}`);
  await files.save(target, makeDoc());
  const session = new ScoreSession({ files, dialogs: scriptedDialogs({}) });
  await session.open(target);
  const order = [];
  const slowSave = files.save.bind(files);
  files.save = async (...args) => { order.push('save:start'); await new Promise(r => setTimeout(r, 30)); const r = await slowSave(...args); order.push('save:end'); return r; };
  const slowRecovery = files.writeRecovery.bind(files);
  files.writeRecovery = async (...args) => { order.push('autosave'); return slowRecovery(...args); };
  await Promise.all([
    session.save({ ...makeDoc(), tempoBpm: 101 }),
    session.autosave({ ...makeDoc(), tempoBpm: 102 }, true),
  ]);
  assert.deepEqual(order, ['save:start', 'save:end', 'autosave']);
  const [entry] = await files.listRecovery();
  assert.equal(entry.diskHash, session.diskHash);
});
