// ── Deterministic exercise and fill retrieval ─────────────────────────────────
// Retrieval is deliberately small and inspectable. Structured filters remove
// unsuitable material first; a lowercase word overlap then gives a stable rank.

import { BAR_TICKS } from './constants.js';
import { importBarsCommand } from './commands.js';
import { barTicks } from './bar.js';
import { createMeta, manualProvenance, toDocument, validateDocument, withIds } from './score-document.js';
import { EXERCISES, FILLS } from './exercise-catalogue.js';

const LEVELS = ['beginner', 'intermediate', 'advanced'];
const DRUM_TOM_NAMES = new Set(['tom_hi', 'tom_mid', 'floor_tom_1', 'floor_tom_2']);
const FOOT_NAMES = new Set(['kick', 'hi_hat_pedal']);

// Larger numbers mean a finer written subdivision. Triplet and dotted labels
// share a depth with the plain note that occupies the same small beat space.
const SUBDIVISION_DEPTH = Object.freeze({
  whole: 0, half: 0, quarter: 1, 'dotted quarter': 1,
  '8th': 2, 'dotted 8th': 2, 'triplet 8th': 2,
  '16th': 3, 'dotted 16th': 3, 'triplet 16th': 3,
  '32nd': 4,
});

const words = value => new Set(String(value ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? []);
const list = value => value === undefined ? [] : (Array.isArray(value) ? value : [value]);
const englishList = values => values.length === 1 ? values[0] : `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`;

function lexicalWords(item) {
  return words([
    item.title, item.description, ...(item.goals ?? []), ...(item.styles ?? []),
  ].join(' '));
}

function matchingWords(text, item) {
  const requested = words(text);
  return [...requested].filter(word => lexicalWords(item).has(word)).sort();
}

function matchesStructured(item, query) {
  if (query.level !== undefined && item.level !== query.level) return false;
  if (query.kind !== undefined && item.kind !== query.kind) return false;
  if (query.subdivision !== undefined && item.subdivision !== query.subdivision) return false;
  if (query.maxTempo !== undefined && item.tempo.max > Number(query.maxTempo)) return false;
  for (const field of ['styles', 'goals', 'limbs']) {
    const requested = list(query[field]);
    if (requested.length && !requested.every(value => item[field].includes(value))) return false;
  }
  return true;
}

function searchReasons(item, query, overlap) {
  const reasons = [];
  if (query.level !== undefined) reasons.push(`level is ${item.level}`);
  if (query.kind !== undefined) reasons.push(`it is a ${item.kind}`);
  if (query.styles !== undefined) reasons.push(`style includes ${englishList(list(query.styles))}`);
  if (query.subdivision !== undefined) reasons.push(`uses ${item.subdivision} subdivision`);
  if (query.goals !== undefined) reasons.push(`goal includes ${englishList(list(query.goals))}`);
  if (query.limbs !== undefined) reasons.push(`notation keeps ${englishList(list(query.limbs))} busy`);
  if (query.maxTempo !== undefined) reasons.push(`target tempo is ${item.tempo.target} BPM`);
  if (overlap.length) reasons.push(`text matches ${englishList(overlap)}`);
  return reasons;
}

// ── Exercise retrieval ────────────────────────────────────────────────────────

export function searchExercises(query = {}, { catalogue = EXERCISES } = {}) {
  const safeQuery = query && typeof query === 'object' ? query : {};
  const textRequested = words(safeQuery.text).size > 0;
  return catalogue.filter(item => matchesStructured(item, safeQuery)).map(item => {
    const overlap = matchingWords(safeQuery.text, item);
    const structuredMatches = ['level', 'kind', 'styles', 'subdivision', 'goals', 'limbs', 'maxTempo']
      .filter(field => safeQuery[field] !== undefined).length;
    // Structured matches remain visible in the score, while text overlap is the
    // differentiator for a free-form query. No locale-dependent comparison is used.
    const score = structuredMatches * 10 + overlap.length * 5;
    return { id: item.id, title: item.title, score, overlap, reasons: searchReasons(item, safeQuery, overlap) };
  }).filter(result => !textRequested || result.overlap.length > 0)
    .map(({ overlap, ...result }) => result)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

// ── Passage-to-exercise retrieval ─────────────────────────────────────────────

function inspectionBars(analysis) {
  if (Array.isArray(analysis?.bars)) return analysis.bars;
  if (Array.isArray(analysis?.inspection?.bars)) return analysis.inspection.bars;
  return [];
}

function rankedFacts(analysis, options) {
  const ranked = analysis?.ranked ?? analysis?.complexity?.ranked ?? options?.ranked ?? [];
  return Array.isArray(ranked) ? ranked : [];
}

// Hits whose count is not on a beat or "&" ("1e", "2a", "3trip", "4 (32nd)"). Only the
// count label is read: duration names such as "quarter" also contain the letter a.
function offBeatCount(bar) {
  return (bar.events ?? []).filter(event => !event.isRest && /^\d+(?:e|a|trip|let| \(32nd\)| \(triplet 16th\))$/.test(event.count)).length;
}

function passageFacts(analysis, options) {
  const bars = inspectionBars(analysis);
  const ranked = rankedFacts(analysis, options);
  const numbers = bars.map(bar => bar.barNumber).filter(Number.isInteger);
  const factBars = new Map();
  const add = (key, number) => {
    if (!factBars.has(key)) factBars.set(key, []);
    if (!factBars.get(key).includes(number)) factBars.get(key).push(number);
  };
  let smallest = null;
  for (const bar of bars) {
    if (bar.smallestNote && (smallest === null || (SUBDIVISION_DEPTH[bar.smallestNote] ?? 0) > (SUBDIVISION_DEPTH[smallest] ?? 0))) {
      smallest = bar.smallestNote;
    }
    if (bar.smallestNote) add('subdivision', bar.barNumber);
    if (bar.tripletGroups > 0) add('triplets', bar.barNumber);
    if (bar.rests > 0) add('reading rests', bar.barNumber);
    const events = bar.events ?? [];
    if (events.some(event => event.drums.some(drum => FOOT_NAMES.has(drum)) && event.drums.some(drum => !FOOT_NAMES.has(drum)))) {
      add('kick independence', bar.barNumber);
    }
    if (offBeatCount(bar) >= 2) add('syncopation', bar.barNumber);
    if (events.some(event => event.drums.some(drum => DRUM_TOM_NAMES.has(drum)))) add('tom movement', bar.barNumber);
  }

  // Ranked complexity entries add useful evidence when callers pass them beside
  // inspectBars. They do not invent a subdivision or a bar that was not inspected.
  for (const entry of ranked) {
    if (!numbers.includes(entry.barNumber)) continue;
    const reasonText = (entry.reasons ?? []).join(' ').toLowerCase();
    if (entry.signals?.triplets || reasonText.includes('including triplets')) add('triplets', entry.barNumber);
    if (entry.signals?.syncopation >= 0.2 || reasonText.includes('off-beat')) add('syncopation', entry.barNumber);
    if (reasonText.includes('tom')) add('tom movement', entry.barNumber);
    if (entry.signals?.coordination >= 0.1 || reasonText.includes('kick or hi-hat pedal')) add('kick independence', entry.barNumber);
  }
  for (const values of factBars.values()) values.sort((a, b) => a - b);
  return { bars, numbers, smallest, factBars, ranked };
}

function citedBarReason(numbers, phrase) {
  if (!numbers.length) return null;
  return numbers.map(number => `bar ${number} ${phrase}`).join('; ');
}

export function exercisesForPassage(analysis, options = {}) {
  const { bars, numbers, smallest, factBars, ranked } = passageFacts(analysis, options);
  const catalogue = options.catalogue ?? EXERCISES;
  const extra = {};
  if (options.level !== undefined) extra.level = options.level;
  if (options.style !== undefined) extra.styles = [options.style];
  const queries = [];
  if (smallest) queries.push({ ...extra, subdivision: smallest });
  for (const goal of [...factBars.keys()].filter(key => key !== 'subdivision')) {
    queries.push({ ...extra, ...(smallest ? { subdivision: smallest } : {}), goals: [goal] });
  }
  if (!queries.length) queries.push(extra);

  const byId = new Map();
  for (const query of queries) {
    for (const result of searchExercises(query, { catalogue })) {
      const item = catalogue.find(candidate => candidate.id === result.id);
      const matchedFacts = [...factBars.entries()].filter(([factGoal, cited]) =>
        item?.goals?.some(itemGoal => cited.length && itemGoal === factGoal))
        .map(([goal]) => goal);
      const old = byId.get(result.id);
      const score = Math.max(old?.score ?? -Infinity, result.score) + matchedFacts.length * 3;
      byId.set(result.id, { ...result, score, matchedFacts: [...new Set([...(old?.matchedFacts ?? []), ...matchedFacts])] });
    }
  }

  const factReasons = [];
  if (smallest) factReasons.push(citedBarReason(numbers.filter(number => bars.find(b => b.barNumber === number)?.smallestNote === smallest), `uses ${smallest} notes`));
  for (const [goal, cited] of factBars) {
    if (goal === 'subdivision') continue;
    const phrases = {
      triplets: 'uses triplets',
      'kick independence': 'has a kick or hi-hat pedal together with another drum',
      syncopation: `has ${cited.length === 1 ? 'off-beat hits' : 'many off-beat hits'}`,
      'reading rests': 'has rests to count',
      'tom movement': 'uses toms',
    };
    if (phrases[goal]) factReasons.push(citedBarReason(cited, phrases[goal]));
  }
  for (const entry of ranked.filter(item => numbers.includes(item.barNumber)).slice(0, 3)) {
    if (entry.score >= 40) factReasons.push(`bar ${entry.barNumber} is a busy passage (notation score ${entry.score})`);
  }
  return [...byId.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 3).map(({ matchedFacts, ...result }) => ({
      ...result,
      reasons: [...result.reasons, ...factReasons.filter(Boolean)],
    }));
}

// ── Existing fill recommendations ─────────────────────────────────────────────

function fillLevelAllowed(fillLevel, requestedLevel) {
  const requested = LEVELS.indexOf(requestedLevel);
  const candidate = LEVELS.indexOf(fillLevel);
  return requested >= 0 && candidate >= 0 && candidate <= requested && candidate >= requested - 1;
}

function fillSubdivisionAllowed(fillSubdivision, requestedSubdivision) {
  const candidate = SUBDIVISION_DEPTH[fillSubdivision];
  const requested = SUBDIVISION_DEPTH[requestedSubdivision];
  return candidate !== undefined && requested !== undefined && candidate <= requested;
}

export function recommendFills({ tempoBpm, subdivision, level, style, bars = 1 } = {}, { catalogue = FILLS } = {}) {
  const tempo = Number(tempoBpm);
  if (!Number.isFinite(tempo) || !subdivision || !level || bars !== 1) return [];
  return catalogue.filter(item => item.kind === 'fill' && item.bars.length === 1 &&
    fillLevelAllowed(item.level, level) && item.tempo.min <= tempo && tempo <= item.tempo.max &&
    fillSubdivisionAllowed(item.subdivision, subdivision)).map(item => {
    const styleMatch = style !== undefined && item.styles.includes(style);
    const distance = Math.abs(item.tempo.target - tempo);
    const score = (styleMatch ? 100 : 0) + Math.max(0, 50 - distance);
    const reasons = [
      ...(style === undefined ? [] : [styleMatch ? `matches ${style} style` : `not written for ${style}, but fits the tempo and level`]),
      `tempo ${tempo} BPM is inside its ${item.tempo.min}–${item.tempo.max} BPM range`,
      item.level === level ? `level is ${level}` : `level ${item.level} is one step easier than ${level}`,
      `uses ${item.subdivision}, no finer than the requested ${subdivision}`,
    ];
    return { id: item.id, title: item.title, score, reasons };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 3);
}

// ── Model-proposed fill validation ────────────────────────────────────────────

const cloneForValidation = notes => (Array.isArray(notes) ? notes.map(note => {
  if (!note || typeof note !== 'object' || Array.isArray(note)) return { invalidNote: note };
  return { ...note, ...(Array.isArray(note.drums) ? { drums: [...note.drums] } : {}) };
}) : []);

export function validateGeneratedFill(notes) {
  const listError = Array.isArray(notes) ? [] : ['Fill notes must be a list'];
  const rawNotes = cloneForValidation(notes);
  const idFactory = (() => {
    let next = 0;
    return () => `generated-fill-${++next}`;
  })();
  let bar = { notes: rawNotes };
  let errors = [...listError];
  try {
    bar = withIds([bar], idFactory)[0];
    const document = toDocument(createMeta({ idFactory, title: 'Generated fill', tempoBpm: 90 }), [bar]);
    errors = [...errors, ...validateDocument(document)];
    if (!errors.length && barTicks(bar) !== BAR_TICKS) errors.push('Fill must fill one complete 4/4 bar');
  } catch (error) {
    errors.push(`Fill could not be checked: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ok: errors.length === 0, errors, bar };
}

// ── One-edit exercise insertion ───────────────────────────────────────────────

function copiedBars(item) {
  if (!Array.isArray(item?.bars)) return [];
  return item.bars.map(fragment => ({
    notes: Array.isArray(fragment.notes) ? fragment.notes.map(note => {
      const { eventId, ...withoutId } = note;
      return { ...withoutId, drums: Array.isArray(note.drums) ? [...note.drums] : note.drums };
    }) : [],
  }));
}

export function insertExerciseCommand(item, { atEnd = true } = {}) {
  const copies = copiedBars(item).map(bar => ({ bar, provenance: manualProvenance() }));
  if (atEnd) return importBarsCommand(copies);
  return {
    label: `Insert exercise: ${item?.title ?? 'Untitled'}`,
    run: editor => {
      if (!copies.length) return null;
      const empty = editor.bars.length === 1 && editor.bars[0].notes.length === 0;
      const insertAt = empty ? 0 : Math.max(0, Math.min(editor.bars.length, editor.cursor.barIndex));
      const imported = copies.map(({ bar, provenance }) => ({ provenance, notes: bar.notes }));
      const bars = empty ? imported : [...editor.bars.slice(0, insertAt), ...imported, ...editor.bars.slice(insertAt)];
      return { bars, cursor: { ...editor.cursor, barIndex: insertAt, noteIndex: 0, position: 1 } };
    },
  };
}
