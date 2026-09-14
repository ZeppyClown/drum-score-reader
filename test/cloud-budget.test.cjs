const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CloudBudget } = require('../desktop/cloud-budget.cjs');
const { OpenAiClient } = require('../desktop/openai-client.cjs');

const tempFile = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drumhub-budget-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return path.join(dir, 'budget.json'); };
const reply = usage => ({ ok: true, status: 200, json: async () => ({ status: 'completed', usage, output: [] }) });

test('usage is priced, saved, and a new month starts at zero', async t => {
  const file = tempFile(t);
  let now = new Date('2026-09-15T10:00:00Z');
  const budget = new CloudBudget({ file, limitUsd: 1, now: () => now });
  await budget.record('gpt-5.6-luna', { input_tokens: 1_000_000, output_tokens: 100_000 });
  assert.equal(budget.status().spentUsd, 0.32);
  const reopened = new CloudBudget({ file, limitUsd: 1, now: () => now });
  assert.equal(reopened.status().spentUsd, 0.32, 'spending survives a restart');
  now = new Date('2026-10-01T00:00:00Z');
  assert.equal(reopened.status().spentUsd, 0);
  assert.equal(reopened.status().month, '2026-10');
});

test('unknown models are counted at the highest known price', async t => {
  const budget = new CloudBudget({ file: tempFile(t) });
  await budget.record('some-new-model', { input_tokens: 0, output_tokens: 1_000_000 });
  assert.equal(budget.status().spentUsd, 1.2);
});

test('the shared client refuses to send once the monthly limit is reached, and counts cut-off replies', async t => {
  const budget = new CloudBudget({ file: tempFile(t), limitUsd: 0.001 });
  let calls = 0;
  const client = new OpenAiClient({ apiKey: 'sk-test-budget-1234567890', budget, fetchImpl: async () => {
    calls++;
    return { ok: true, status: 200, json: async () => ({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 1000, output_tokens: 10000 }, output: [] }) };
  } });
  await assert.rejects(client.createResponse({ model: 'gpt-5.6-luna' }), /incomplete/);
  assert.ok(budget.status().spentUsd > 0.001, 'the cut-off reply was still counted');
  assert.equal(budget.status().lastError.message.includes('incomplete'), true);
  await assert.rejects(client.createResponse({ model: 'gpt-5.6-luna' }), /cloud help limit .* has been reached/);
  assert.equal(calls, 1, 'nothing was sent after the limit');
});
