// Electron wiring for score files: IPC handlers, the File/Edit menu, the
// unsaved-changes prompt on close, and crash recovery at startup. The renderer owns
// the score; main owns paths and the disk. Only a validated document crosses IPC.
const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('node:path');
const { ScoreFiles } = require('./score-files.cjs');
const { ScoreSession } = require('./score-session.cjs');

function electronDialogs(getWindow) {
  return {
    async chooseSavePath(defaultName) {
      const result = await dialog.showSaveDialog(getWindow(), {
        title: 'Save score', defaultPath: path.join(app.getPath('documents'), defaultName),
        filters: [{ name: 'DrumHub score', extensions: ['json'] }],
      });
      return result.canceled ? null : result.filePath;
    },
    async chooseOpenPath() {
      const result = await dialog.showOpenDialog(getWindow(), {
        title: 'Open score', properties: ['openFile'],
        filters: [{ name: 'DrumHub score', extensions: ['json'] }],
      });
      return result.canceled || !result.filePaths.length ? null : result.filePaths[0];
    },
    async confirmConflict(filePath, kind) {
      const name = path.basename(filePath);
      const { response } = await dialog.showMessageBox(getWindow(), {
        type: 'warning', buttons: ['Save As…', 'Replace', 'Cancel'], defaultId: 0, cancelId: 2,
        message: kind === 'missing' ? `“${name}” was moved or deleted since you opened it.`
          : `“${name}” was changed by another app since you opened it.`,
        detail: 'Replace overwrites the file with this score. Save As keeps both.',
      });
      return ['saveAs', 'overwrite', 'cancel'][response];
    },
  };
}

// trustedSender(event) → true only for the score editor page (see main.js).
function initScoreFiles({ trustedSender }) {
  let win = null;
  let status = { dirty: false, title: 'Untitled score', scoreId: null };
  let closeConfirmed = false;
  let closeAfterSave = false;  // set when the close prompt's Save is waiting on the page
  const files = new ScoreFiles({ dataDir: app.getPath('userData') });
  const session = new ScoreSession({ files, dialogs: electronDialogs(() => win) });
  const send = (name, arg) => win?.webContents.send('app:command', name, arg);

  const handle = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
    if (!trustedSender(event)) return { error: 'Score files are only available in the score editor.' };
    try { return await fn(...args); }
    catch (error) { return { error: error.message }; }
  });

  async function buildMenu() {
    const recent = await files.recent();
    const template = [
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { label: 'File', submenu: [
        { label: 'New Score', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { label: 'Open Recent', submenu: recent.length
          ? recent.map((filePath, index) => ({ label: path.basename(filePath), click: () => send('open-recent', index) }))
          : [{ label: 'No recent scores', enabled: false }] },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: 'Save As…', accelerator: 'Shift+CmdOrCtrl+S', click: () => send('save-as') },
        { type: 'separator' },
        { role: process.platform === 'darwin' ? 'close' : 'quit' },
      ] },
      { label: 'Edit', submenu: [
        { id: 'undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
        { id: 'redo', label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: () => send('redo') },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ] },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  handle('score:status', next => {
    status = {
      dirty: Boolean(next?.dirty),
      title: String(next?.title ?? 'Untitled score').slice(0, 200) || 'Untitled score',
      scoreId: typeof next?.scoreId === 'string' ? next.scoreId : null,
    };
    if (win && !win.isDestroyed()) {
      win.setTitle(`${status.dirty ? '• ' : ''}${status.title} — DrumHub`);
      win.setDocumentEdited(status.dirty);
      if (session.filePath) win.setRepresentedFilename(session.filePath);
    }
    return { name: session.name };
  });
  handle('score:save', async (doc, { saveAs = false } = {}) => {
    const closing = closeAfterSave;
    closeAfterSave = false;
    const result = await session.save(doc, { saveAs: Boolean(saveAs) });
    if (result.saved) { app.addRecentDocument(session.filePath); await buildMenu(); }
    // Only a save that main itself asked for, and that succeeded, may close the window.
    if (closing && result.saved) {
      closeConfirmed = true;
      setImmediate(() => win?.close());
    }
    return result;
  });
  handle('score:open', async ({ recentIndex } = {}) => {
    let filePath;
    if (Number.isInteger(recentIndex)) {
      filePath = (await files.recent())[recentIndex];
      if (!filePath) return { error: 'That recent score is no longer in the list.' };
    }
    const result = await session.open(filePath);
    if (result.doc) await buildMenu();
    return result;
  });
  handle('score:new', async () => { session.newScore(); return { ok: true }; });
  handle('score:autosave', async (doc, dirty) => { await session.autosave(doc, Boolean(dirty)); return { ok: true }; });
  // Asked before New/Open replaces unsaved work. "Don't Save" removes the recovery copy
  // here, after the person chose it, so the page cannot delete recovery data on its own.
  handle('score:confirm-discard', async (title, scoreId) => {
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Save', 'Don’t Save', 'Cancel'], defaultId: 0, cancelId: 2,
      message: `Do you want to save the changes to “${String(title).slice(0, 200)}”?`,
      detail: 'Your changes will be lost if you don’t save them.',
    });
    const choice = ['save', 'discard', 'cancel'][response];
    if (choice === 'discard' && typeof scoreId === 'string') await session.discard(scoreId);
    return { choice };
  });
  handle('score:recover', async () => {
    const entry = await session.takeRecovery();
    if (!entry) return { doc: null };
    const { response } = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Restore', 'Discard'], defaultId: 0, cancelId: 0,
      message: `DrumHub closed before “${entry.doc.title}” was saved.`,
      detail: `Restore the unsaved changes from ${new Date(entry.savedAt).toLocaleString()}?`,
    });
    if (response === 0) return entry;
    await session.discard(entry.doc.scoreId);
    session.newScore();
    return { doc: null };
  });

  function attach(window) {
    win = window;
    closeConfirmed = false;
    win.on('close', event => {
      if (closeConfirmed || !status.dirty) return;
      event.preventDefault();
      const response = dialog.showMessageBoxSync(win, {
        type: 'warning', buttons: ['Save', 'Don’t Save', 'Cancel'], defaultId: 0, cancelId: 2,
        message: `Do you want to save the changes to “${status.title}”?`,
        detail: 'Your changes will be lost if you don’t save them.',
      });
      if (response === 0) { closeAfterSave = true; send('save-and-close'); }
      if (response === 1) {
        const scoreId = status.scoreId;
        closeConfirmed = true;
        (scoreId ? session.discard(scoreId) : Promise.resolve()).catch(() => {}).finally(() => win?.close());
      }
    });
    win.on('closed', () => { if (win === window) win = null; });
    session.newScore();
    status = { dirty: false, title: 'Untitled score', scoreId: null };
  }

  buildMenu();
  return { attach, session, files };
}

module.exports = { initScoreFiles };
