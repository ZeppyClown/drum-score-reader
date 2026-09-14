// Real Electron app: the Ask DrumHub tab. OpenAI is replaced by a scripted fetch in main,
process.env.DRUMHUB_IGNORE_DOTENV = '1';  // never use a real key from .env in tests
// so this checks the whole path (page → preload → main → agent → tools → checks → page)
// without a network. Opens the hand-labelled fixture score.
const { app, BrowserWindow, Menu, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'drumhub-desktop-agent-'));
app.setPath('userData', path.join(temp, 'userData'));
process.env.OPENAI_API_KEY = 'sk-test-desktop-agent-000000';
process.env.OPENAI_AGENT_MODEL = 'gpt-5.6-luna';
const { songEditor } = require('./fixture-scores.mjs');
const { documentOf } = require('../js/commands.js');
const { serializeDocument } = require('../js/score-document.js');
const scorePath = path.join(temp, 'song.drumhub.json');
fs.writeFileSync(scorePath, serializeDocument(documentOf(songEditor())));

// Scripted OpenAI Responses API.
const requests = [];
const script = [];
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  requests.push({ url, body, authorization: init.headers.authorization });
  const next = script.shift();
  if (!next) throw new Error('Unexpected OpenAI request');
  const output = await next(init.signal);
  return { ok: true, status: 200, json: async () => ({ status: 'completed', output, usage: { input_tokens: 900, output_tokens: 80 } }) };
};
const toolCall = (name, args) => async () => [{ type: 'function_call', id: `fc_${name}`, call_id: `call_${name}`, name, arguments: JSON.stringify(args) }];
const reply = answer => async () => [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }];

const dialogs = [];
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [scorePath] });
dialog.showMessageBox = async (_win, options) => { dialogs.push(options.message); return { response: 0 }; };
dialog.showMessageBoxSync = () => 1;
app.whenReady().then(() => {
  require('electron').session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] },
    (_details, callback) => callback({ cancel: true }));
});
require('../main.js');

async function waitFor(check, what, ms = 20000) {
  const until = Date.now() + ms;
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
  const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const editor = () => evaluate(`import("./js/state.js").then(({state}) => JSON.parse(JSON.stringify({
    revision: state.editor.meta.revision, selection: state.editor.selection, barIds: state.editor.bars.map(b => b.barId) })))`);
  const suggestion = label => evaluate(`[...document.querySelectorAll('#ask-suggestions button')].find(b => b.textContent === ${JSON.stringify(label)}).click()`);
  await waitFor(() => !win.webContents.isLoading(), 'page load');
  await waitFor(() => evaluate('Boolean(document.querySelector("#score svg"))'), 'score');
  menuItem('Open…').click();
  await waitFor(async () => (await editor()).barIds.length === 10, 'fixture opened');
  await click('#panel-btn');
  await click('#tab-ask');

  // 1. Offline by default: typed questions are disabled; suggested questions answer locally.
  await waitFor(async () => /Offline answers/.test(await text('#ask-mode-text')), 'offline mode');
  assert.equal(await evaluate('document.getElementById("ask-input").disabled'), true);
  await suggestion('Find the most complex part');
  await waitFor(async () => /busiest notation is in bars 7–8/.test(await text('#ask-text') ?? ''), 'offline answer');
  assert.equal(await text('#ask-meta'), 'Offline answer, worked out on this computer.');
  assert.equal(requests.length, 0, 'offline answers send nothing');
  await click('#ask-references .cite');
  const ids = (await editor()).barIds;
  await waitFor(async () => (await editor()).selection?.toBarId === ids[7], 'reference selects bars');

  // 2. Unchecked imported bars are disclosed.
  await evaluate(`import('./js/editor-store.js').then(async ({ dispatch }) => { const { selectBarsCommand } = await import('./js/selection.js');
    const { state } = await import('./js/state.js'); dispatch(selectBarsCommand(state.bars[9].barId)); })`);
  await suggestion('How do I count it?');
  await waitFor(async () => /Bar 10: 1 trip let \(2\) 3 4 &/.test(await text('#ask-text') ?? ''), 'count answer');
  assert.match(await text('#ask-caveats'), /Bar 10 was imported and not checked yet/);

  // 3. Luna screenshot import is refused while cloud help is off, with a button to turn it on.
  require('electron').clipboard.clear();
  await click('#ai-import-btn');
  await waitFor(async () => /needs cloud help.*adult needs to turn on cloud help/.test(await text('#import-status')), 'luna gated');

  // 4. An adult turns it on from the import message (confirmation dialog); the paste is retried,
  //    the Ask tab updates, and the setting is remembered.
  await click('#import-cloud-btn');
  await waitFor(async () => /clipboard does not contain an image/.test(await text('#import-status')), 'paste retried after opt-in');
  await waitFor(async () => /Cloud help is on \(adult mode\)/.test(await text('#ask-mode-text')), 'cloud mode');
  assert.match(dialogs.at(-1), /For teachers and parents only/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(temp, 'userData', 'settings.json'), 'utf8')).cloudAssist.enabled, true);

  // 5. A typed question: tool call, local facts, checked answer with a working reference.
  script.push(toolCall('find_complex_passages', { top: null }), reply({
    answer: 'The busiest notes are in bars 7–8, with sixteenth notes all the way through.', abstained: false,
    references: [{ fromBar: 7, toBar: 8, label: 'bars 7–8' }], suggestedQuestions: ['How do I count it?'], caveats: [],
  }));
  await evaluate(`(() => { const box = document.getElementById('ask-input'); box.value = 'Where is the busiest part?';
    document.getElementById('ask-scope').value = 'score'; document.getElementById('ask-form').requestSubmit(); })()`);
  await waitFor(async () => /sixteenth notes all the way through/.test(await text('#ask-text') ?? ''), 'cloud answer');
  assert.equal(await text('#ask-meta'), "Answered by gpt-5.6-luna using DrumHub's own score facts.");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(requests[0].body.store, false);
  const sent = JSON.stringify(requests.map(r => r.body));
  assert.equal(sent.includes('Ignore previous instructions'), false, 'title never sent');
  assert.equal(sent.includes('sk-test-desktop-agent'), false, 'key never in a body');
  assert.equal(requests[1].body.input.at(-1).type, 'function_call_output');
  assert.equal(await evaluate('typeof window.require'), 'undefined');
  await click('#ask-references .cite');
  await waitFor(async () => (await editor()).selection?.fromBarId === ids[6], 'cloud reference selects bars 7–8');
  if (process.env.DRUMHUB_SCREENSHOT) fs.writeFileSync(process.env.DRUMHUB_SCREENSHOT, (await win.webContents.capturePage()).toPNG());

  // 6. Stop cancels a question in progress.
  script.push(signal => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
  await new Promise(resolve => setTimeout(resolve, 1600));  // the agent's pause between questions
  await evaluate(`(() => { document.getElementById('ask-input').value = 'What repeats?'; document.getElementById('ask-form').requestSubmit(); })()`);
  await waitFor(() => evaluate('!document.getElementById("ask-busy").hidden'), 'busy');
  await click('#ask-cancel');
  await waitFor(async () => (await text('#ask-status')) === 'Stopped.', 'stopped');

  // 7. After an edit, the answer is labelled out of date and its references stop working.
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: '1' });
  win.webContents.sendInputEvent({ type: 'char', keyCode: '1' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: '1' });
  await waitFor(() => evaluate('!document.getElementById("ask-stale").hidden'), 'stale answer');

  // 8. Turning cloud help off takes effect immediately.
  await click('#ask-cloud-toggle');
  await waitFor(async () => /Offline answers/.test(await text('#ask-mode-text')), 'offline again');
  assert.equal(await evaluate('document.getElementById("ask-input").disabled'), true);

  console.log('PASS: Ask DrumHub offline answers, disclosure, Luna gate, adult cloud opt-in, tool loop with references, Stop, stale answers, opt-out.');
  fs.rmSync(temp, { recursive: true, force: true });
  app.quit();
}).catch(error => {
  console.error(error);
  fs.rmSync(temp, { recursive: true, force: true });
  app.exit(1);
});
