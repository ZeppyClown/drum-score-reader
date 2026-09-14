// Real Electron app: selecting bars, the Insights panel, citations, and out-of-date results.
process.env.DRUMHUB_IGNORE_DOTENV = '1';  // never use a real key from .env in tests
// Opens the hand-labelled fixture score from test/fixture-scores.mjs.
const { app, BrowserWindow, Menu, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'drumhub-desktop-insights-'));
app.setPath('userData', path.join(temp, 'userData'));
const { songEditor } = require('./fixture-scores.mjs');
const { documentOf } = require('../js/commands.js');
const { serializeDocument } = require('../js/score-document.js');
const scorePath = path.join(temp, 'song.drumhub.json');
fs.writeFileSync(scorePath, serializeDocument(documentOf(songEditor())));
const screenshot = process.env.DRUMHUB_SCREENSHOT;

dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [scorePath] });
dialog.showMessageBoxSync = () => 1;  // "Don't Save" when the test quits
app.whenReady().then(() => {
  require('electron').session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] },
    (_details, callback) => callback({ cancel: true }));
});
require('../main.js');

async function waitFor(check, what) {
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${what}`);
}
const menuItem = (label, items = Menu.getApplicationMenu().items) => {
  for (const item of items) {
    if (item.label === label) return item;
    const found = item.submenu && menuItem(label, item.submenu.items);
    if (found) return found;
  }
  return null;
};

app.whenReady().then(async () => {
  await waitFor(() => BrowserWindow.getAllWindows().length, 'window');
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1400, 900);
  const evaluate = code => win.webContents.executeJavaScript(code);
  const editor = () => evaluate(`import("./js/state.js").then(({state}) => JSON.parse(JSON.stringify({
    meta: state.editor.meta, cursor: state.editor.cursor, selection: state.editor.selection,
    barIds: state.editor.bars.map(b => b.barId) })))`);
  const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
  const press = keyCode => ['keyDown', 'char', 'keyUp'].forEach(type => win.webContents.sendInputEvent({ type, keyCode }));
  await waitFor(() => !win.webContents.isLoading(), 'page load');
  await waitFor(() => evaluate('Boolean(document.querySelector("#score svg"))'), 'score');

  menuItem('Open…').click();
  await waitFor(async () => (await editor()).barIds.length === 10, 'fixture opened');

  // Panel opens with offline cards computed for this revision.
  await evaluate('document.getElementById("panel-btn").click()');
  await waitFor(() => evaluate('document.querySelectorAll(".insight-card").length === 5'), 'cards');
  assert.match(await text('.insight-overview'), /10 bars of 4\/4 at 100 BPM — about 24 seconds/);
  assert.equal(await text('.insight-complex .cite'), 'bars 7–8');
  assert.match(await text('.insight-complex li'), /notation score 50\/100/);
  assert.match(await text('.insight-repeats'), /bars 1, 2, 3, 4 and 6/);
  assert.match(await text('.insight-fills li'), /^bar 8 might be a fill/);
  assert.match(await text('.insight-review li'), /^bar 10 imported and not checked/);
  assert.match(await text('#selection-label'), /No bars selected — questions use bar 1/);

  // A citation selects exactly bars 7–8 by id and draws them selected.
  await evaluate('document.querySelector(".insight-complex .cite").click()');
  const ids = (await editor()).barIds;
  await waitFor(async () => (await editor()).selection?.fromBarId === ids[6], 'citation selection');
  assert.deepEqual((await editor()).selection, { fromBarId: ids[6], toBarId: ids[7] });
  assert.equal((await editor()).cursor.barIndex, 6);
  assert.equal(await evaluate('document.querySelectorAll("#score .bar-selected").length'), 2);
  assert.equal(await text('#selection-label'), 'Selected: bars 7–8');
  const revision = (await editor()).meta.revision;

  // Clicking a bar on the score selects it; Shift-click extends.
  const clickBar = (index, shift) => evaluate(`(async () => {
    const { barAt } = await import('./js/score.js');
    const svg = document.querySelector('#score svg'); const box = svg.getBoundingClientRect();
    for (let y = 0; y < box.height; y += 4) for (let x = 0; x < box.width; x += 8) {
      if (barAt(x, y) === ${index}) {
        document.getElementById('score').dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: box.left + x + 20, clientY: box.top + y + 30, shiftKey: ${shift} }));
        return true;
      }
    }
    return false;
  })()`);
  assert.equal(await clickBar(2, false), true);
  await waitFor(async () => (await editor()).selection?.fromBarId === ids[2], 'click select');
  assert.equal(await clickBar(4, true), true);
  await waitFor(async () => (await editor()).selection?.toBarId === ids[4], 'shift-click extend');
  assert.equal(await text('#selection-label'), 'Selected: bars 3–5');
  assert.equal((await editor()).meta.revision, revision, 'selecting is not an edit');

  if (screenshot) fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());

  // Editing makes the cards out of date: citations stop working until Refresh.
  press('1');
  await waitFor(async () => (await editor()).meta.revision === revision + 1, 'edit');
  await waitFor(() => evaluate('document.getElementById("side-panel").classList.contains("stale")'), 'stale');
  assert.match(await text('#insights-status'), /score changed/);
  const staleClick = await evaluate(`(async () => {
    const ui = await import('./js/insights-ui.js'); const { state } = await import('./js/state.js');
    const { scoreSnapshot } = await import('./js/score-snapshot.js'); const { buildInsights } = await import('./js/insights.js');
    const old = { ...buildInsights(scoreSnapshot(state.editor)), revision: state.editor.meta.revision - 1 };
    let message = ''; const ok = ui.followCitation(old, old.cards[1].items[0].citation, m => { message = m; });
    return { ok, message };
  })()`);
  assert.deepEqual(staleClick, { ok: false, message: 'The score has changed since this was worked out. Refresh to see up-to-date results.' });
  await evaluate('document.getElementById("insights-refresh").click()');
  await waitFor(() => evaluate('!document.getElementById("side-panel").classList.contains("stale")'), 'refreshed');

  console.log('PASS: insights panel, citations select bars by id, click/shift-click selection, stale results after edits.');
  fs.rmSync(temp, { recursive: true, force: true });
  app.quit();
}).catch(error => {
  console.error(error);
  fs.rmSync(temp, { recursive: true, force: true });
  app.exit(1);
});
