// Renders DrumHub's own original exercise and fill bars as one-bar images with known
// notes: the synthetic benchmark set (master plan B5). Synthetic and owned by DrumHub, so
// it is the only set that may be sent to Gemini (adult developer use, plan §2.1).
//   npx electron eval/recognition/render-synthetic.cjs
process.env.DRUMHUB_IGNORE_DOTENV = '1';
const { app, BrowserWindow } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const outDir = path.join(__dirname, 'synthetic');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'drumhub-render-')));
require(path.join(root, 'main.js'));

app.whenReady().then(async () => {
  const { EXERCISES, FILLS } = await import(path.join(root, 'js/exercise-catalogue.js'));
  const { barToTruth } = await import(path.join(__dirname, 'truth.mjs'));
  while (!BrowserWindow.getAllWindows().length) await new Promise(r => setTimeout(r, 100));
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1400, 900);
  while (win.webContents.isLoading()) await new Promise(r => setTimeout(r, 100));
  await new Promise(r => setTimeout(r, 1500));
  await win.webContents.executeJavaScript(`(() => { const s = document.createElement('style');
    s.textContent = '#score-cursor{display:none} #import-panel,#keypad,body>div:first-child,.modal,#side-panel{display:none!important} #score{inset:0!important;background:#fff}';
    document.head.append(s); })()`);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'images'), { recursive: true });
  const items = [];
  const candidates = [...EXERCISES, ...FILLS].flatMap(item => item.bars.map((bar, i) => ({ id: `${item.id}${item.bars.length > 1 ? `-bar${i + 1}` : ''}`, bar, level: item.level, kind: item.kind })));
  for (const candidate of candidates) {
    const truth = barToTruth(candidate.bar);
    if (!truth) continue;
    const rect = await win.webContents.executeJavaScript(`(async () => {
      const { replaceEditor } = await import('./js/editor-store.js');
      const { createEditor } = await import('./js/commands.js');
      const { createMeta } = await import('./js/score-document.js');
      const { state } = await import('./js/state.js');
      state.barsPerRow = 1;   // the SVG is then exactly one bar wide
      replaceEditor(createEditor({ meta: createMeta({ title: 'bench' }), bars: [${JSON.stringify(candidate.bar)}] }));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = document.querySelector('#score svg').getBoundingClientRect();
      return { x: Math.floor(r.left), y: Math.floor(r.top), width: Math.ceil(r.width), height: Math.ceil(r.height) };
    })()`);
    const png = (await win.webContents.capturePage(rect)).toPNG();
    const file = `images/${candidate.id}.png`;
    fs.writeFileSync(path.join(outDir, file), png);
    items.push({ id: candidate.id, image: file, sha256: crypto.createHash('sha256').update(png).digest('hex'),
      kind: candidate.kind, level: candidate.level, notes: truth });
  }
  const manifest = { manifestVersion: 1, source: 'drumhub-synthetic', createdAt: new Date().toISOString().slice(0, 10),
    note: 'One-bar images rendered by DrumHub from its original exercise and fill catalogue. Synthetic; safe for developer benchmarks with any provider.',
    items };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  console.log(`Rendered ${items.length} of ${candidates.length} bars (${candidates.length - items.length} use notes the recognisers cannot express).`);
  app.exit(0);
});
