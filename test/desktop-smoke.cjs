// Real Electron renderer + IPC + released Python model. Only the native picker is automated.
const { app, BrowserWindow, dialog, session, clipboard, nativeImage } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const { OmrService } = require('../desktop/omr-service.cjs');
const { OpenAiOmr } = require('../desktop/openai-omr.cjs');
const fs = require('node:fs');
const os = require('node:os');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'drumhub-desktop-smoke-'));
app.setPath('userData', userData);
// The imports leave unsaved changes, so quitting asks to save: answer "Don't Save".
const prompts = [];
dialog.showMessageBoxSync = (_win, options) => { prompts.push(options.message); return 1; };
process.on('exit', () => fs.rmSync(userData, { recursive: true, force: true }));
let selection;
dialog.showOpenDialog = async () => selection;
const external = [];
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    external.push(details.url); callback({ cancel: true });
  });
});
require('../main.js');

async function waitFor(check) {
  const until = Date.now() + 45000;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Desktop check timed out');
}

app.whenReady().then(async () => {
  await waitFor(() => BrowserWindow.getAllWindows().length);
  const win = BrowserWindow.getAllWindows()[0];
  const evaluate = async code => {
    try { return await win.webContents.executeJavaScript(code); }
    catch (error) { throw new Error(`Renderer check failed: ${code}`, { cause: error }); }
  };
  await waitFor(async () => !win.webContents.isLoading() && await evaluate('Boolean(document.querySelector("#score svg"))'));
  const images = path.resolve(__dirname, '../ml/data/training/dataset/images');
  const image = '21 Guns Drum Tab by Green Day _ Songsterr Tabs with Rhythm_bar003.png';
  const state = () => evaluate('import("./js/state.js").then(({state}) => JSON.parse(JSON.stringify(state)))');
  const clickImport = async () => {
    await evaluate('document.getElementById("import-btn").click()');
    await waitFor(() => evaluate('!document.getElementById("import-btn").disabled'));
    return evaluate('document.getElementById("import-status").textContent');
  };
  selection = { canceled: false, filePaths: [path.join(images, image)] };
  assert.match(await clickImport(), /Imported .* as bar 1/);
  const initial = await state();
  assert.ok(initial.bars[0].notes.some(note => note.drums.length));
  assert.ok(await evaluate('document.querySelectorAll("#score .vf-stavenote").length > 0'));
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: '8' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: '8' });
  await waitFor(async () => JSON.stringify((await state()).bars) !== JSON.stringify(initial.bars));
  const edited = await state();
  await evaluate(`document.querySelector('#keypad [data-key="0"]').click()`);
  assert.notDeepEqual((await state()).bars, edited.bars);
  const preserved = (await state()).bars[0];
  assert.match(await clickImport(), /as bar 2/);
  assert.deepEqual((await state()).bars[0], preserved);
  const beforeCancel = await state();
  selection = { canceled: true, filePaths: [] };
  assert.match(await clickImport(), /canceled/);
  assert.deepEqual(await state(), beforeCancel);
  selection = { canceled: false, filePaths: [path.resolve(__dirname, '../package.json')] };
  assert.match(await clickImport(), /Import failed:.*PNG or JPEG/);
  assert.deepEqual(await state(), beforeCancel);
  selection = { canceled: false, filePaths: [path.join(images,
    '21 Guns Drum Tab by Green Day _ Songsterr Tabs with Rhythm_bar001.png')] };
  assert.match(await clickImport(), /as bar 3/);
  assert.match(await evaluate('document.getElementById("import-warnings").textContent'), /No drum hits/);
  const beforeInvalid = await state();
  const predict = OmrService.prototype.predict;
  try {
    OmrService.prototype.predict = async () => ({ notes: [{ position: -1 }], gridSlots: 32 });
    assert.match(await clickImport(), /Import failed:.*invalid position/);
    assert.deepEqual(await state(), beforeInvalid);
    OmrService.prototype.predict = async () => ({ notes: [
      { position: 0, duration: 'half', drums: ['kick'] },
      { position: 4, duration: 'eighth', drums: ['snare'] },
    ], gridSlots: 32 });
    assert.match(await clickImport(), /as bar 4/);
    assert.match(await evaluate('document.getElementById("import-warnings").textContent'), /shortened/);
  } finally { OmrService.prototype.predict = predict; }
  const openaiResult = {
    schemaVersion: 1, gridSlots: 32, status: 'ok', message: '', model: 'gpt-5.6-luna',
    notes: [
      { position: 0, duration: 'eighth', drums: ['kick', 'hi_hat_closed'] },
      { position: 8, duration: 'eighth', drums: ['snare', 'hi_hat_closed'] },
    ],
    uncertainties: [{ position: 8, reason: 'The snare notehead is faint.' }],
  };
  const recognize = OpenAiOmr.prototype.recognize;
  OpenAiOmr.prototype.recognize = async png => {
    assert.ok(Buffer.isBuffer(png)); assert.ok(png.length > 0); return openaiResult;
  };
  clipboard.writeImage(nativeImage.createFromPath(path.join(images, image)));
  await evaluate('document.getElementById("ai-import-btn").click()');
  await waitFor(() => evaluate('!document.getElementById("ai-import-btn").disabled'));
  assert.match(await evaluate('document.getElementById("import-status").textContent'), /gpt-5.6-luna screenshot as bar 5/);
  assert.match(await evaluate('document.getElementById("import-warnings").textContent'), /Luna flagged position 8/);
  const beforeEmptyClipboard = await state();
  clipboard.clear();
  await evaluate('document.body.dispatchEvent(new Event("paste", {bubbles:true,cancelable:true}))');
  await waitFor(() => evaluate('!document.getElementById("ai-import-btn").disabled'));
  assert.match(await evaluate('document.getElementById("import-status").textContent'), /clipboard does not contain an image/);
  assert.deepEqual(await state(), beforeEmptyClipboard);
  OpenAiOmr.prototype.recognize = recognize;
  assert.equal(await evaluate('typeof window.require'), 'undefined');
  assert.deepEqual(external, []);
  const closed = new Promise(resolve => win.once('closed', resolve));
  app.quit();
  await closed;
  assert.deepEqual(prompts, ['Do you want to save the changes to “Untitled score”?']);
  console.log('PASS: local and Luna clipboard-image import, SVG rendering, editing, append preservation, cancellation, errors, isolated preload, unsaved-changes prompt on quit.');
}).catch(error => { console.error(error); app.once('will-quit', () => app.exit(1)); app.quit(); });
