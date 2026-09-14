// Electron wiring for Ask DrumHub and the cloud-help setting. The page sends a question
// and a snapshot; everything else (the key, the model call, the tools, the checks)
// happens here in main.
const { app, dialog, ipcMain, BrowserWindow } = require('electron');
const { ScoreAgent, AgentRequestError } = require('./score-agent.cjs');
const { AppSettings } = require('./app-settings.cjs');
const { ScoreFiles } = require('./score-files.cjs');

function initAgent({ trustedSender }) {
  const files = new ScoreFiles({ dataDir: app.getPath('userData') });
  const settings = new AppSettings({ dataDir: app.getPath('userData'), writeAtomic: (file, text) => files.writeAtomic(file, text) });
  const ready = settings.load();
  const agent = new ScoreAgent({ settings: () => ({ cloudEnabled: settings.cloudEnabled }) });

  const handle = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
    if (!trustedSender(event)) return { error: 'Ask DrumHub is only available in the score editor.' };
    await ready;
    try { return await fn(event, ...args); }
    catch (error) { return { error: error instanceof AgentRequestError ? error.message : `Ask DrumHub failed: ${error.message}` }; }
  });

  handle('agent:status', () => agent.status());
  handle('agent:ask', (_event, request) => agent.ask(request));
  handle('agent:cancel', () => { agent.cancel(); return { ok: true }; });
  handle('agent:set-cloud', async (event, enabled) => {
    if (!enabled) { await settings.setCloud(false); return agent.status(); }
    if (!agent.client.configured) {
      return { ...agent.status(), error: 'Cloud help needs an OpenAI API key. Quit DrumHub and start it with OPENAI_API_KEY set.' };
    }
    const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
      type: 'warning', buttons: ['I am an adult — turn on cloud help', 'Cancel'], defaultId: 1, cancelId: 1,
      message: 'Turn on cloud help? For teachers and parents only.',
      detail: 'Typed questions, facts about the notes (not the title), and pasted screenshots will be sent to OpenAI. ' +
        'Students under 18 should keep using the offline answers. You can turn this off at any time.',
    });
    if (response === 0) await settings.setCloud(true);
    return agent.status();
  });

  return { agent, settings, ready };
}

module.exports = { initAgent };
