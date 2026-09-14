// Real Electron app: crash recovery, undo/redo menu, score details, save, open, New,
// future-version refusal, and the unsaved-changes prompt on close. Native dialogs are
// scripted and the app's data folder is a temporary directory.
const { app, BrowserWindow, Menu, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'drumhub-desktop-files-'));
app.setPath('userData', path.join(temp, 'userData'));
const scorePath = path.join(temp, 'My groove.drumhub.json');
const futurePath = path.join(temp, 'future.drumhub.json');

// A recovery copy left behind by a "crash" before this launch.
const { createMeta, withIds, toDocument, serializeDocument } = require('../js/score-document.js');
const crashed = toDocument(createMeta({ title: 'Recovered groove' }),
  withIds([{ notes: [{ duration: 'w', dotted: false, drums: ['crash'] }] }]));
fs.mkdirSync(path.join(temp, 'userData', 'recovery'), { recursive: true });
fs.writeFileSync(path.join(temp, 'userData', 'recovery', `${crashed.scoreId}.json`),
  JSON.stringify({ savedAt: Date.now(), filePath: null, diskHash: null, document: crashed }));
fs.writeFileSync(futurePath, JSON.stringify({ ...crashed, schemaVersion: 99 }));

const answers = { message: [], sync: [], save: [], open: [] };
const asked = [];
dialog.showMessageBox = async (_win, options) => {
  asked.push(options.message);
  const next = answers.message.shift();
  if (!next || !next.match.test(options.message)) throw new Error(`Unexpected dialog: ${options.message}`);
  return { response: next.response };
};
dialog.showMessageBoxSync = (_win, options) => {
  asked.push(options.message);
  return answers.sync.shift();
};
dialog.showSaveDialog = async () => ({ canceled: false, filePath: answers.save.shift() });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [answers.open.shift()] });
answers.message.push({ match: /closed before “Recovered groove” was saved/, response: 0 });

app.whenReady().then(() => {
  const { session } = require('electron');
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] },
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

function menuItem(label, items = Menu.getApplicationMenu().items) {
  for (const item of items) {
    if (item.label === label) return item;
    const found = item.submenu && menuItem(label, item.submenu.items);
    if (found) return found;
  }
  return null;
}
const click = label => menuItem(label).click();

app.whenReady().then(async () => {
  await waitFor(() => BrowserWindow.getAllWindows().length, 'window');
  const win = BrowserWindow.getAllWindows()[0];
  const evaluate = code => win.webContents.executeJavaScript(code);
  const editor = () => evaluate(`import("./js/state.js").then(({state}) => JSON.parse(JSON.stringify({
    meta: state.editor.meta, bars: state.editor.bars, past: state.editor.history.past.length })))`);
  const dirty = () => evaluate('Promise.all([import("./js/state.js"), import("./js/commands.js")]).then(([s, c]) => c.isDirty(s.state.editor))');
  const statusText = () => evaluate('document.getElementById("import-status").textContent');
  const press = keyCode => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    win.webContents.sendInputEvent({ type: 'char', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  };
  await waitFor(() => !win.webContents.isLoading(), 'page load');

  // 1. Crash recovery restores the unsaved score as unsaved.
  await waitFor(async () => (await editor()).meta.title === 'Recovered groove', 'recovered score');
  assert.equal(await dirty(), true);
  await waitFor(() => win.getTitle() === '• Recovered groove — DrumHub', 'dirty window title');
  assert.match(await statusText(), /Restored unsaved changes/);

  // 2. New Score with unsaved changes asks first; Don't Save discards the recovery copy.
  answers.message.push({ match: /save the changes to “Recovered groove”/, response: 1 });
  click('New Score');
  await waitFor(async () => (await editor()).meta.title === 'Untitled score', 'new score');
  await waitFor(() => fs.readdirSync(path.join(temp, 'userData', 'recovery')).length === 0, 'recovery cleared');
  assert.equal(await dirty(), false);

  // 3. Keys edit through commands; the menu undoes and redoes them.
  press('8');
  await waitFor(async () => (await editor()).bars[0].notes.length === 1, 'snare placed');
  press('0');
  await waitFor(async () => (await editor()).bars[0].notes[0].drums.length === 2, 'chord');
  const chord = await editor();
  assert.equal(chord.meta.revision, 2);
  assert.ok(chord.bars[0].barId && chord.bars[0].notes[0].eventId);
  click('Undo');
  await waitFor(async () => (await editor()).bars[0].notes[0].drums.length === 1, 'undo');
  click('Undo');
  await waitFor(async () => (await editor()).bars[0].notes.length === 0, 'undo to empty');
  assert.equal(await dirty(), false);
  click('Redo'); click('Redo');
  await waitFor(async () => JSON.stringify((await editor()).bars) === JSON.stringify(chord.bars), 'redo');
  assert.equal((await editor()).meta.revision, 6);

  // 4. Title and tempo are undoable details; invalid tempo is refused with a message.
  await evaluate(`(() => { const t = document.getElementById('score-title'); t.focus(); t.value = 'My groove';
    t.dispatchEvent(new Event('change')); })()`);
  await evaluate(`(() => { const t = document.getElementById('score-tempo'); t.value = '999';
    t.dispatchEvent(new Event('change')); })()`);
  assert.match(await evaluate('document.getElementById("details-error").textContent'), /Tempo must be/);
  assert.equal(await evaluate('document.getElementById("score-tempo").value'), '90');
  await evaluate(`(() => { const t = document.getElementById('score-tempo'); t.value = '120';
    t.dispatchEvent(new Event('change')); })()`);
  const detailed = await editor();
  assert.equal(detailed.meta.title, 'My groove');
  assert.equal(detailed.meta.tempoBpm, 120);
  await waitFor(() => win.getTitle() === '• My groove — DrumHub', 'title in window');

  // 5. Autosave writes a recovery copy for unsaved work.
  await waitFor(() => fs.readdirSync(path.join(temp, 'userData', 'recovery')).length === 1, 'autosave');

  // 6. Save asks for a path once, writes a valid file, and clears the recovery copy.
  answers.save.push(path.join(temp, 'My groove'));
  click('Save');
  await waitFor(async () => !(await dirty()), 'saved');
  const saved = JSON.parse(fs.readFileSync(scorePath, 'utf8'));
  assert.deepEqual(saved, JSON.parse(serializeDocument({ ...detailed.meta, bars: detailed.bars })));
  await waitFor(() => fs.readdirSync(path.join(temp, 'userData', 'recovery')).length === 0, 'recovery cleared after save');
  await waitFor(() => win.getTitle() === 'My groove — DrumHub', 'clean title');
  assert.ok(menuItem('My groove.drumhub.json'), 'Open Recent lists the saved score');

  // 7. A file from a newer DrumHub is refused and left unchanged.
  const futureText = fs.readFileSync(futurePath, 'utf8');
  answers.open.push(futurePath);
  click('Open…');
  await waitFor(async () => /Open failed: .*newer version/.test(await statusText()), 'future refusal');
  assert.equal(fs.readFileSync(futurePath, 'utf8'), futureText);
  assert.equal((await editor()).meta.title, 'My groove');

  // 7b. A 3/4 score opens view-only: shown as unsupported, keys and imports change nothing.
  const waltzPath = path.join(temp, 'waltz.drumhub.json');
  const waltz = { ...crashed, scoreId: 'waltz-score', title: 'Waltz', meter: { beats: 3, beatUnit: 4 },
    bars: [{ ...crashed.bars[0], notes: [{ ...crashed.bars[0].notes[0], duration: 'h', dotted: true }] }] };
  fs.writeFileSync(waltzPath, serializeDocument(waltz));
  answers.open.push(waltzPath);
  click('Open…');
  await waitFor(async () => (await editor()).meta.title === 'Waltz', 'waltz opened');
  assert.equal(await evaluate('document.getElementById("score-meter").textContent'), '3/4 · view only');
  assert.equal(await evaluate('document.getElementById("score-title").disabled'), true);
  press('8');
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal((await editor()).meta.revision, waltz.revision);
  assert.equal(await dirty(), false);
  assert.ok(await evaluate('document.querySelectorAll("#score .vf-stavenote").length === 1'), 'the 3/4 bar renders');

  // 8. New, then Open the saved file: the same score comes back, clean.
  click('New Score');
  await waitFor(async () => (await editor()).meta.title === 'Untitled score', 'second new score');
  answers.open.push(scorePath);
  click('Open…');
  await waitFor(async () => (await editor()).meta.title === 'My groove', 'opened');
  assert.deepEqual((await editor()).bars, saved.bars);
  assert.equal(await dirty(), false);
  assert.equal((await editor()).past, 0);

  // 9. Closing with unsaved changes: Cancel keeps the window; Save writes and closes.
  press('9');
  await waitFor(() => dirty(), 'dirty before close');
  answers.sync.push(2);
  win.close();
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(win.isDestroyed(), false);
  answers.sync.push(0);
  const closed = new Promise(resolve => win.once('closed', resolve));
  win.close();
  await closed;
  const final = JSON.parse(fs.readFileSync(scorePath, 'utf8'));
  assert.ok(final.bars[0].notes[0].drums.includes('ride'));
  assert.ok(final.revision > saved.revision);
  assert.deepEqual(answers, { message: [], sync: [], save: [], open: [] });

  console.log(`PASS: recovery, New/Open/Save, undo/redo menu, details, autosave, future-version refusal, view-only 3/4, close prompt (${asked.length} dialogs).`);
  fs.rmSync(temp, { recursive: true, force: true });
  app.quit();
}).catch(error => {
  console.error(error);
  fs.rmSync(temp, { recursive: true, force: true });
  app.exit(1);
});
