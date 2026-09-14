const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const ENDPOINT = 'https://api.openai.com/v1/responses';
const DRUMS = [
  'kick', 'hi_hat_pedal', 'floor_tom_2', 'floor_tom_1', 'snare', 'snare_rim',
  'tom_mid', 'tom_hi', 'hi_hat_closed', 'hi_hat_open_half', 'hi_hat_open_full',
  'crash', 'ride', 'ride_bell',
];
const DURATIONS = [
  'whole', 'half', 'dotted_quarter', 'quarter', 'dotted_eighth', 'eighth',
  'sixteenth', 'thirty_second', 'triplet_eighth', 'triplet_sixteenth',
];
const sleep = delay => new Promise(resolve => setTimeout(resolve, delay));

const RESPONSE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    gridSlots: { type: 'integer', enum: [32] },
    status: { type: 'string', enum: ['ok', 'needs_crop'] },
    message: { type: 'string', description: 'Empty for ok; crop guidance when needs_crop.' },
    notes: {
      type: 'array', description: 'One entry per onset, strictly ordered by position.',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          position: { type: 'integer', minimum: 0, maximum: 31 },
          duration: { type: 'string', enum: DURATIONS },
          drums: { type: 'array', minItems: 1,
            items: { type: 'string', enum: DRUMS } },
        },
        required: ['position', 'duration', 'drums'],
      },
    },
    uncertainties: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          position: { type: 'integer', minimum: 0, maximum: 31 },
          reason: { type: 'string' },
        },
        required: ['position', 'reason'],
      },
    },
  },
  required: ['schemaVersion', 'gridSlots', 'status', 'message', 'notes', 'uncertainties'],
};

const PROMPT = `Transcribe the attached image as exactly one 4/4 drum-notation bar.
If it is not one readable cropped bar, set status to needs_crop, explain how to crop it in
message, and return empty notes and uncertainties. Otherwise set status to ok and message
to an empty string.

Positions are integers 0-31 counting 32nd-note slots from the start: beats 1, 2, 3, 4 are
0, 8, 16, 24. Combine simultaneous hits into one drums array. Omit rests and silent slots.
Read flags, beams, dots, and tuplets. Round triplet positions to the nearest slot while
keeping strictly increasing positions.

Project notation: kick is the normal head below the staff; pedal hi-hat is the low x;
floor_tom_2 and floor_tom_1 are the two lowest normal tom heads; snare is the normal head
on the middle line; snare_rim is an x at snare height; tom_mid and tom_hi are the next two
normal heads upward; closed hi-hat is an upper x; half-open hi-hat is a triangle; open
hi-hat is circle-x; crash is a high x below the ride; ride is the highest x; ride bell is
a diamond at ride height. Prefer an image legend if present. Fold ghost dynamics into the
base drum. Unsupported instruments or notation should be omitted and described in
uncertainties. Recheck tom height, ride versus crash, open versus closed hi-hat, dotted
eighths, and triplets before answering. Never invent an unreadable hit.`;

function validateResult(result) {
  if (!result || result.schemaVersion !== 1 || result.gridSlots !== 32 ||
      !['ok', 'needs_crop'].includes(result.status) || !Array.isArray(result.notes) ||
      !Array.isArray(result.uncertainties) || typeof result.message !== 'string') {
    throw new Error('OpenAI returned an invalid transcription. Try the screenshot again.');
  }
  if (result.status === 'needs_crop') {
    throw new Error(result.message || 'Crop the screenshot to one readable 4/4 bar and retry.');
  }
  return result;
}

function apiErrorMessage(response, body, model) {
  const detail = body?.error?.message || `HTTP ${response.status}`;
  const code = body?.error?.code || '';
  if (response.status === 401 || code === 'invalid_api_key') {
    return `The OpenAI API key is invalid. Check OPENAI_API_KEY and restart the app. (${detail})`;
  }
  if (response.status === 403) {
    return `This API key is not allowed to use ${model}. Check the key's project permissions. (${detail})`;
  }
  if (response.status === 404 || code === 'model_not_found') {
    return `The OpenAI model is unavailable to this API key. Check OPENAI_MODEL and project access. (${detail})`;
  }
  if (response.status === 429) {
    return `The OpenAI quota or rate limit was reached. Wait briefly or check the project's limits. (${detail})`;
  }
  if (response.status === 400 || response.status === 422) {
    return `OpenAI rejected the request configuration. (${detail})`;
  }
  return `OpenAI API request failed. (${detail})`;
}

function isRetryable(response) {
  return [408, 409, 429].includes(response.status) || response.status >= 500;
}

function outputText(body) {
  const content = body?.output?.flatMap(item => item.content || []) || [];
  const refusal = content.find(item => item.type === 'refusal')?.refusal;
  if (refusal) throw new Error(`OpenAI refused the screenshot: ${refusal}`);
  return content.filter(item => item.type === 'output_text').map(item => item.text || '').join('');
}

// Real keys are long; very short test placeholders are left alone so they cannot mangle text.
function redactSecret(text, secret) {
  return secret && secret.length >= 8 ? String(text).split(secret).join('[redacted]') : String(text);
}

class OpenAiOmr {
  constructor({ apiKey = process.env.OPENAI_API_KEY, model = MODEL, fetchImpl = fetch,
    timeoutMs = 60000, maxAttempts = 3, retryDelayMs = 1000, sleepImpl = sleep,
    randomImpl = Math.random } = {}) {
    Object.assign(this, { apiKey, model, fetchImpl, timeoutMs, maxAttempts, retryDelayMs,
      sleepImpl, randomImpl });
  }

  // Every message leaving this class passes through redact(), so an API or network error
  // that echoes the key can never show it in the UI or logs.
  async recognize(png) {
    try { return await this.recognizeUnredacted(png); }
    catch (error) { throw new Error(redactSecret(error.message, this.apiKey), { cause: error.name }); }
  }

  async recognizeUnredacted(png) {
    if (!this.apiKey) {
      throw new Error('OpenAI is not configured. Quit the app and restart it with OPENAI_API_KEY set.');
    }
    if (!Buffer.isBuffer(png) || !png.length) throw new Error('Copy a PNG screenshot, then retry.');
    if (png.length > 20 * 1024 * 1024) throw new Error('The clipboard image is over 20 MB. Crop it to one bar and retry.');
    const requestBody = JSON.stringify({
      model: this.model,
      store: false,
      reasoning: { effort: 'medium' },
      max_output_tokens: 4096,
      input: [{ role: 'user', content: [
        { type: 'input_text', text: PROMPT },
        { type: 'input_image', image_url: `data:image/png;base64,${png.toString('base64')}`,
          detail: 'original' },
      ] }],
      text: { format: {
        type: 'json_schema', name: 'drum_bar_transcription', strict: true,
        schema: RESPONSE_SCHEMA,
      } },
    });
    let body;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      let response;
      try {
        response = await this.fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
          signal: AbortSignal.timeout(this.timeoutMs),
          body: requestBody,
        });
      } catch (error) {
        if (error.name === 'TimeoutError') throw new Error('OpenAI timed out. Check your connection and retry.');
        throw new Error(`OpenAI could not be reached: ${error.message}`);
      }
      try { body = await response.json(); }
      catch { throw new Error(`OpenAI returned an unreadable response (HTTP ${response.status}).`); }
      if (response.ok) break;
      if (isRetryable(response) && attempt < this.maxAttempts) {
        const backoff = this.retryDelayMs * (2 ** (attempt - 1));
        const jitter = Math.floor(this.randomImpl() * Math.min(250, this.retryDelayMs));
        await this.sleepImpl(backoff + jitter);
        continue;
      }
      if (response.status >= 500 && attempt === this.maxAttempts) {
        const detail = body?.error?.message || `HTTP ${response.status}`;
        throw new Error(`OpenAI is still unavailable after ${this.maxAttempts} attempts. Wait a minute and retry. (${detail})`);
      }
      throw new Error(apiErrorMessage(response, body, this.model));
    }
    if (body.status === 'failed' || body.error) {
      throw new Error(`OpenAI failed to transcribe the screenshot: ${body.error?.message || 'unknown error'}`);
    }
    if (body.status === 'incomplete') {
      const reason = body.incomplete_details?.reason || 'unknown reason';
      throw new Error(`OpenAI returned an incomplete transcription (${reason}). Try again.`);
    }
    const text = outputText(body);
    if (!text) throw new Error('OpenAI returned no transcription. Try a clearer one-bar crop.');
    let result;
    try { result = JSON.parse(text); }
    catch { throw new Error('OpenAI returned invalid transcription JSON. Try the screenshot again.'); }
    return { ...validateResult(result), model: this.model };
  }
}

module.exports = { OpenAiOmr, RESPONSE_SCHEMA, apiErrorMessage, redactSecret };
