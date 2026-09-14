// Recognition benchmark lab (master plan B5): the same labelled bars through the local
// model, GPT-5.6 Luna and Gemini, scored the same way. Adult developer tool.
//
//   node eval/recognition/run.mjs --providers local,luna,gemini [--set synthetic|heldout] [--limit 20]
//        [--luna-effort high|medium] [--gemini-model gemini-3.6-flash-high] [--concurrency 3]
//        [--luna-price 0.2,1.2] [--no-write] [--resume]
//
// Sets:
//   synthetic — eval/recognition/synthetic: bars DrumHub rendered from its own original catalogue.
//               The ONLY set Gemini may see (plan §2.1: no student or third-party data to Gemini).
//   heldout   — the training test split, Songsterr bars only (never the Reflow teaching charts,
//               whose names identify students); local model and Luna only.
// Reports go to eval/recognition/reports/ with the commit, set hash, models and settings.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compareBar } from './truth.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });
const { OmrService } = require('../../desktop/omr-service.cjs');
const { OpenAiOmr, RESPONSE_SCHEMA, PROMPT, IMPORT_TIMEOUT_MS } = require('../../desktop/openai-omr.cjs');
const { OpenAiClient } = require('../../desktop/openai-client.cjs');

const sha = data => crypto.createHash('sha256').update(data).digest('hex');

// ── Sets ──────────────────────────────────────────────────────────────────────

function syntheticSet() {
  const manifestPath = path.join(HERE, 'synthetic', 'manifest.json');
  const text = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(text);
  return {
    name: 'synthetic', source: manifest.source, hash: sha(text),
    items: manifest.items.map(item => ({ id: item.id, image: path.join(HERE, 'synthetic', item.image), truth: item.notes })),
  };
}

function heldoutSet() {
  const dataset = path.join(ROOT, 'ml/data/training/dataset');
  const rows = fs.readFileSync(path.join(dataset, 'training_manifest.csv'), 'utf8').trim().split('\n');
  const header = rows.shift().split(',');
  const col = name => header.indexOf(name);
  const items = [];
  for (const line of rows) {
    const cells = line.split(',');
    if (cells.length !== header.length) continue;   // names with commas are skipped rather than mis-parsed
    if (cells[col('split')] !== 'test' || cells[col('source_kind')] !== 'gp7') continue;
    const image = path.join(dataset, 'images', path.basename(cells[col('image_path')]));
    const label = JSON.parse(fs.readFileSync(path.join(dataset, 'labels', path.basename(cells[col('label_path')])), 'utf8'));
    const truth = label.beats.filter(b => b.drums.length)
      .map(b => ({ position: Math.round((Number(b.beat) - 1) * 8), duration: b.duration, drums: [...b.drums].sort() }));
    items.push({ id: path.basename(image, '.png'), image, truth });
  }
  return { name: 'heldout', source: 'songsterr-test-split', hash: sha(items.map(i => i.id).join('\n')), items };
}

// ── Providers: each returns { notes, usage?, note? } for one image ────────────

function localProvider() {
  const service = new OmrService({ root: ROOT });
  return {
    name: 'local', model: 'baseline-14drum-v1', concurrency: 1,
    run: async item => ({ notes: (await service.predict(item.image)).notes }),
    close: () => service.stop(),
  };
}

function lunaProvider({ effort }) {
  return {
    name: 'luna', model: 'gpt-5.6-luna', effort, concurrency: 3,
    run: async item => {
      let usage = null;
      // The app's import timeout: high reasoning often takes 40–60 s, longer than the client default.
      const client = new OpenAiClient({ timeoutMs: IMPORT_TIMEOUT_MS });
      const create = client.createResponse.bind(client);
      client.createResponse = async (...args) => { const body = await create(...args); usage = body.usage; return body; };
      const omr = new OpenAiOmr({ client, effort });
      if (!client.configured) throw new Error('Set OPENAI_API_KEY to benchmark Luna.');
      const result = await omr.recognize(fs.readFileSync(item.image));
      return { notes: result.bars[0]?.notes ?? [], usage, note: result.bars.length > 1 ? `${result.bars.length} bars returned` : '' };
    },
  };
}

function geminiProvider({ model, set }) {
  if (set.source !== 'drumhub-synthetic') {
    throw new Error('Gemini may only see the DrumHub-synthetic set (plan §2.1). Use --set synthetic.');
  }
  const schemaFile = path.join(HERE, 'reports', '.gemini-schema.json');
  // Gemini's API refuses parts of OpenAI's strict schema (integer enums, bounds, minItems,
  // additionalProperties), so a simplified copy is sent; scoring only reads bars[0].notes.
  const geminiSafe = value => {
    if (Array.isArray(value)) return value.map(geminiSafe);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !['additionalProperties', 'minimum', 'maximum', 'minItems', 'description'].includes(key))
      .filter(([key]) => !(key === 'enum' && value.type === 'integer'))
      .map(([key, inner]) => [key, geminiSafe(inner)]));
  };
  fs.writeFileSync(schemaFile, JSON.stringify(geminiSafe(RESPONSE_SCHEMA)));
  return {
    name: 'gemini', model, concurrency: 2,
    run: item => new Promise((resolve, reject) => {
      // agy is an agent that can read files, so each image is copied alone, under a neutral
      // name, into an empty folder that is also its working directory. Otherwise it could open
      // synthetic/manifest.json (the answers) or read hints from the file name.
      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drumhub-gemini-'));
      const image = path.join(workDir, 'bar.png');
      fs.copyFileSync(item.image, image);
      const cleanup = () => fs.rmSync(workDir, { recursive: true, force: true });
      const prompt = `${PROMPT}\n\nThe image to transcribe is the file ${image}. Open it and look at it before answering. Do not open any other file.`;
      const child = spawn('agy', ['-p', prompt, '--add-dir', workDir, '--model', model, '--mode', 'plan',
        '--output-format', 'json', '--json-schema', schemaFile, '--print-timeout', '5m'], { cwd: workDir, stdio: ['ignore', 'pipe', 'pipe'] });
      child.on('close', cleanup);
      let out = ''; let err = '';
      child.stdout.on('data', chunk => { out += chunk; });
      child.stderr.on('data', chunk => { err += chunk; });
      child.on('error', reject);
      child.on('close', code => {
        try {
          const reply = JSON.parse(out.trim().split('\n').filter(Boolean).at(-1));
          const result = reply.structured_output;
          if (!result || reply.status !== 'SUCCESS') throw new Error(`agy status ${reply.status}`);
          if (result.status === 'needs_crop') throw new Error(`needs_crop: ${result.message}`);
          resolve({ notes: result.bars?.[0]?.notes ?? [], usage: reply.usage });
        } catch (error) {
          reject(new Error(`Gemini via agy failed (exit ${code}): ${error.message} ${err.slice(-300)}`));
        }
      });
    }),
  };
}

// ── Running and scoring ───────────────────────────────────────────────────────

// Each result is also appended to reports/.progress-<set>-<provider>.jsonl as it arrives, so a
// run that is stopped part-way keeps its work; --resume skips bars that already have a score.
async function runProvider(provider, items, { progressFile = null, resume = false } = {}) {
  const earlier = resume && progressFile && fs.existsSync(progressFile)
    ? fs.readFileSync(progressFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
      .filter(r => r.score && items.some(item => item.id === r.id))
    : [];
  if (progressFile && !resume) fs.rmSync(progressFile, { force: true });
  const results = [...new Map(earlier.map(r => [r.id, r])).values()];
  const queue = items.filter(item => !results.some(r => r.id === item.id));
  const keep = result => {
    results.push(result);
    if (progressFile) fs.appendFileSync(progressFile, `${JSON.stringify(result)}\n`);
  };
  await Promise.all(Array.from({ length: provider.concurrency }, async () => {
    while (queue.length) {
      const item = queue.shift();
      const started = Date.now();
      try {
        const out = await provider.run(item);
        keep({ id: item.id, ms: Date.now() - started, score: compareBar(item.truth, out.notes), usage: out.usage ?? null, note: out.note ?? '' });
      } catch (error) {
        keep({ id: item.id, ms: Date.now() - started, error: error.message.slice(0, 300) });
      }
      process.stdout.write(`\r  ${provider.name}: ${results.length}/${items.length}   `);
    }
  }));
  process.stdout.write('\n');
  return results.sort((a, b) => a.id.localeCompare(b.id));
}

const ratio = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const pctl = (values, p) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)] : null; };

export function summarize(results, { inputPrice = null, outputPrice = null } = {}) {
  const ok = results.filter(r => r.score);
  const sum = key => ok.reduce((acc, r) => {
    const s = r.score[key];
    return { truth: acc.truth + (s.truth ?? 0), predicted: acc.predicted + (s.predicted ?? 0), matched: acc.matched + s.matched, compared: acc.compared + (s.compared ?? 0) };
  }, { truth: 0, predicted: 0, matched: 0, compared: 0 });
  const onsets = sum('onsets'); const drums = sum('drumHits'); const durations = sum('durations');
  const f1 = s => { const p = s.predicted ? s.matched / s.predicted : 0; const r = s.truth ? s.matched / s.truth : 0; return p + r ? Math.round((2 * p * r / (p + r)) * 1000) / 10 : 0; };
  const tokens = ok.reduce((acc, r) => ({ input: acc.input + (r.usage?.input_tokens ?? 0), output: acc.output + (r.usage?.output_tokens ?? 0) }), { input: 0, output: 0 });
  return {
    bars: results.length, answered: ok.length, errors: results.length - ok.length, errorRate: ratio(results.length - ok.length, results.length),
    exactBars: ratio(ok.filter(r => r.score.exact).length, results.length),
    onsetF1: f1(onsets), drumHitF1: f1(drums), durationAccuracy: ratio(durations.matched, durations.compared),
    latencyMs: { p50: pctl(ok.map(r => r.ms), 50), p95: pctl(ok.map(r => r.ms), 95) },
    tokens, estimatedCostUsd: inputPrice === null ? null : Math.round(((tokens.input * inputPrice + tokens.output * outputPrice) / 1e6) * 10000) / 10000,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
  const set = flag('set', 'synthetic') === 'heldout' ? heldoutSet() : syntheticSet();
  const limit = Number(flag('limit', set.items.length));
  const items = set.items.slice(0, limit);
  const providers = flag('providers', 'local').split(',');
  const [inputPrice, outputPrice] = (flag('luna-price', '0.2,1.2')).split(',').map(Number);
  let commit = null;
  try { commit = execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a checkout */ }
  const report = { reportVersion: 1, runAt: new Date().toISOString(), commit, set: { name: set.name, source: set.source, hash: set.hash, bars: items.length }, providers: {} };
  for (const name of providers) {
    const provider = name === 'local' ? localProvider()
      : name === 'luna' ? lunaProvider({ effort: flag('luna-effort', 'high') })
        : name === 'gemini' ? geminiProvider({ model: flag('gemini-model', 'gemini-3.6-flash-high'), set })
          : null;
    if (!provider) throw new Error(`Unknown provider ${name}`);
    if (flag('concurrency')) provider.concurrency = Number(flag('concurrency'));
    console.log(`${provider.name} (${provider.model}${provider.effort ? `, ${provider.effort}` : ''}) on ${items.length} ${set.name} bars`);
    const progressFile = path.join(HERE, 'reports', `.progress-${set.name}-${name}.jsonl`);
    const results = await runProvider(provider, items, { progressFile, resume: args.includes('--resume') });
    await provider.close?.();
    const summary = summarize(results, name === 'luna' ? { inputPrice, outputPrice } : {});
    report.providers[name] = { model: provider.model, effort: provider.effort ?? null, summary, results };
    console.log(`  exact bars ${summary.exactBars}% | onset F1 ${summary.onsetF1} | drum-hit F1 ${summary.drumHitF1} | durations ${summary.durationAccuracy}% | errors ${summary.errors} | p50 ${summary.latencyMs.p50} ms | tokens ${summary.tokens.input}/${summary.tokens.output}${summary.estimatedCostUsd !== null ? ` | ~$${summary.estimatedCostUsd}` : ''}`);
  }
  if (!args.includes('--no-write')) {
    const file = path.join(HERE, 'reports', `${report.runAt.replace(/[:.]/g, '-')}-${set.name}-${providers.join('-')}.json`);
    fs.writeFileSync(file, `${JSON.stringify(report, null, 1)}\n`);
    console.log(`Report: ${path.relative(ROOT, file)}`);
  }
}
