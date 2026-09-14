// Electron wiring for Ask DrumHub and the cloud-help setting. The page sends a question
// and a snapshot; everything else (the key, the model call, the tools, the checks)
// happens here in main.
const { app, dialog, ipcMain, BrowserWindow } = require('electron');
const { ScoreAgent, AgentRequestError } = require('./score-agent.cjs');
const { OpenAiClient } = require('./openai-client.cjs');
const { AppSettings } = require('./app-settings.cjs');
const { ScoreFiles } = require('./score-files.cjs');
const fs = require('node:fs');
const path = require('node:path');

// The daily cloud-question count, kept in the app data folder so restarting does not reset it.
function usageStore(files, dataDir) {
  const file = path.join(dataDir, 'agent-usage.json');
  return {
    load: () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } },
    save: usage => { fs.mkdirSync(dataDir, { recursive: true }); files.writeAtomic(file, `${JSON.stringify(usage)}\n`).catch(() => {}); },
  };
}

function initAgent({ trustedSender, budget = null }) {
  const files = new ScoreFiles({ dataDir: app.getPath('userData') });
  const settings = new AppSettings({ dataDir: app.getPath('userData'), writeAtomic: (file, text) => files.writeAtomic(file, text) });
  const ready = settings.load();
  const agent = new ScoreAgent({
    client: new OpenAiClient({ budget }),
    settings: () => ({ cloudEnabled: settings.cloudEnabled }),
    usageStore: usageStore(files, app.getPath('userData')),
  });

  const handle = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
    if (!trustedSender(event)) return { error: 'Ask DrumHub is only available in the score editor.' };
    await ready;
    try { return await fn(event, ...args); }
    catch (error) { return { error: error instanceof AgentRequestError ? error.message : `Ask DrumHub failed: ${error.message}` }; }
  });

  const status = () => ({ ...agent.status(), budget: budget?.status() ?? null });
  handle('agent:status', status);
  handle('agent:ask', (_event, request) => agent.ask(request));
  handle('agent:cancel', () => { agent.cancel(); return { ok: true }; });
  handle('agent:set-cloud', async (event, enabled) => {
    if (!enabled) { await settings.setCloud(false); return status(); }
    if (!agent.client.configured) {
      return { ...status(), error: 'Cloud help needs an OpenAI API key. Quit DrumHub and start it with OPENAI_API_KEY set.' };
    }
    const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
      type: 'warning', buttons: ['I am an adult — turn on cloud help', 'Cancel'], defaultId: 1, cancelId: 1,
      message: 'Turn on cloud help? For teachers and parents only.',
      detail: 'Typed questions, facts about the notes (not the title), and pasted screenshots will be sent to OpenAI. ' +
        'Students under 18 should keep using the offline answers. You can turn this off at any time.',
    });
    if (response === 0) await settings.setCloud(true);
    return status();
  });

  return { agent, settings, ready };
}

module.exports = { initAgent };
