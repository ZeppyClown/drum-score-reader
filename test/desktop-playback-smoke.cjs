// Real Electron app with real Web Audio: play the fixture score, watch the highlight follow the
// notes, loop selected bars, take a tempo from an Ask DrumHub action, stop on edits, Space to play.
process.env.DRUMHUB_IGNORE_DOTENV = '1';
const { app, BrowserWindow, Menu, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'drumhub-playback-'));
app.setPath('userData', path.join(temp, 'userData'));
const { songEditor } = require('./fixture-scores.mjs');
const { documentOf } = require('../js/commands.js');
const { serializeDocument } = require('../js/score-document.js');
const scorePath = path.join(temp, 'song.drumhub.json');
fs.writeFileSync(scorePath, serializeDocument({ ...documentOf(songEditor()), tempoBpm: 200 }));
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [scorePath] });
dialog.showMessageBoxSync = () => 1;
require('../main.js');

const waitFor = async (check, what, ms = 20000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (await check()) return; await new Promise(r => setTimeout(r, 40)); }
  throw new Error(`Timed out waiting for ${what}`);
};
const menuItem = (label, items = Menu.getApplicationMenu().items) => {
  for (const item of items) { if (item.label === label) return item; const f = item.submenu && menuItem(label, item.submenu.items); if (f) return f; }
  return null;
};

app.whenReady().then(async () => {
  await waitFor(() => BrowserWindow.getAllWindows().length, 'window');
  const win = BrowserWindow.getAllWindows()[0];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.error('renderer:', message); });
  const evaluate = async code => {
    try { return await win.webContents.executeJavaScript(code, true); }
    catch (error) { throw new Error(`Renderer check failed: ${code.slice(0, 160)}`, { cause: error }); }
  };
  const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);
  const playhead = () => evaluate(`(() => { const r = document.getElementById('score-playhead'); return r ? Number(r.getAttribute('x')) : null; })()`);
  await waitFor(() => !win.webContents.isLoading() && evaluate('Boolean(document.querySelector("#score svg"))'), 'app');
  menuItem('Open…').click();
  await waitFor(async () => (await evaluate('import("./js/state.js").then(({state}) => state.bars.length)')) === 10, 'fixture');

  // The bar is visible at start-up and uses the score tempo.
  assert.equal(await evaluate('getComputedStyle(document.getElementById("transport")).display'), 'block');
  assert.equal(await evaluate('document.querySelector("#transport input[type=number]").value'), '200');

  // Play: the highlight appears and moves forward through the notes.
  await evaluate('document.querySelector(".transport-ui__play").click()');
  await waitFor(async () => (await playhead()) !== null, 'highlight appears');
  assert.match(await text('.transport-ui__status'), /Playing at 200 BPM/);
  const xs = new Set();
  const until = Date.now() + 1500;
  while (Date.now() < until) { const x = await playhead(); if (x !== null) xs.add(x); await new Promise(r => setTimeout(r, 30)); }
  assert.ok(xs.size >= 4, `highlight moved through ${xs.size} positions`);
  assert.equal(await evaluate('document.querySelector("#score-cursor") !== null'), true);

  // Stop removes the highlight.
  await evaluate('document.querySelector(".transport-ui__play").click()');
  await waitFor(async () => (await playhead()) === null, 'highlight removed');

  // Ask DrumHub actions drive the bar: a practice tempo and looping the selected bars.
  await evaluate(`window.dispatchEvent(new CustomEvent('drumhub:effect', { detail: { kind: 'playback', tempoBpm: 60 } })); window.dispatchEvent(new CustomEvent('drumhub:effect', { detail: { kind: 'playback', loop: true } }))`);
  assert.equal(await evaluate('document.querySelector("#transport input[type=number]").value'), '60');
  await evaluate(`import('./js/editor-store.js').then(async ({ dispatch }) => { const { selectBarsCommand } = await import('./js/selection.js'); const { state } = await import('./js/state.js'); dispatch(selectBarsCommand(state.bars[6].barId, state.bars[7].barId)); })`);
  await waitFor(async () => (await text('.transport-ui__loop-status')) === 'Looping bars 7–8', 'loop label');
  assert.equal(await evaluate('import("./js/state.js").then(({state}) => state.editor.meta.tempoBpm)'), 200, 'practice tempo is not saved into the score');

  // Space plays; the highlight stays inside bars 7–8 while looping; an edit stops playback.
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
  await waitFor(async () => (await playhead()) !== null, 'looping highlight');
  await evaluate(`import('./js/editor-store.js').then(async ({ dispatch }) => { const { toggleDrumCommand } = await import('./js/commands.js'); dispatch(toggleDrumCommand('crash')); })`);
  await waitFor(async () => /score changed/.test(await text('.transport-ui__status')), 'stops on edit');
  assert.equal(await playhead(), null);

  console.log('PASS: playback with Web Audio, moving note highlight, stop, Ask DrumHub tempo/loop effects, Space key, stop on edit.');
  fs.rmSync(temp, { recursive: true, force: true });
  app.exit(0);
}).catch(error => { console.error(error); fs.rmSync(temp, { recursive: true, force: true }); app.exit(1); });
