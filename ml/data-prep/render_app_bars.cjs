// Redraws training bars in DrumHub's own notation, so the reader is trained on a second
// drawing style (the Songsterr/Reflow images all look alike, and a reader trained only on
// them read 13% of DrumHub-drawn bars). Takes the note labels in
// ml/data/finetune/train.jsonl, lets the app draw each one, and saves the picture with the
// notes the app actually drew, so image and label always agree.
//   npx electron ml/data-prep/render_app_bars.cjs            # every training bar
//   npx electron ml/data-prep/render_app_bars.cjs --bars 3000
// Writes ml/data/finetune_app/images/app_<n>.png and manifest.jsonl. The 45 benchmark bars
// in eval/recognition/synthetic come from the exercise catalogue, not from these songs.
process.env.DRUMHUB_IGNORE_DOTENV = '1';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const outDir = path.join(root, 'ml/data/finetune_app');
const limitArg = process.argv.indexOf('--bars');
const limit = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'drumhub-render-')));
require(path.join(root, 'main.js'));

// "0:eighth:hi_hat_closed+kick 4:eighth:snare" → [{ position, duration, drums }]
function parseTarget(target) {
  if (target === 'rest') return [];
  return target.split(' ').map(item => {
    const [position, duration, drums] = item.split(':');
    return { position: Number(position), duration, drums: drums.split('+') };
  });
}

app.whenReady().then(async () => {
  const { barFromPrediction } = await import(path.join(root, 'js/import.js'));
  const { barToTruth } = await import(path.join(root, 'eval/recognition/truth.mjs'));
  const all = fs.readFileSync(path.join(root, 'ml/data/finetune/train.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const step = Math.max(1, Math.floor(all.length / Math.min(limit, all.length)));
  const rows = all.filter((_, i) => i % step === 0).slice(0, limit);

  while (!BrowserWindow.getAllWindows().length) await new Promise(r => setTimeout(r, 100));
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1400, 900);
  while (win.webContents.isLoading()) await new Promise(r => setTimeout(r, 100));
  await new Promise(r => setTimeout(r, 1500));
  await win.webContents.executeJavaScript(`(() => { const s = document.createElement('style');
    s.textContent = '#score-cursor{display:none} body>:not(#score){display:none!important} #score{inset:0!important;background:#fff}';
    document.head.append(s); })()`);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'images'), { recursive: true });
  const manifest = fs.createWriteStream(path.join(outDir, 'manifest.jsonl'));
  let written = 0, skipped = 0, adjusted = 0;
  const started = Date.now();
  for (const row of rows) {
    let converted, notes;
    try {
      converted = barFromPrediction(parseTarget(row.target), { gridSlots: 32 });
      notes = barToTruth(converted.bar);
    } catch { notes = null; }
    if (!notes) { skipped++; continue; }   // the app cannot draw this bar as labelled
    if (converted.warnings.length) adjusted++;
    const rect = await win.webContents.executeJavaScript(`(async () => {
      const { replaceEditor } = await import('./js/editor-store.js');
      const { createEditor } = await import('./js/commands.js');
      const { createMeta } = await import('./js/score-document.js');
      const { state } = await import('./js/state.js');
      state.barsPerRow = 1;   // the SVG is then exactly one bar wide
      replaceEditor(createEditor({ meta: createMeta({ title: 'train' }), bars: [${JSON.stringify(converted.bar)}] }));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = document.querySelector('#score svg').getBoundingClientRect();
      return { x: Math.floor(r.left), y: Math.floor(r.top), width: Math.ceil(r.width), height: Math.ceil(r.height) };
    })()`);
    const image = `ml/data/finetune_app/images/app_${String(written).padStart(5, '0')}.png`;
    fs.writeFileSync(path.join(root, image), (await win.webContents.capturePage(rect)).toPNG());
    manifest.write(`${JSON.stringify({ image, notes, song: row.song, source_image: row.image })}\n`);
    written++;
    if (written % 500 === 0) console.log(`${written} bars drawn, ${Math.round((Date.now() - started) / written)} ms each`);
  }
  await new Promise(resolve => manifest.end(resolve));
  console.log(`Drew ${written} of ${rows.length} bars. ${adjusted} had a note shortened or regrouped to fit the bar; ${skipped} could not be drawn.`);
  app.exit(0);
});
