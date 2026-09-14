// Monthly cloud spending limit for everything DrumHub sends to OpenAI (plan §4 I2,
// decision 8). The shared OpenAI client asks check() before a request and calls
// record() with the reply's token usage, so screenshot import, Ask DrumHub, Fill Lab
// and teacher summaries all count against one limit. Costs are estimates from the
// published per-million-token prices below; the provider's own bill is the truth.
const fs = require('node:fs');
const path = require('node:path');

// USD per million tokens. Unknown models are counted at the most expensive listed price.
const PRICES = Object.freeze({ 'gpt-5.6-luna': Object.freeze({ input: 0.2, output: 1.2 }) });
const DEFAULT_LIMIT_USD = 5;

const monthOf = date => date.toISOString().slice(0, 7);

class CloudBudget {
  // limitUsd: DRUMHUB_MONTHLY_CLOUD_USD or 5. writeFile(file, text) should be atomic in the app.
  constructor({ file, limitUsd = Number(process.env.DRUMHUB_MONTHLY_CLOUD_USD) || DEFAULT_LIMIT_USD, now = () => new Date(),
    writeFile = (target, text) => fs.promises.writeFile(target, text), prices = PRICES } = {}) {
    Object.assign(this, { file, limitUsd, now, writeFile, prices });
    this.state = { month: monthOf(now()), spentUsd: 0, requests: 0, inputTokens: 0, outputTokens: 0, lastError: null };
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved.month === this.state.month && Number.isFinite(saved.spentUsd)) this.state = { ...this.state, ...saved };
    } catch { /* first run or unreadable: start the month at zero */ }
  }

  rollMonth() {
    const month = monthOf(this.now());
    if (this.state.month !== month) this.state = { month, spentUsd: 0, requests: 0, inputTokens: 0, outputTokens: 0, lastError: null };
  }

  priceFor(model) {
    if (this.prices[model]) return this.prices[model];
    const all = Object.values(this.prices);
    return { input: Math.max(...all.map(p => p.input)), output: Math.max(...all.map(p => p.output)) };
  }

  // Throws before a request once the month's estimated spending has reached the limit.
  check() {
    this.rollMonth();
    if (this.state.spentUsd >= this.limitUsd) {
      throw new Error(`This month's cloud help limit (about US$${this.limitUsd.toFixed(2)}) has been reached, so nothing more is sent until ${this.nextMonthLabel()}. Offline features still work.`);
    }
  }

  record(model, usage) {
    this.rollMonth();
    const input = usage?.input_tokens ?? 0;
    const output = usage?.output_tokens ?? 0;
    const price = this.priceFor(model);
    this.state = {
      ...this.state,
      spentUsd: this.state.spentUsd + (input * price.input + output * price.output) / 1e6,
      requests: this.state.requests + 1, inputTokens: this.state.inputTokens + input, outputTokens: this.state.outputTokens + output,
    };
    return this.save();
  }

  recordError(message) {
    this.state = { ...this.state, lastError: { message: String(message).slice(0, 200), at: this.now().toISOString() } };
    return this.save();
  }

  save() {
    const text = `${JSON.stringify(this.state)}\n`;
    return Promise.resolve()
      .then(() => fs.promises.mkdir(path.dirname(this.file), { recursive: true }))
      .then(() => this.writeFile(this.file, text))
      .catch(() => { /* the limit still applies for this run */ });
  }

  nextMonthLabel() {
    const date = this.now();
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  }

  status() {
    this.rollMonth();
    return { month: this.state.month, spentUsd: Math.round(this.state.spentUsd * 10000) / 10000, limitUsd: this.limitUsd,
      requests: this.state.requests, lastError: this.state.lastError };
  }
}

module.exports = { CloudBudget, PRICES, DEFAULT_LIMIT_USD };
