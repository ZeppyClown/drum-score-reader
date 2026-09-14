const { OpenAiClient, modelSettings, apiErrorMessage, redactSecret, outputText } = require('./openai-client.cjs');

const DRUMS = [
  'kick', 'hi_hat_pedal', 'floor_tom_2', 'floor_tom_1', 'snare', 'snare_rim',
  'tom_mid', 'tom_hi', 'hi_hat_closed', 'hi_hat_open_half', 'hi_hat_open_full',
  'crash', 'ride', 'ride_bell',
];
const DURATIONS = [
  'whole', 'half', 'dotted_quarter', 'quarter', 'dotted_eighth', 'eighth',
  'sixteenth', 'thirty_second', 'triplet_eighth', 'triplet_sixteenth',
];

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

// Luna counts its hidden reasoning against max_output_tokens. On busy bars it used
// all of the old 4,096 on reasoning and never wrote the JSON (2026-09-14), and answers
// took 30–60 s. OpenAI recommends reserving about 25,000 tokens for reasoning; at
// $1.20 per million output tokens that is at most about 3 cents per screenshot.
const MAX_OUTPUT_TOKENS = 25000;
const IMPORT_TIMEOUT_MS = 180000;

// Screenshot → one bar of notes, through the shared OpenAI transport.
class OpenAiOmr {
  constructor({ apiKey = process.env.OPENAI_API_KEY, model = modelSettings().omr, client, timeoutMs = IMPORT_TIMEOUT_MS, ...transport } = {}) {
    this.model = model;
    this.client = client ?? new OpenAiClient({ apiKey, timeoutMs, ...transport });
  }

  async recognize(png) {
    if (!this.client.configured) {
      throw new Error('OpenAI is not configured. Quit the app and restart it with OPENAI_API_KEY set.');
    }
    if (!Buffer.isBuffer(png) || !png.length) throw new Error('Copy a PNG screenshot, then retry.');
    if (png.length > 20 * 1024 * 1024) throw new Error('The clipboard image is over 20 MB. Crop it to one bar and retry.');
    const body = await this.client.createResponse({
      model: this.model,
      reasoning: { effort: 'medium' },
      max_output_tokens: MAX_OUTPUT_TOKENS,
      input: [{ role: 'user', content: [
        { type: 'input_text', text: PROMPT },
        { type: 'input_image', image_url: `data:image/png;base64,${png.toString('base64')}`, detail: 'original' },
      ] }],
      text: { format: { type: 'json_schema', name: 'drum_bar_transcription', strict: true, schema: RESPONSE_SCHEMA } },
    }, { task: 'the screenshot', setting: 'OPENAI_OMR_MODEL' });
    let text;
    try { text = outputText(body, 'the screenshot'); }
    catch (error) { throw new Error(redactSecret(error.message, this.client.apiKey)); }
    if (!text) throw new Error('OpenAI returned no transcription. Try a clearer one-bar crop.');
    let result;
    try { result = JSON.parse(text); }
    catch { throw new Error('OpenAI returned invalid transcription JSON. Try the screenshot again.'); }
    return { ...validateResult(result), model: this.model };
  }
}

module.exports = { OpenAiOmr, RESPONSE_SCHEMA, apiErrorMessage, redactSecret, MAX_OUTPUT_TOKENS, IMPORT_TIMEOUT_MS };
