const { app, BrowserWindow, ipcMain, dialog, clipboard } = require('electron');
const path = require('path');
// OPENAI_API_KEY and model settings can live in a git-ignored .env next to this file.
// Real environment variables win. Tests set DRUMHUB_IGNORE_DOTENV so they never use a real key.
if (!process.env.DRUMHUB_IGNORE_DOTENV) require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const { pathToFileURL } = require('url');
const { OmrService } = require('./desktop/omr-service.cjs');
const { OpenAiOmr } = require('./desktop/openai-omr.cjs');
const { initScoreFiles } = require('./desktop/score-ipc.cjs');
const { initAgent } = require('./desktop/agent-ipc.cjs');
const { initPageImport } = require('./desktop/page-import-ipc.cjs');
const { initPractice } = require('./desktop/practice-ipc.cjs');
const { FillGenerator } = require('./desktop/fill-generator.cjs');
const { OpenAiClient } = require('./desktop/openai-client.cjs');
const service = new OmrService({ root: __dirname });
// One monthly cloud spending limit shared by every OpenAI request (desktop/cloud-budget.cjs).
const { CloudBudget } = require('./desktop/cloud-budget.cjs');
const budget = new CloudBudget({ file: path.join(app.getPath('userData'), 'cloud-budget.json') });
// Luna import progress and raw output go to the terminal that runs `npm start`.
const openai = new OpenAiOmr({ log: line => console.log(`[luna] ${line}`), budget });
let importing = false;
let quitting = false;
let scoreFiles = null;
let agentIpc = null;

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
    await agentIpc.ready;
    if (!agentIpc.settings.cloudEnabled) {
      return { code: 'cloud_required', error: 'Screenshot import sends the image to OpenAI, so an adult needs to turn on cloud help first. Import bar image… works offline.' };
    }
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
  agentIpc = initAgent({ trustedSender, budget });
  initPageImport({ trustedSender, service, openai, settings: agentIpc.settings });
  const { TeacherSummaries } = require('./desktop/teacher-summary.cjs');
  initPractice({ trustedSender, dataDir: app.getPath('userData'), settings: agentIpc.settings,
    summaries: new TeacherSummaries({ client: new OpenAiClient({ budget }), cloudAllowed: () => agentIpc.settings.cloudEnabled }) });
  // Fill Lab: a new fill from GPT-5.6 Luna, only with cloud help on, always checked by DrumHub.
  const fills = new FillGenerator({ client: new OpenAiClient({ budget }), cloudEnabled: () => agentIpc.settings.cloudEnabled });
  ipcMain.handle('fills:generate', async (event, request) => {
    if (!trustedSender(event)) return { error: 'Fill Lab is only available in the score editor.' };
    await agentIpc.ready;
    return fills.generate(request);
  });
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
