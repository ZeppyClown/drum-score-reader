// Real Electron app + real Python service + released local model: import a real Songsterr page,
// edit the suggested boxes with the mouse and keyboard, read (one bar forced to fail), retry, add the bars
// in reading order, and resume an unfinished import after a reload.
process.env.DRUMHUB_IGNORE_DOTENV = '1';
const { app, BrowserWindow, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { OmrService } = require('../desktop/omr-service.cjs');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'drumhub-page-import-'));
app.setPath('userData', path.join(temp, 'userData'));
const root = path.resolve(__dirname, '..');
const pdf = fs.readdirSync(path.join(root, 'ml/data/songsterr/pdf')).find(name => name.startsWith('Basket Case'));
const pagePng = path.join(temp, 'basket-case-page-2.png');
const rendered = spawnSync('python3', ['-c', `
import fitz, sys
page = fitz.open(sys.argv[1])[1]
page.get_pixmap(matrix=fitz.Matrix(2, 2)).save(sys.argv[2])`, path.join(root, 'ml/data/songsterr/pdf', pdf), pagePng]);
if (rendered.status !== 0) throw new Error(`Could not render the test page: ${rendered.stderr}`);

dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pagePng] });
dialog.showMessageBoxSync = () => 1;
let failNext = 0;
const realPredictData = OmrService.prototype.predictData;
OmrService.prototype.predictData = async function (...args) {
  if (failNext > 0) { failNext -= 1; throw new Error('Simulated recognition failure'); }
  return realPredictData.apply(this, args);
};
require('../main.js');

async function waitFor(check, what, ms = 120000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

app.whenReady().then(async () => {
  await waitFor(() => BrowserWindow.getAllWindows().length, 'window');
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1400, 1000);
  const evaluate = code => win.webContents.executeJavaScript(code);
  const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);
  const boxCount = () => evaluate('document.querySelectorAll("#page-pages .page-box:not(.page-box-preview)").length');
  const editor = () => evaluate('import("./js/state.js").then(({state}) => JSON.parse(JSON.stringify({ bars: state.editor.bars, cursor: state.editor.cursor })))');
  await waitFor(() => !win.webContents.isLoading() && evaluate('Boolean(document.querySelector("#score svg"))'), 'app');

  // 1. Open the page: boxes are suggested and numbered in reading order.
  await evaluate('document.getElementById("page-import-btn").click()');
  await waitFor(() => evaluate('!document.getElementById("page-import").hidden'), 'review screen');
  const found = await boxCount();
  assert.ok(found >= 20, `found ${found} bars`);
  assert.match(await text('#page-status'), new RegExp(`Found ${found} bars`));
  const numbers = await evaluate('[...document.querySelectorAll(".page-box-num")].map(n => Number(n.textContent))');
  assert.deepEqual(numbers, numbers.map((_, i) => i + 1));
  const firstBoxBefore = await evaluate('parseFloat(document.querySelector(".page-box").style.left)');
  await evaluate('(() => { const box = document.querySelector(".page-box"); box.focus(); box.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); })()');
  const firstBoxAfter = await evaluate('parseFloat(document.querySelector(".page-box").style.left)');
  assert.notEqual(firstBoxAfter, firstBoxBefore, 'ArrowRight moves a focused box');
  await evaluate('document.querySelector(".page-box").dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }))');
  await waitFor(async () => (await boxCount()) === found - 1, 'keyboard box deletion');
  await evaluate('document.getElementById("page-add-box").click()');
  await waitFor(async () => (await boxCount()) === found, 'box added from keyboard-editing controls');

  // 2. Remove the last box, then draw it back with real mouse input.
  await evaluate(`[...document.querySelectorAll('.page-box')].at(-1).scrollIntoView({ block: 'center' })`);
  await new Promise(resolve => setTimeout(resolve, 200));
  const last = await evaluate(`(() => { const boxes = [...document.querySelectorAll('.page-box')]; const r = boxes.at(-1).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  await evaluate(`[...document.querySelectorAll('.page-box-remove')].at(-1).click()`);
  await waitFor(async () => (await boxCount()) === found - 1, 'box removed');
  win.focus();
  win.webContents.focus();
  const mouse = (type, x, y) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1,
    modifiers: type === 'mouseDown' ? [] : ['leftButtonDown'] });
  // Start inside the gap left by the removed box, clear of the neighbour's × button.
  mouse('mouseDown', last.x + 16, last.y + 16);
  for (let step = 1; step <= 5; step++) {
    await new Promise(resolve => setTimeout(resolve, 30));
    mouse('mouseMove', last.x + 16 + (last.w - 19) * step / 5, last.y + 16 + (last.h - 19) * step / 5);
  }
  await new Promise(resolve => setTimeout(resolve, 30));
  mouse('mouseUp', last.x + last.w - 3, last.y + last.h - 3);
  await waitFor(async () => (await boxCount()) === found, 'box drawn', 5000);
  assert.equal(await evaluate(`[...document.querySelectorAll('.page-box')].at(-1).dataset.boxId`), 'drawn-2');
  assert.equal(await evaluate(`[...document.querySelectorAll('.page-box-num')].at(-1).textContent`), String(found));

  // 3. Read with the local model; the second bar fails, the rest are kept.
  failNext = 0;
  let calls = 0;
  OmrService.prototype.predictData = async function (...args) {
    calls += 1;
    if (calls === 2) throw new Error('Simulated recognition failure');
    return realPredictData.apply(this, args);
  };
  await evaluate('document.getElementById("page-transcribe").click()');
  await waitFor(async () => /bars read/.test(await text('#page-status')) && !(await evaluate('document.getElementById("page-transcribe").hidden')), 'transcription', 300000);
  assert.match(await text('#page-status'), new RegExp(`${found - 1} of ${found} bars read\\. 1 could not be read: retry it or add an empty bar`));
  assert.equal(await text('#page-transcribe'), 'Read 1 remaining bar');
  assert.equal(await evaluate('document.querySelectorAll(".page-box-failed").length'), 1);
  assert.equal(await evaluate('document.querySelectorAll(".page-box-done").length'), found - 1);

  if (process.env.DRUMHUB_SCREENSHOT) fs.writeFileSync(process.env.DRUMHUB_SCREENSHOT, (await win.webContents.capturePage()).toPNG());

  // 4. Retry just that bar.
  await evaluate('document.querySelector(".page-box-retry").click()');
  await waitFor(() => evaluate('document.querySelectorAll(".page-box-done").length === ' + found), 'retry', 60000);
  assert.equal(calls, found + 1, 'only the failed bar ran again');

  // 5. Add every bar to the score, in reading order, as unchecked local-model bars.
  await evaluate('document.getElementById("page-add").click()');
  await waitFor(() => evaluate('document.getElementById("page-import").hidden'), 'screen closed');
  assert.equal(await evaluate('document.activeElement?.id'), 'menu-btn', 'focus returns to the menu button that holds the import');
  const score = await editor();
  assert.equal(score.bars.length, found);
  assert.ok(score.bars.every(bar => bar.provenance.source === 'local_omr' && bar.provenance.reviewed === false));
  assert.ok(score.bars.some(bar => bar.notes.some(note => note.drums.length)), 'the model read real notes');
  assert.match(await text('#import-status'), new RegExp(`Added ${found} bars from basket-case-page-2.png as bars 1–${found}`));
  assert.equal(fs.readdirSync(path.join(temp, 'userData', 'page-imports')).length, 0, 'finished job removed');

  // 6. An import that was opened but not added is offered again after a reload.
  await evaluate('document.getElementById("page-import-btn").click()');
  await waitFor(() => evaluate('!document.getElementById("page-import").hidden'), 'second review screen');
  await evaluate('document.getElementById("page-close").click()');
  win.webContents.reload();
  await waitFor(async () => /unfinished page import is waiting: basket-case-page-2\.png \(0 of \d+ bars read\)/.test(await text('#import-status')), 'resume offer');
  await evaluate('document.getElementById("page-resume").click()');
  await waitFor(async () => !(await evaluate('document.getElementById("page-import").hidden')) && (await boxCount()) === found, 'resumed');

  console.log(`PASS: page import found ${found} bars on a real Songsterr page, box editing, local transcription with a failure, retry, reading-order add, resume.`);
  fs.rmSync(temp, { recursive: true, force: true });
  app.exit(0);
}).catch(error => {
  console.error(error);
  fs.rmSync(temp, { recursive: true, force: true });
  app.exit(1);
});
