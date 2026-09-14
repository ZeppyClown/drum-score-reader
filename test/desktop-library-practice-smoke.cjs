// Real Electron app: exercise library (search, suggestions for bars, add + undo), Fill Lab (existing
// fills, cloud gate, a generated fill from a scripted OpenAI), an Ask DrumHub "open exercise" action, and
// the practice/teacher tab (student, session with a try, dashboard, offline teacher summary, delete).
process.env.DRUMHUB_IGNORE_DOTENV = '1';
process.env.OPENAI_API_KEY = 'sk-test-library-practice-000000';
const { app, BrowserWindow, Menu, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'drumhub-library-practice-'));
app.setPath('userData', path.join(temp, 'userData'));
const { songEditor } = require('./fixture-scores.mjs');
const { documentOf } = require('../js/commands.js');
const { serializeDocument } = require('../js/score-document.js');
const scorePath = path.join(temp, 'song.drumhub.json');
fs.writeFileSync(scorePath, serializeDocument(documentOf(songEditor())));

const generatedFill = { idea: 'Snare then toms down the kit.', notes: [
  ...['snare', 'snare', 'tom_hi', 'tom_hi', 'tom_mid', 'tom_mid', 'floor_tom_1', 'floor_tom_1'].map(drum => ({ duration: '8', dotted: false, triplet: false, drums: [drum] })),
] };
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(generatedFill) }] }] }) });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [scorePath] });
dialog.showMessageBox = async () => ({ response: 0 });
dialog.showMessageBoxSync = () => 1;
require('../main.js');

const waitFor = async (check, what, ms = 20000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (await check()) return; await new Promise(r => setTimeout(r, 50)); }
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
    catch (error) { throw new Error(`Renderer check failed: ${code.slice(0, 200)}`, { cause: error }); }
  };
  const within = selector => `document.querySelector(${JSON.stringify(selector)})`;
  const button = (selector, label) => evaluate(`(() => { const b = [...${within(selector)}.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(label)} && !x.closest('[hidden]')); if (!b) throw new Error('no button ${label}'); b.click(); return true; })()`);
  const text = selector => evaluate(`${within(selector)}?.textContent ?? ''`);
  const barCount = () => evaluate('import("./js/state.js").then(({state}) => state.bars.length)');
  await waitFor(() => !win.webContents.isLoading() && evaluate('Boolean(document.querySelector("#score svg"))'), 'app');
  menuItem('Open…').click();
  await waitFor(async () => (await barCount()) === 10, 'fixture');
  await evaluate('document.getElementById("panel-btn").click()');
  await evaluate('document.getElementById("tab-library").click()');

  // Library: search, then suggestions for bar 10 (triplets), add one exercise, undo.
  await evaluate(`(() => { const s = document.getElementById('library-ui-search'); s.value = 'triplet'; s.dispatchEvent(new Event('input')); })()`);
  await waitFor(async () => (await evaluate(`${within('#library-tab')}.querySelectorAll('.library-ui-card').length`)) > 0, 'search results');
  assert.match(await text('#library-tab .library-ui-results'), /[Tt]riplet/);
  await evaluate(`import('./js/editor-store.js').then(async ({ dispatch }) => { const { goToBarCommand } = await import('./js/commands.js'); dispatch(goToBarCommand(9)); })`);
  await button('#library-tab', 'Suggested for these bars');
  await waitFor(async () => /bar 10 uses triplets/.test(await text('#library-tab .library-ui-results')), 'suggestions cite bar 10');
  const firstTitle = await text('#library-tab .library-ui-card .library-ui-card-title');
  await evaluate(`${within('#library-tab .library-ui-card')}.querySelector('button:nth-of-type(2)').click()`);
  await waitFor(async () => (await barCount()) > 10, 'exercise added');
  assert.match(await text('#library-tab .library-ui-status'), new RegExp(`Added '${firstTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}' as bars? 11`));
  menuItem('Undo').click();
  await waitFor(async () => (await barCount()) === 10, 'undo removes the exercise');

  // Fill Lab: existing fills, the cloud gate, then a generated fill (scripted OpenAI) added to the score.
  await button('#library-tab', 'Fill Lab');
  await button('#library-tab', 'Find fills');
  await waitFor(async () => (await evaluate(`[...${within('#library-tab')}.querySelectorAll('section[aria-label="Fill Lab"] .library-ui-card')].length`)) > 0, 'fill results');
  assert.match(await text('#library-tab section[aria-label="Fill Lab"] .library-ui-results'), /tempo 100 BPM is inside its/);
  await button('#library-tab', 'Make a new fill (cloud)');
  await waitFor(async () => /adult needs to turn on cloud help/.test(await text('#library-tab .library-ui-status')), 'fill cloud gate');
  await evaluate(`import('./js/state.js').then(() => window.agent.setCloud(true))`);
  await button('#library-tab', 'Make a new fill (cloud)');
  await waitFor(async () => /ready to preview/.test(await text('#library-tab .library-ui-status')), 'generated fill');
  assert.match(await text('#library-tab .library-ui-generated'), /checked by DrumHub[\s\S]*Snare then toms/);
  await evaluate(`[...${within('#library-tab .library-ui-generated')}.querySelectorAll('button')].find(b => b.textContent === 'Add to score').click()`);
  await waitFor(async () => (await barCount()) === 11, 'generated fill added');
  const added = await evaluate('import("./js/state.js").then(({state}) => JSON.parse(JSON.stringify(state.bars[10])))');
  assert.deepEqual(added.notes.map(n => n.drums[0]), generatedFill.notes.map(n => n.drums[0]));
  assert.equal(added.provenance.source, 'manual');

  // An Ask DrumHub "open exercise" action shows that exercise in the Library tab.
  await evaluate(`window.dispatchEvent(new CustomEvent('drumhub:effect', { detail: { kind: 'exercise', exerciseId: 'sixteenth-hat-grid' } }))`);
  await waitFor(async () => (await evaluate('document.getElementById("tab-library").getAttribute("aria-selected")')) === 'true' &&
    /Sixteenth Hat Grid/.test(await text('#library-tab .library-ui-results')), 'exercise opened');

  // Practice: add a student, run a session with one try, see the dashboard and an offline teacher summary.
  await evaluate('document.getElementById("tab-practice").click()');
  await button('#practice-tab', 'Add student');
  await evaluate(`(() => { const f = ${within('#practice-tab form')}; const input = f.querySelector('input'); input.value = 'Kai'; f.requestSubmit(); })()`);
  await waitFor(async () => /Kai/.test(await evaluate(`[...${within('#practice-tab')}.querySelectorAll('select option')].map(o => o.textContent).join('|')`)), 'student added');
  await button('#practice-tab', 'Start');
  await waitFor(() => evaluate(`[...${within('#practice-tab')}.querySelectorAll('button')].some(b => b.textContent === 'Log a try' && !b.closest('[hidden]'))`), 'session started');
  await button('#practice-tab', 'Log a try');
  await new Promise(r => setTimeout(r, 300));
  await button('#practice-tab', 'End session');
  await waitFor(async () => /Sessions:\s*1/.test(await text('#practice-tab .practice-ui-metrics')), 'dashboard shows the session', 10000);
  await button('#practice-tab', 'Teacher summary');
  await waitFor(async () => /Kai practised/.test(await text('#practice-tab .practice-ui-summary')), 'offline teacher summary');
  assert.ok(fs.existsSync(path.join(temp, 'userData', 'practice.sqlite')), 'practice data saved on this computer');
  await button('#practice-tab', 'Delete student');
  await waitFor(async () => !/Kai/.test(await evaluate(`[...${within('#practice-tab')}.querySelectorAll('select option')].map(o => o.textContent).join('|')`)), 'student deleted');

  console.log('PASS: library search/suggestions/add/undo, Fill Lab gate + generated fill, open-exercise action, practice session, dashboard, teacher summary, delete.');
  fs.rmSync(temp, { recursive: true, force: true });
  app.exit(0);
}).catch(error => { console.error(error); fs.rmSync(temp, { recursive: true, force: true }); app.exit(1); });
