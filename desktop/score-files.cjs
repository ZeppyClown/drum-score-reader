// Score files on disk: atomic save, validated load, recovery copies, recent files.
// Runs only in Electron main; the renderer never gets filesystem access. Documents
// are validated with the same rules as the editor (js/score-document.js).
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseDocument, serializeDocument, DocumentError } = require('../js/score-document.js');

const SCORE_EXTENSION = '.drumhub.json';
const MAX_SCORE_BYTES = 20 * 1024 * 1024;
const RECENT_LIMIT = 10;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// Flush the folder entry so a power cut right after the rename keeps the new file.
// Not every platform can open a directory for syncing (Windows); there the rename alone stands.
async function syncDirectory(dir) {
  let handle;
  try { handle = await fs.open(dir, 'r'); await handle.sync(); }
  catch { /* unsupported here */ }
  finally { await handle?.close().catch(() => {}); }
}

const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');

class ScoreFiles {
  // dataDir: app.getPath('userData'). fault(step) is a test hook that can throw to
  // simulate a crash at 'write', 'sync', or 'rename'.
  constructor({ dataDir, fault = () => {}, now = Date.now, maxBytes = MAX_SCORE_BYTES }) {
    Object.assign(this, { fault, now, maxBytes });
    this.recoveryDir = path.join(dataDir, 'recovery');
    this.recentFile = path.join(dataDir, 'recent-scores.json');
  }

  // Write to a temporary file in the same folder, flush it to disk, then rename it over
  // the target. A crash at any point leaves either the old file or the new one, never
  // a half-written score.
  async writeAtomic(filePath, text) {
    const temp = path.join(path.dirname(filePath),
      `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
    let handle;
    try {
      handle = await fs.open(temp, 'wx');
      this.fault('write');
      await handle.writeFile(text, 'utf8');
      this.fault('sync');
      await handle.sync();
      await handle.close();
      handle = null;
      this.fault('rename');
      await fs.rename(temp, filePath);
    } catch (error) {
      await handle?.close().catch(() => {});
      await fs.rm(temp, { force: true });
      throw error;
    }
    await syncDirectory(path.dirname(filePath));
  }

  async save(filePath, doc) {
    const text = serializeDocument(doc);  // throws before anything is written
    await this.writeAtomic(filePath, text);
    return { hash: sha256(text) };
  }

  async readText(filePath) {
    let stat;
    try { stat = await fs.stat(filePath); }
    catch (error) {
      if (error.code === 'ENOENT') throw new DocumentError(`${path.basename(filePath)} could not be found.`, 'unreadable');
      throw error;
    }
    if (!stat.isFile()) throw new DocumentError('Choose a DrumHub score file.', 'unreadable');
    if (stat.size > this.maxBytes) throw new DocumentError('This file is too large to be a DrumHub score.', 'unreadable');
    return fs.readFile(filePath, 'utf8');
  }

  async load(filePath) {
    const text = await this.readText(filePath);
    return { doc: parseDocument(text), hash: sha256(text) };
  }

  // Hash of the file as it is now, or null when it no longer exists.
  async diskHash(filePath) {
    try { return sha256(await fs.readFile(filePath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  recoveryPath(scoreId) {
    if (!ID_PATTERN.test(String(scoreId))) throw new Error('Invalid score id');
    return path.join(this.recoveryDir, `${scoreId}.json`);
  }

  // A recovery copy never replaces the user's own file; it lives in the app's data
  // folder and remembers which file (and which version of it) it belongs to.
  async writeRecovery(doc, { filePath = null, diskHash = null } = {}) {
    const entry = { savedAt: this.now(), filePath, diskHash, document: JSON.parse(serializeDocument(doc)) };
    await fs.mkdir(this.recoveryDir, { recursive: true });
    await this.writeAtomic(this.recoveryPath(doc.scoreId), `${JSON.stringify(entry)}\n`);
  }

  async clearRecovery(scoreId) {
    await fs.rm(this.recoveryPath(scoreId), { force: true });
  }

  // Valid recovery copies, newest first. Unreadable or newer-format copies are left on
  // disk untouched so a later DrumHub can still recover them.
  async listRecovery() {
    let names;
    try { names = await fs.readdir(this.recoveryDir); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const entries = [];
    for (const name of names.filter(n => n.endsWith('.json'))) {
      try {
        const raw = JSON.parse(await this.readText(path.join(this.recoveryDir, name)));
        const doc = parseDocument(JSON.stringify(raw.document));
        if (!Number.isFinite(raw.savedAt)) continue;
        entries.push({ doc, savedAt: raw.savedAt,
          filePath: typeof raw.filePath === 'string' ? raw.filePath : null,
          diskHash: typeof raw.diskHash === 'string' ? raw.diskHash : null });
      } catch { /* skipped: not a usable recovery copy */ }
    }
    return entries.sort((a, b) => b.savedAt - a.savedAt);
  }

  async recent() {
    try {
      const list = JSON.parse(await fs.readFile(this.recentFile, 'utf8'));
      return Array.isArray(list) ? list.filter(p => typeof p === 'string').slice(0, RECENT_LIMIT) : [];
    } catch { return []; }
  }

  async addRecent(filePath) {
    const list = [filePath, ...(await this.recent()).filter(p => p !== filePath)].slice(0, RECENT_LIMIT);
    await fs.mkdir(path.dirname(this.recentFile), { recursive: true });
    await this.writeAtomic(this.recentFile, `${JSON.stringify(list, null, 2)}\n`);
    return list;
  }
}

module.exports = { ScoreFiles, SCORE_EXTENSION, MAX_SCORE_BYTES };
