// Main-process generation of one validated 4/4 fill through GPT-5.6 Luna.
const { outputText, modelSettings } = require('./openai-client.cjs');
const { unsupportedClaims } = require('../js/agent-contract.js');
const { DRUMS } = require('../js/constants.js');
const { validateGeneratedFill } = require('../js/exercise-search.js');

const MODEL = 'gpt-5.6-luna';
const SUBDIVISIONS = ['8th', '16th', 'triplet 8th'];
const LEVELS = ['beginner', 'intermediate', 'advanced'];
const DURATIONS = ['32', '16', '8', 'q', 'h', 'w'];
const DRUM_NAMES = Object.keys(DRUMS);

const NOTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    duration: { type: 'string', enum: DURATIONS },
    dotted: { type: 'boolean' },
    triplet: { type: 'boolean' },
    drums: { type: 'array', items: { type: 'string', enum: DRUM_NAMES }, minItems: 0 },
  },
  required: ['duration', 'dotted', 'triplet', 'drums'],
};

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    notes: { type: 'array', minItems: 1, items: NOTE_SCHEMA },
    idea: { type: 'string' },
  },
  required: ['notes', 'idea'],
};

const INSTRUCTIONS = `You make one original 4/4 drum fill for DrumHub, a drum-score app for young drummers.
Make exactly one complete bar. Suit the requested level, tempo, subdivision, and style.
Use only these drums: ${DRUM_NAMES.join(', ')}. Use only these durations: ${DURATIONS.join(', ')}.
Rests have an empty drums list.
Do not copy a song, famous beat, or another person's fill. Return JSON only.
The local checker will reject a bar that does not fill exactly one 4/4 bar.`;

const requestError = message => ({ error: message });

function validateRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return 'Fill settings could not be read.';
  const tempo = request.tempoBpm;
  if (!Number.isInteger(tempo) || tempo < 40 || tempo > 220) return 'Tempo must be a whole number from 40 to 220 BPM.';
  if (!SUBDIVISIONS.includes(request.subdivision)) return `Subdivision must be one of ${SUBDIVISIONS.join(', ')}.`;
  if (!LEVELS.includes(request.level)) return `Level must be beginner, intermediate, or advanced.`;
  if (typeof request.style !== 'string' || request.style.length > 20) return 'Style must be 20 characters or fewer.';
  if (request.bars !== 1) return 'A new fill must be exactly one bar.';
  return null;
}

function cleanNotes(notes) {
  return notes.map(note => {
    if (!note || typeof note !== 'object' || Array.isArray(note)) return note;
    const { triplet, ...rest } = note;
    return triplet === true ? { ...rest, triplet: true } : rest;
  });
}

function parseReply(body) {
  const text = outputText(body, 'the generated fill');
  if (!text) throw new Error('GPT-5.6 Luna returned an empty fill.');
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error('GPT-5.6 Luna returned invalid fill JSON.'); }
  if (!parsed || !Array.isArray(parsed.notes) || typeof parsed.idea !== 'string') {
    throw new Error('GPT-5.6 Luna returned a fill with missing fields.');
  }
  return parsed;
}

class FillGenerator {
  constructor({ client, model = modelSettings().agent, cloudEnabled = () => false } = {}) {
    this.client = client;
    this.model = model;
    this.cloudEnabled = cloudEnabled;
  }

  async generate(request) {
    try {
      const problem = validateRequest(request);
      if (problem) return requestError(problem);
      if (!this.cloudEnabled()) return requestError('Making a new fill uses GPT-5.6 Luna, so an adult needs to turn on cloud help first.');
      if (!this.client || typeof this.client.createResponse !== 'function') return requestError('Cloud help is not ready.');

      const base = {
        model: this.model,
        instructions: INSTRUCTIONS,
        reasoning: { effort: 'low' },
        store: false,
        input: [{ role: 'user', content: [{ type: 'input_text', text:
          `Tempo: ${request.tempoBpm} BPM. Subdivision: ${request.subdivision}. Level: ${request.level}. Style: ${request.style}. Bars: 1.` }] }],
        text: { format: { type: 'json_schema', name: 'drumhub_generated_fill', strict: true, schema: RESPONSE_SCHEMA } },
      };
      let body = await this.client.createResponse(base, { task: 'the generated fill', setting: 'OPENAI_AGENT_MODEL' });
      let parsed = parseReply(body);
      let notes = cleanNotes(parsed.notes);
      let checked = validateGeneratedFill(notes);
      if (!checked.ok) {
        const problems = checked.errors.join('; ');
        body = await this.client.createResponse({ ...base, input: [...base.input, {
          role: 'user', content: [{ type: 'input_text', text:
            `The local DrumHub check found these problems: ${problems}. Repair the JSON so it is one complete 4/4 bar. Return the corrected fill only.` }],
        }] }, { task: 'the repaired generated fill', setting: 'OPENAI_AGENT_MODEL' });
        parsed = parseReply(body);
        notes = cleanNotes(parsed.notes);
        checked = validateGeneratedFill(notes);
      }
      if (!checked.ok) return requestError(`The new fill did not pass DrumHub's check: ${checked.errors.join('; ')}`);
      // The idea is shown to young drummers: drop it if it claims sticking, hands or dynamics.
      const idea = unsupportedClaims(parsed.idea).length ? '' : parsed.idea.slice(0, 300);
      return {
        notes,
        idea,
        checks: ['One complete 4/4 bar.', 'Only supported drums and note lengths.', 'Checked by DrumHub.'],
        model: this.model,
      };
    } catch (error) {
      return requestError(error instanceof Error ? error.message : String(error));
    }
  }
}

module.exports = { FillGenerator, RESPONSE_SCHEMA, NOTE_SCHEMA, INSTRUCTIONS, MODEL };
