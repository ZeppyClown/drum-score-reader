// Shared OpenAI Responses API transport for everything DrumHub sends to OpenAI
// (screenshot import, Ask DrumHub). Runs only in Electron main, so the API key never
// reaches the page. Every request is sent with store:false, retried on temporary
// failures, and every error message has the key removed before it leaves this file.
const ENDPOINT = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-5.6-luna';
const sleep = delay => new Promise(resolve => setTimeout(resolve, delay));

// Separate settings so import and the agent can move to different models independently.
// OPENAI_MODEL is the older single setting and still works as a fallback for import.
function modelSettings(env = process.env) {
  return {
    omr: env.OPENAI_OMR_MODEL || env.OPENAI_MODEL || DEFAULT_MODEL,
    agent: env.OPENAI_AGENT_MODEL || DEFAULT_MODEL,
  };
}

// Real keys are long; very short test placeholders are left alone so they cannot mangle text.
function redactSecret(text, secret) {
  return secret && secret.length >= 8 ? String(text).split(secret).join('[redacted]') : String(text);
}

function apiErrorMessage(response, body, model, setting = 'OPENAI_MODEL') {
  const detail = body?.error?.message || `HTTP ${response.status}`;
  const code = body?.error?.code || '';
  if (response.status === 401 || code === 'invalid_api_key') {
    return `The OpenAI API key is invalid. Check OPENAI_API_KEY and restart the app. (${detail})`;
  }
  if (response.status === 403) {
    return `This API key is not allowed to use ${model}. Check the key's project permissions. (${detail})`;
  }
  if (response.status === 404 || code === 'model_not_found') {
    return `The OpenAI model is unavailable to this API key. Check ${setting} and project access. (${detail})`;
  }
  if (response.status === 429) {
    return `The OpenAI quota or rate limit was reached. Wait briefly or check the project's limits. (${detail})`;
  }
  if (response.status === 400 || response.status === 422) {
    return `OpenAI rejected the request configuration. (${detail})`;
  }
  return `OpenAI API request failed. (${detail})`;
}

const isRetryable = response => [408, 409, 429].includes(response.status) || response.status >= 500;

// Text of the final message; throws on a refusal. `task` completes "OpenAI refused to …".
function outputText(body, task) {
  const content = body?.output?.flatMap(item => (item.type === 'message' ? item.content || [] : [])) || [];
  const refusal = content.find(item => item.type === 'refusal')?.refusal;
  if (refusal) throw new Error(`OpenAI refused ${task}: ${refusal}`);
  return content.filter(item => item.type === 'output_text').map(item => item.text || '').join('');
}

class OpenAiClient {
  // log(event) receives { attempt, status, ms } per HTTP attempt, then { response: { status,
  // incomplete, usage, outputTypes } } for the final body — never content or the key.
  constructor({ apiKey = process.env.OPENAI_API_KEY, fetchImpl = fetch, timeoutMs = 60000, maxAttempts = 3,
    retryDelayMs = 1000, sleepImpl = sleep, randomImpl = Math.random, log = () => {} } = {}) {
    Object.assign(this, { apiKey, fetchImpl, timeoutMs, maxAttempts, retryDelayMs, sleepImpl, randomImpl, log });
  }

  get configured() { return Boolean(this.apiKey); }

  // body: a Responses API request. task: words for errors, e.g. "the screenshot".
  // setting: the environment variable that names this model, for the 404 hint.
  // signal: optional AbortSignal; aborting rejects with "Canceled."
  async createResponse(body, { task = 'the request', setting = 'OPENAI_MODEL', signal } = {}) {
    try { return await this.send(body, task, setting, signal); }
    catch (error) { throw new Error(redactSecret(error.message, this.apiKey)); }
  }

  async send(body, task, setting, signal) {
    if (!this.apiKey) {
      throw new Error('OpenAI is not configured. Quit the app and restart it with OPENAI_API_KEY set.');
    }
    const requestBody = JSON.stringify({ ...body, store: false });
    let result;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      if (signal?.aborted) throw new Error('Canceled.');
      const started = Date.now();
      let response;
      try {
        response = await this.fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs),
          body: requestBody,
        });
      } catch (error) {
        if (signal?.aborted) throw new Error('Canceled.');
        if (error.name === 'TimeoutError') throw new Error('OpenAI timed out. Check your connection and retry.');
        throw new Error(`OpenAI could not be reached: ${error.message}`);
      }
      this.log({ attempt, status: response.status, ms: Date.now() - started });
      try { result = await response.json(); }
      catch { throw new Error(`OpenAI returned an unreadable response (HTTP ${response.status}).`); }
      if (response.ok) break;
      if (isRetryable(response) && attempt < this.maxAttempts) {
        const backoff = this.retryDelayMs * (2 ** (attempt - 1));
        const jitter = Math.floor(this.randomImpl() * Math.min(250, this.retryDelayMs));
        await this.sleepImpl(backoff + jitter);
        if (signal?.aborted) throw new Error('Canceled.');
        continue;
      }
      if (response.status >= 500 && attempt === this.maxAttempts) {
        const detail = result?.error?.message || `HTTP ${response.status}`;
        throw new Error(`OpenAI is still unavailable after ${this.maxAttempts} attempts. Wait a minute and retry. (${detail})`);
      }
      throw new Error(apiErrorMessage(response, result, body.model, setting));
    }
    this.log({ response: {
      status: result.status ?? null,
      incomplete: result.incomplete_details?.reason ?? null,
      usage: result.usage ?? null,
      outputTypes: Array.isArray(result.output) ? result.output.map(item => item.type) : [],
    } });
    if (result.status === 'failed' || result.error) {
      throw new Error(`OpenAI failed on ${task}: ${result.error?.message || 'unknown error'}`);
    }
    if (result.status === 'incomplete') {
      const reason = result.incomplete_details?.reason || 'unknown reason';
      throw new Error(`OpenAI returned an incomplete response for ${task} (${reason}). Try again.`);
    }
    return result;
  }
}

module.exports = { OpenAiClient, modelSettings, apiErrorMessage, redactSecret, outputText, DEFAULT_MODEL };
