// Ask DrumHub evaluation harness (plan §4 I3, ticket 12).
//
//   node eval/score-agent/run.mjs                      offline answers (no network)
//   OPENAI_API_KEY=… node eval/score-agent/run.mjs --provider openai [--model gpt-5.6-luna]
//        [--input-price 1.25 --output-price 10]   USD per million tokens, for a cost estimate
//        [--only sticking,accents] [--no-write]
//
// Writes eval/score-agent/reports/<time>-<provider>.json and prints a summary with the
// plan's release gates. Reports record the git commit, model, question-bank hash and
// fixture hashes, so results are only compared when those match.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseDocument, splitDocument } from '../../js/score-document.js';
import { createEditor, execute, goToBarCommand } from '../../js/commands.js';
import { selectBarsCommand } from '../../js/selection.js';
import { buildAskRequest } from '../../js/ask-request.js';
import { TOOL_NAMES } from '../../js/agent-tools.js';
import { gradeAnswer } from './graders.mjs';

const require = createRequire(import.meta.url);
require('dotenv').config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
const { ScoreAgent } = require('../../desktop/score-agent.cjs');
const { OpenAiClient, modelSettings } = require('../../desktop/openai-client.cjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPORT_VERSION = 1;
const READ_ONLY_TOOLS = ['get_score_overview', 'inspect_bars', 'find_complex_passages', 'find_patterns',
  'compare_passages', 'find_fill_candidates', 'build_practice_plan'];
const sha = text => crypto.createHash('sha256').update(text).digest('hex');

function loadFixtures() {
  const files = { song: 'song.drumhub.json', long: 'long-groove.drumhub.json' };
  return Object.fromEntries(Object.entries(files).map(([name, file]) => {
    const text = fs.readFileSync(path.join(HERE, 'fixtures', file), 'utf8');
    return [name, { doc: parseDocument(text), hash: sha(text), file }];
  }));
}

function editorFor(fixture, question) {
  const { meta, bars } = splitDocument(fixture.doc);
  let editor = createEditor({ meta, bars });
  if (question.select) {
    const [from, to] = question.select;
    editor = execute(editor, goToBarCommand(from - 1));
    editor = execute(editor, selectBarsCommand(editor.bars[from - 1].barId, editor.bars[to - 1].barId));
  }
  return editor;
}

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

function rate(results, check) {
  const applicable = results.filter(r => r.checks && r.checks[check] !== null && r.checks[check] !== undefined);
  return { passed: applicable.filter(r => r.checks[check] === true).length, of: applicable.length };
}

export function summarize(results, { inputPrice = null, outputPrice = null, provider = 'offline' } = {}) {
  const graded = results.filter(r => !r.skipped && !r.error);
  const attempted = results.filter(r => !r.skipped);
  const pct = ({ passed, of }) => (of ? Math.round((passed / of) * 1000) / 10 : null);
  const sentences = graded.reduce((acc, r) => ({ total: acc.total + r.checks.groundedSentences.total, grounded: acc.grounded + r.checks.groundedSentences.grounded }), { total: 0, grounded: 0 });
  const tokens = graded.reduce((acc, r) => ({ input: acc.input + (r.usage?.inputTokens ?? 0), output: acc.output + (r.usage?.outputTokens ?? 0) }), { input: 0, output: 0 });
  const latencies = graded.map(r => r.latencyMs).filter(Number.isFinite);
  const metrics = {
    questions: results.length,
    graded: graded.length,
    skipped: results.filter(r => r.skipped).length,
    errors: results.filter(r => r.error).length,
    fallbacks: graded.filter(r => r.fellBack).length,
    // Share of attempted questions the model itself answered and passed the checks.
    modelAnswerRate: provider === 'offline' || !attempted.length ? null
      : Math.round((graded.filter(r => !r.fellBack).length / attempted.length) * 1000) / 10,
    errorRate: attempted.length ? Math.round((results.filter(r => r.error).length / attempted.length) * 1000) / 10 : null,
    facts: pct(rate(graded, 'facts')),
    citationsValid: pct(rate(graded, 'citationsValid')),
    requiredReferences: pct(rate(graded, 'requiredReferences')),
    abstention: pct(rate(graded, 'abstention')),
    unreviewedDisclosure: pct(rate(graded, 'unreviewedDisclosure')),
    noUnsupportedClaims: pct(rate(graded, 'noUnsupportedClaims')),
    readerFriendly: pct(rate(graded, 'noInternalJargon')),
    noDuplicateWarnings: pct(rate(graded, 'noDuplicateWarnings')),
    forbiddenText: pct(rate(graded, 'forbiddenText')),
    groundedSentences: sentences.total ? Math.round((sentences.grounded / sentences.total) * 1000) / 10 : null,
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    tokens,
    estimatedCostUsd: inputPrice !== null && outputPrice !== null
      ? Math.round(((tokens.input * inputPrice + tokens.output * outputPrice) / 1e6) * 10000) / 10000 : null,
  };
  const gate = (name, value, threshold) => ({ name, value, threshold, passed: value === null ? null : value >= threshold });
  const readOnly = TOOL_NAMES.every(n => READ_ONLY_TOOLS.includes(n));
  const gates = [
    gate('References 100% valid', metrics.citationsValid, 100),
    gate('Unavailable-fact abstention 100%', metrics.abstention, 100),
    gate('Unchecked-import disclosure 100%', metrics.unreviewedDisclosure, 100),
    gate('Grounded sentences at least 95%', metrics.groundedSentences, 95),
    gate('Model answered and passed checks (no fallback) at least 95%', metrics.modelAnswerRate, 95),
    { name: 'No harness errors', value: metrics.errorRate, threshold: 0, passed: metrics.errorRate === null ? null : metrics.errorRate === 0 },
    { name: 'Zero unconfirmed score changes (agent tools are read-only)', value: readOnly ? 0 : 1, threshold: 0, passed: readOnly },
  ];
  return { metrics, gates };
}

export async function runEval({ provider = 'offline', model = modelSettings().agent, only = null, client = null } = {}) {
  const bank = JSON.parse(fs.readFileSync(path.join(HERE, 'questions.json'), 'utf8'));
  const fixtures = loadFixtures();
  const cloud = provider !== 'offline';
  const agent = new ScoreAgent({
    client: client ?? new OpenAiClient(), model, settings: () => ({ cloudEnabled: cloud }),
    minIntervalMs: 0, dailyLimit: Infinity,
  });
  if (cloud && !agent.client.configured) throw new Error('Set OPENAI_API_KEY to evaluate the openai provider.');
  const results = [];
  for (const question of bank.questions.filter(q => !only || only.includes(q.id))) {
    const editor = editorFor(fixtures[question.fixture], question);
    const request = buildAskRequest(editor, question.questionId ? { questionId: question.questionId } : { question: question.question, kind: question.kind });
    const { label, ...payload } = request;
    if (!cloud && !question.questionId) {
      results.push({ id: question.id, question: label, skipped: 'Typed questions need the openai provider.' });
      continue;
    }
    const started = Date.now();
    try {
      const answer = await agent.ask(payload);
      const { checks, failures } = gradeAnswer(answer, request.snapshot, question.expect);
      results.push({
        id: question.id, question: label, mode: answer.mode, fellBack: cloud && answer.mode !== 'cloud',
        latencyMs: answer.latencyMs ?? Date.now() - started, usage: answer.usage ?? null,
        answer: answer.answer, abstained: answer.abstained, references: answer.references.map(r => [r.fromBar, r.toBar]),
        caveats: answer.caveats, checks,
        failures: cloud && answer.mode !== 'cloud' ? [...failures, `fell back to offline — ${answer.caveats[0] ?? 'no reason given'}`] : failures,
      });
    } catch (error) {
      results.push({ id: question.id, question: label, error: error.message });
    }
  }
  let commit = null;
  try { commit = execSync('git rev-parse --short HEAD', { cwd: HERE, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a git checkout */ }
  return {
    reportVersion: REPORT_VERSION, runAt: new Date().toISOString(), provider, model: cloud ? model : null, commit,
    questionBank: { version: bank.bankVersion, hash: sha(JSON.stringify(bank)) },
    fixtures: Object.fromEntries(Object.entries(fixtures).map(([name, f]) => [name, { file: f.file, hash: f.hash }])),
    results,
  };
}

function printSummary(report, summary) {
  const line = (label, value) => console.log(`  ${label.padEnd(34)} ${value ?? 'n/a'}`);
  console.log(`\nAsk DrumHub evaluation — ${report.provider}${report.model ? ` (${report.model})` : ''}, commit ${report.commit ?? '?'}`);
  const m = summary.metrics;
  line('Questions graded / skipped / errors', `${m.graded} / ${m.skipped} / ${m.errors}`);
  line('Fell back to offline', m.fallbacks);
  line('Model answer rate (%)', m.modelAnswerRate);
  line('Error rate (%)', m.errorRate);
  line('Facts mentioned (%)', m.facts);
  line('References valid (%)', m.citationsValid);
  line('Required references (%)', m.requiredReferences);
  line('Correct abstention (%)', m.abstention);
  line('Unchecked-import warning (%)', m.unreviewedDisclosure);
  line('No unsupported claims (%)', m.noUnsupportedClaims);
  line('Nothing it was told not to say (%)', m.forbiddenText);
  line('No internal jargon (%)', m.readerFriendly);
  line('No duplicate warnings (%)', m.noDuplicateWarnings);
  line('Grounded sentences (%)', m.groundedSentences);
  line('Latency p50 / p95 (ms)', `${m.latencyMs.p50} / ${m.latencyMs.p95}`);
  line('Tokens in / out', `${m.tokens.input} / ${m.tokens.output}`);
  line('Estimated cost (USD)', m.estimatedCostUsd);
  console.log('\nRelease gates:');
  for (const g of summary.gates) console.log(`  ${g.passed === null ? '–' : g.passed ? '✓' : '✗'} ${g.name}: ${g.value ?? 'n/a'}`);
  const failed = report.results.filter(r => r.failures?.length || r.error);
  if (failed.length) {
    console.log('\nFailures:');
    for (const r of failed) console.log(`  ${r.id}: ${r.error ?? r.failures.join('; ')}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
  const provider = flag('provider') ?? 'offline';
  const report = await runEval({
    provider, model: flag('model') ?? modelSettings().agent, only: flag('only')?.split(',') ?? null,
  });
  const summary = summarize(report.results, {
    provider,
    inputPrice: flag('input-price') === null ? null : Number(flag('input-price')),
    outputPrice: flag('output-price') === null ? null : Number(flag('output-price')),
  });
  const full = { ...report, summary };
  printSummary(report, summary);
  if (!args.includes('--no-write')) {
    const file = path.join(HERE, 'reports', `${report.runAt.replace(/[:.]/g, '-')}-${provider}.json`);
    fs.writeFileSync(file, `${JSON.stringify(full, null, 2)}\n`);
    console.log(`\nReport: ${path.relative(process.cwd(), file)}`);
  }
  process.exitCode = summary.gates.some(g => g.passed === false) ? 1 : 0;
}
