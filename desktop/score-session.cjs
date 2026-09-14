// Which file the open score belongs to, and the Save / Save As / Open / recovery
// decisions around it. Dialogs are injected (Electron's in main.js, scripted ones in
// tests), so every branch is testable without a window.
//
// dialogs = {
//   chooseSavePath(defaultName) → path | null
//   chooseOpenPath()            → path | null
//   confirmConflict(filePath, 'changed' | 'missing') → 'overwrite' | 'saveAs' | 'cancel'
// }
const path = require('node:path');
const { SCORE_EXTENSION } = require('./score-files.cjs');
const { validateDocument } = require('../js/score-document.js');

const safeName = title => (title || 'Untitled score').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 100).trim() || 'Untitled score';
const withExtension = filePath => (filePath.endsWith(SCORE_EXTENSION) ? filePath
  : `${filePath.replace(/\.json$/i, '')}${SCORE_EXTENSION}`);

class ScoreSession {
  constructor({ files, dialogs }) {
    Object.assign(this, { files, dialogs, filePath: null, diskHash: null, scoreId: null });
    this.queue = Promise.resolve();
  }

  get name() { return this.filePath ? path.basename(this.filePath) : null; }

  // One file operation at a time, so an autosave, save and open can never interleave
  // and leave the linked file, its hash and the recovery copy out of step.
  serially(task) {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  link(filePath, diskHash, scoreId) {
    Object.assign(this, { filePath, diskHash, scoreId });
  }

  newScore() {
    this.link(null, null, null);
  }

  // Bookkeeping after the score itself is safely on disk: a failure here must not turn a
  // successful save or open into a reported error.
  async bestEffort(task) {
    try { await task(); } catch { /* recent list or recovery cleanup can be retried later */ }
  }

  save(doc, { saveAs = false } = {}) {
    return this.serially(() => this.saveNow(doc, saveAs));
  }

  async saveNow(doc, saveAs) {
    let target = this.filePath;
    let expectedHash;  // undefined: the save dialog already confirmed any replacement
    // A different score than the one linked to this file always goes through Save As.
    if (saveAs || !target || doc.scoreId !== this.scoreId) {
      const chosen = await this.dialogs.chooseSavePath(`${safeName(doc.title)}${SCORE_EXTENSION}`);
      if (!chosen) return { canceled: true };
      target = withExtension(chosen);
    } else {
      expectedHash = await this.files.diskHash(target);
      if (expectedHash !== this.diskHash) {
        const choice = await this.dialogs.confirmConflict(target, expectedHash === null ? 'missing' : 'changed');
        if (choice === 'saveAs') return this.saveNow(doc, true);
        if (choice !== 'overwrite') return { canceled: true };
      }
    }
    let hash;
    try {
      ({ hash } = await this.files.save(target, doc, { expectedHash }));
    } catch (error) {
      // Another app wrote the file during this save: ask again rather than overwrite it.
      if (error.code !== 'conflict') throw error;
      return this.saveNow(doc, saveAs);
    }
    this.link(target, hash, doc.scoreId);
    await this.bestEffort(() => this.files.clearRecovery(doc.scoreId));
    await this.bestEffort(() => this.files.addRecent(target));
    return { saved: true, name: this.name };
  }

  // Returns { doc, name }, { canceled }, or { error } — the current file stays linked on
  // cancel or error.
  open(filePath) {
    return this.serially(async () => {
      const chosen = filePath ?? await this.dialogs.chooseOpenPath();
      if (!chosen) return { canceled: true };
      let loaded;
      try { loaded = await this.files.load(chosen); }
      catch (error) { return { error: error.message }; }
      this.link(chosen, loaded.hash, loaded.doc.scoreId);
      await this.bestEffort(() => this.files.addRecent(chosen));
      return { doc: loaded.doc, name: this.name };
    });
  }

  // dirty=false means the editor is back to the saved content, so any recovery copy is stale.
  autosave(doc, dirty) {
    return this.serially(async () => {
      const errors = validateDocument(doc);
      if (errors.length) throw new Error(`Autosave skipped: ${errors[0]}`);
      if (!dirty) return this.files.clearRecovery(doc.scoreId);
      const linked = doc.scoreId === this.scoreId;
      return this.files.writeRecovery(doc, {
        filePath: linked ? this.filePath : null, diskHash: linked ? this.diskHash : null,
      });
    });
  }

  // Newest recovery copy, re-linked to its file so Save goes back to the same place.
  takeRecovery() {
    return this.serially(async () => {
      const [entry] = await this.files.listRecovery();
      if (!entry) return null;
      this.link(entry.filePath, entry.diskHash, entry.filePath ? entry.doc.scoreId : null);
      return { doc: entry.doc, savedAt: entry.savedAt, name: this.name };
    });
  }

  discard(scoreId) {
    return this.serially(() => this.files.clearRecovery(scoreId));
  }
}

module.exports = { ScoreSession };
