// Electron wiring for page and PDF import: the file picker, cropping with nativeImage,
// progress events, and the cloud-help gate for GPT-5.6 Luna. The page only ever sends
// box positions; main reads the file, crops the pixels and calls the recognisers.
const { app, dialog, ipcMain, nativeImage, BrowserWindow } = require('electron');
const path = require('node:path');
const { PageImports } = require('./page-import.cjs');
const { ScoreFiles } = require('./score-files.cjs');

function cropPng(pagePng, { x, y, width, height }) {
  const image = nativeImage.createFromBuffer(pagePng);
  if (image.isEmpty()) throw new Error('The page image could not be read.');
  return image.crop({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }).toPNG();
}

function initPageImport({ trustedSender, service, openai, settings }) {
  const files = new ScoreFiles({ dataDir: app.getPath('userData') });
  const imports = new PageImports({
    dir: path.join(app.getPath('userData'), 'page-imports'),
    service, luna: openai, crop: async (png, box) => cropPng(png, box),
    cloudEnabled: () => settings.cloudEnabled,
    writeAtomic: (file, text) => files.writeAtomic(file, text),
  });

  const handle = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
    if (!trustedSender(event)) return { error: 'Page import is only available in the score editor.' };
    try { return await fn(event, ...args); }
    catch (error) { return { error: error.message }; }
  });
  const progress = event => update => { if (!event.sender.isDestroyed()) event.sender.send('page:progress', update); };

  handle('page:open', async event => {
    const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Import a page or PDF', properties: ['openFile'],
      filters: [{ name: 'Pages of drum notation', extensions: ['png', 'jpg', 'jpeg', 'pdf'] }],
    });
    if (picked.canceled || !picked.filePaths.length) return { canceled: true };
    return imports.open(picked.filePaths[0]);
  });
  handle('page:transcribe', (event, jobId, boxes, recognizer) => imports.transcribe(jobId, boxes, recognizer, progress(event)));
  handle('page:retry', (event, jobId, boxId) => imports.retry(jobId, boxId, progress(event)));
  handle('page:cancel', (_event, jobId) => ({ canceled: imports.cancel(jobId) }));
  handle('page:recoverable', () => imports.recoverable());
  handle('page:load', (_event, jobId) => imports.load(jobId));
  handle('page:discard', async (_event, jobId) => { await imports.discard(jobId); return { ok: true }; });
  return { imports };
}

module.exports = { initPageImport };
