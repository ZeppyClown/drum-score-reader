const { app, BrowserWindow, ipcMain, dialog, clipboard } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { OmrService } = require('./desktop/omr-service.cjs');
const { OpenAiOmr } = require('./desktop/openai-omr.cjs');
const { initScoreFiles } = require('./desktop/score-ipc.cjs');
const service = new OmrService({ root: __dirname });
const openai = new OpenAiOmr();
let importing = false;
let quitting = false;
let scoreFiles = null;

function trustedSender(event) {
  return event.senderFrame === event.sender.mainFrame &&
    event.senderFrame.url === pathToFileURL(path.join(__dirname, 'index.html')).href;
}

ipcMain.handle('omr:import', async event => {
  if (!trustedSender(event)) {
    return { error: 'Import is only available in the score editor.' };
  }
  if (importing) return { error: 'An import is already in progress.' };
  importing = true;
  try {
    const picked = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Import one 4/4 bar image', properties: ['openFile'],
      filters: [{ name: 'Bar images', extensions: ['png', 'jpg', 'jpeg'] }],
    });
    if (picked.canceled || !picked.filePaths.length) return { canceled: true };
    const prediction = await service.predict(picked.filePaths[0]);
    return { ...prediction, model: path.basename(service.bundle), filename: path.basename(picked.filePaths[0]) };
  } catch (error) { return { error: error.message }; }
  finally { importing = false; }
});

ipcMain.handle('ai:paste-image', async event => {
  if (!trustedSender(event)) return { error: 'AI import is only available in the score editor.' };
  if (importing) return { error: 'An import is already in progress.' };
  importing = true;
  try {
    const image = clipboard.readImage();
    if (image.isEmpty()) return { error: 'The clipboard does not contain an image. Copy a PNG screenshot and retry.' };
    return await openai.recognize(image.toPNG());
  } catch (error) { return { error: error.message }; }
  finally { importing = false; }
});

function createWindow() {
  const win = new BrowserWindow({ width: 1100, height: 700,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: true } });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  scoreFiles.attach(win);
}

app.whenReady().then(() => {
  scoreFiles = initScoreFiles({ trustedSender });
  createWindow();
  service.start().catch(error => console.error(error.message));
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  service.stop().finally(() => app.quit());
});
