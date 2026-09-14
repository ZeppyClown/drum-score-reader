// ── Ask DrumHub tools ─────────────────────────────────────────────────────────
// The read-only tools a model may call. Each runs the deterministic analysis in
// score-analysis.js on the validated snapshot, so every score fact in an answer comes
// from local code (plan §5). Pure: shared by Electron main, the offline answers, and
// the evaluation harness.
//
// Definitions use the Responses API function format with strict schemas: every
// property is required and optional values are nullable.

import {
  getScoreOverview, inspectBars, findComplexPassages, findPatterns, comparePassages,
  buildPracticePlan, findFillCandidates,
} from './score-analysis.js';

export const MAX_INSPECT_BARS = 8;
const MAX_OUTPUT_CHARS = 20000;

const int = description => ({ type: 'integer', description });
const nullable = (type, description) => ({ type: [type, 'null'], description });

function tool(name, description, properties = {}) {
  return {
    type: 'function', name, description, strict: true,
    parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
  };
}

export const TOOL_DEFINITIONS = [
  tool('get_score_overview', 'Bars, tempo, meter, length, drums used, shortest note, rests, chords, triplets and unchecked imported bars for the shared part of the score.'),
  tool('inspect_bars', `Beat-by-beat notes for up to ${MAX_INSPECT_BARS} bars: the count for each note, drums, rests, chords, note lengths, the spoken counting, and what changed from the bar before.`,
    { fromBar: int('First bar number (1-based).'), toBar: int('Last bar number, inclusive.') }),
  tool('find_complex_passages', 'Bars ranked by notation complexity (0–100) with the signals and plain reasons behind each score. This is about the notes, not about a particular student.',
    { top: nullable('integer', 'How many top bars to group into passages (default 3).') }),
  tool('find_patterns', 'Bars that repeat exactly, and pairs of bars that are nearly the same, with the hits that differ.',
    { threshold: nullable('number', 'Similarity from 0.5 to 1 for near repeats (default 0.75).') }),
  tool('compare_passages', 'How one bar differs from another: similarity, hits added and removed, drums added and removed, and note-length changes.',
    { barA: int('First bar number.'), barB: int('Second bar number.') }),
  tool('find_fill_candidates', 'Bars that might be fills or transitions, with the reasons. These are candidates, not confirmed fills.'),
  tool('build_practice_plan', 'A step-by-step practice plan for a bar range, with tempos and a success condition for each step.',
    { fromBar: int('First bar number.'), toBar: int('Last bar number, inclusive.') }),
];

export const TOOL_NAMES = TOOL_DEFINITIONS.map(t => t.name);

const isInt = v => Number.isInteger(v);

// Runs one tool call. rawArguments is the model's JSON string. Never throws: bad calls
// return { error } so the model can correct itself.
export function runTool(name, rawArguments, snapshot) {
  let args;
  try { args = rawArguments ? JSON.parse(rawArguments) : {}; }
  catch { return { error: 'Arguments were not valid JSON.' }; }
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return { error: 'Arguments must be an object.' };
  const range = `Bars ${snapshot.range.fromBar}–${snapshot.range.toBar} are available.`;
  switch (name) {
    case 'get_score_overview':
      return getScoreOverview(snapshot);
    case 'inspect_bars': {
      if (!isInt(args.fromBar) || !isInt(args.toBar)) return { error: `fromBar and toBar must be whole bar numbers. ${range}` };
      const from = Math.min(args.fromBar, args.toBar);
      const to = Math.min(Math.max(args.fromBar, args.toBar), from + MAX_INSPECT_BARS - 1);
      const result = inspectBars(snapshot, { fromBar: from, toBar: to });
      if (!result.bars?.length) return { error: `None of those bars are available. ${range}` };
      return { ...result, ...(to < Math.max(args.fromBar, args.toBar) ? { note: `Only the first ${MAX_INSPECT_BARS} bars were inspected; ask for the rest separately.` } : {}) };
    }
    case 'find_complex_passages':
      return findComplexPassages(snapshot, { top: isInt(args.top) && args.top >= 1 && args.top <= 10 ? args.top : 3 });
    case 'find_patterns': {
      const threshold = typeof args.threshold === 'number' && args.threshold >= 0.5 && args.threshold <= 1 ? args.threshold : 0.75;
      return findPatterns(snapshot, { threshold });
    }
    case 'compare_passages':
      if (!isInt(args.barA) || !isInt(args.barB)) return { error: `barA and barB must be whole bar numbers. ${range}` };
      return comparePassages(snapshot, args.barA, args.barB);
    case 'find_fill_candidates':
      return findFillCandidates(snapshot);
    case 'build_practice_plan':
      if (!isInt(args.fromBar) || !isInt(args.toBar)) return { error: `fromBar and toBar must be whole bar numbers. ${range}` };
      return buildPracticePlan(snapshot, { fromBar: args.fromBar, toBar: args.toBar });
    default:
      return { error: `Unknown tool "${name}". Available tools: ${TOOL_NAMES.join(', ')}.` };
  }
}

// Ids can come from an opened file, so they never go to the model: bar numbers are
// enough, and main maps references back to ids itself.
const ID_KEYS = new Set(['barId', 'eventId', 'fromBarId', 'toBarId']);
const withoutIds = value => (Array.isArray(value) ? value.map(withoutIds)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([k]) => !ID_KEYS.has(k)).map(([k, v]) => [k, withoutIds(v)]))
    : value);

// JSON text for a function_call_output, without ids, bounded so one call cannot flood the context.
export function toolOutput(result) {
  const text = JSON.stringify(withoutIds(result));
  return text.length <= MAX_OUTPUT_CHARS ? text
    : JSON.stringify({ error: 'That result was too large. Ask about fewer bars.' });
}
