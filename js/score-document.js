// ── Versioned score document ──────────────────────────────────────────────────
// The saved form of a score: metadata plus the editor's bars, with a stable id on
// every bar and note so saved files, undo history, and later agent citations can
// point at the same thing after edits. Pure: no state, DOM, or VexFlow, so it is
// tested in Node and shared with Electron main for file validation.
//
// A document is { schemaVersion, scoreId, revision, title, tempoBpm, meter, bars }.
// Each bar is { barId, provenance, notes } and each note is the editor's usual
// { duration, dotted, triplet?, drums } plus an `eventId`. state.js keeps the
// metadata (`state.meta`) and the bars (`state.bars`) side by side; toDocument()
// and splitDocument() convert between the two.
//
// provenance: where a bar came from and whether a person has checked it.
//   source:   'manual' | 'local_omr' | 'openai_omr'
//   reviewed: manual bars start reviewed; imported bars start unreviewed and only
//             an explicit user action marks them reviewed
//   warnings: plain-language notes from the import, shown for review
//   model:    optional recogniser name, e.g. 'gpt-5.6-luna'
//
// meter: any valid meter can be saved and opened, but only 4/4 is editable for now
// (isEditableMeter); other meters open view-only.

import { BAR_TICKS, DRUMS, DURATIONS } from './constants.js';
import { barTicks, tripletStarts } from './bar.js';

export const SCHEMA_VERSION = 1;
export const SOURCES = ['manual', 'local_omr', 'openai_omr'];
export const DEFAULT_TITLE = 'Untitled score';
export const DEFAULT_TEMPO = 90;
export const TEMPO_MIN = 20;
export const TEMPO_MAX = 300;
export const TITLE_MAX = 200;
export const MAX_BARS = 2000;
const MAX_WARNINGS = 50;
const WARNING_MAX = 500;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const DOC_FIELDS = ['schemaVersion', 'scoreId', 'revision', 'title', 'tempoBpm', 'meter', 'bars'];
const BAR_FIELDS = ['barId', 'provenance', 'notes'];
const NOTE_FIELDS = ['eventId', 'duration', 'dotted', 'triplet', 'drums'];
const PROVENANCE_FIELDS = ['source', 'reviewed', 'warnings', 'model'];

// Ticks in one bar of this meter (48 per quarter note), e.g. 4/4 → 192, 3/4 → 144.
export function meterTicks(meter) {
  return meter.beats * (BAR_TICKS / meter.beatUnit);
}

// Only 4/4 can be edited, played, or analysed for now. Other valid meters open view-only.
export function isEditableMeter(meter) {
  return meter?.beats === 4 && meter?.beatUnit === 4;
}

// Thrown for files and inputs that cannot become a valid score.
// code: 'unreadable' | 'future_version' | 'invalid'
export class DocumentError extends Error {
  constructor(message, code = 'invalid') {
    super(message);
    this.name = 'DocumentError';
    this.code = code;
  }
}

// RFC 4122 version-4 UUID. crypto.randomUUID exists in Node and Electron's renderer;
// the getRandomValues fallback covers contexts where it is missing.
export function newId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createMeta({ idFactory = newId, title = DEFAULT_TITLE, tempoBpm = DEFAULT_TEMPO } = {}) {
  return {
    schemaVersion: SCHEMA_VERSION, scoreId: idFactory(), revision: 0,
    title, tempoBpm, meter: { beats: 4, beatUnit: 4 },
  };
}

export function manualProvenance() {
  return { source: 'manual', reviewed: true, warnings: [] };
}

export function importedProvenance({ source, model, warnings = [] }) {
  if (source === 'manual' || !SOURCES.includes(source)) {
    throw new DocumentError(`Unknown import source: ${source}`);
  }
  return { source, reviewed: false, warnings: [...warnings], ...(model ? { model } : {}) };
}

// Fill in any missing barId, provenance, or eventId. Objects that already have
// everything are returned unchanged (same reference), so undo snapshots and
// "did anything change?" identity checks keep working.
export function withIds(bars, idFactory = newId) {
  let changed = false;
  const out = bars.map(bar => {
    if (bar.barId && bar.provenance && bar.notes.every(note => note.eventId)) return bar;
    changed = true;
    const { barId = idFactory(), provenance = manualProvenance(), notes, ...rest } = bar;
    return {
      barId, provenance, ...rest,
      notes: notes.map(note => (note.eventId ? note : { eventId: idFactory(), ...note })),
    };
  });
  return changed ? out : bars;
}

export function toDocument(meta, bars) {
  return { ...meta, bars };
}

export function splitDocument(doc) {
  const { bars, ...meta } = doc;
  return { meta, bars };
}

// ── Validation ────────────────────────────────────────────────────────────────
// Returns a list of plain-language problems; an empty list means the document is valid.

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function unknownFields(value, allowed, where, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${where}: Unknown field "${key}"`);
  }
}

function checkId(value, where, field, seen, errors) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    errors.push(`${where}: ${field} must be 1–64 letters, digits, "-" or "_"`);
  } else if (seen.has(value)) {
    errors.push(`${where}: Duplicate id "${value}"`);
  } else {
    seen.add(value);
  }
}

function checkMeta(doc, errors) {
  if (doc.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (typeof doc.scoreId !== 'string' || !ID_PATTERN.test(doc.scoreId)) {
    errors.push('scoreId must be 1–64 letters, digits, "-" or "_"');
  }
  if (!Number.isInteger(doc.revision) || doc.revision < 0) errors.push('revision must be a whole number of 0 or more');
  if (typeof doc.title !== 'string' || doc.title.length > TITLE_MAX) {
    errors.push(`title must be text of at most ${TITLE_MAX} characters`);
  }
  if (!Number.isInteger(doc.tempoBpm) || doc.tempoBpm < TEMPO_MIN || doc.tempoBpm > TEMPO_MAX) {
    errors.push(`tempoBpm must be a whole number from ${TEMPO_MIN} to ${TEMPO_MAX}`);
  }
  const { meter } = doc;
  if (!isObject(meter) || !Number.isInteger(meter.beats) || meter.beats < 1 || meter.beats > 32 ||
      ![1, 2, 4, 8, 16, 32].includes(meter.beatUnit)) {
    errors.push('meter must have whole beats (1–32) and a beatUnit of 1, 2, 4, 8, 16 or 32');
  }
}

function checkProvenance(provenance, where, errors) {
  if (!isObject(provenance)) { errors.push(`${where}: provenance is missing`); return; }
  unknownFields(provenance, PROVENANCE_FIELDS, `${where} provenance`, errors);
  if (!SOURCES.includes(provenance.source)) errors.push(`${where}: provenance source must be one of ${SOURCES.join(', ')}`);
  if (typeof provenance.reviewed !== 'boolean') errors.push(`${where}: provenance reviewed must be true or false`);
  const { warnings } = provenance;
  if (!Array.isArray(warnings) || warnings.length > MAX_WARNINGS ||
      warnings.some(w => typeof w !== 'string' || w.length > WARNING_MAX)) {
    errors.push(`${where}: provenance warnings must be a list of at most ${MAX_WARNINGS} short messages`);
  }
  if (provenance.model !== undefined && (typeof provenance.model !== 'string' || provenance.model.length > 100)) {
    errors.push(`${where}: provenance model must be a short name`);
  }
}

function checkNote(note, where, seen, errors) {
  if (!isObject(note)) { errors.push(`${where}: is not a note`); return false; }
  unknownFields(note, NOTE_FIELDS, where, errors);
  checkId(note.eventId, where, 'eventId', seen, errors);
  let ok = true;
  if (!DURATIONS.includes(note.duration)) { errors.push(`${where}: duration must be one of ${DURATIONS.join(', ')}`); ok = false; }
  if (typeof note.dotted !== 'boolean') { errors.push(`${where}: dotted must be true or false`); ok = false; }
  if (note.triplet !== undefined && typeof note.triplet !== 'boolean') { errors.push(`${where}: triplet must be true or false`); ok = false; }
  if (!Array.isArray(note.drums)) {
    errors.push(`${where}: drums must be a list of drum names`);
    return false;
  }
  const unknownIndex = note.drums.findIndex(d => typeof d !== 'string' || !Object.hasOwn(DRUMS, d));
  if (unknownIndex >= 0) { errors.push(`${where}: unknown drum "${String(note.drums[unknownIndex])}"`); ok = false; }
  if (new Set(note.drums).size !== note.drums.length) { errors.push(`${where}: drums repeats a drum`); ok = false; }
  if (note.dotted && note.duration === DURATIONS[0]) { errors.push(`${where}: a dotted 32nd is not supported`); ok = false; }
  if (note.dotted && note.triplet) { errors.push(`${where}: a dotted triplet is not supported`); ok = false; }
  return ok;
}

function checkBar(bar, index, seen, errors, capacity) {
  const where = `Bar ${index + 1}`;
  if (!isObject(bar)) { errors.push(`${where}: is not a bar`); return; }
  unknownFields(bar, BAR_FIELDS, where, errors);
  checkId(bar.barId, where, 'barId', seen, errors);
  checkProvenance(bar.provenance, where, errors);
  if (!Array.isArray(bar.notes)) { errors.push(`${where}: notes must be a list`); return; }
  const notesOk = bar.notes
    .map((note, i) => checkNote(note, `${where} note ${i + 1}`, seen, errors))
    .every(Boolean);
  if (!notesOk) return;  // timing checks need well-formed notes
  const grouped = tripletStarts(bar).flatMap(start => [start, start + 1, start + 2]);
  if (bar.notes.some((note, i) => note.triplet && !grouped.includes(i))) {
    errors.push(`${where}: every triplet note must be part of a triplet group of three`);
  }
  if (capacity !== null && barTicks(bar) > capacity.ticks) errors.push(`${where}: overfills a ${capacity.label} bar`);
}

export function validateDocument(doc) {
  if (!isObject(doc)) return ['A score must be an object'];
  const errors = [];
  unknownFields(doc, DOC_FIELDS, 'Score', errors);
  checkMeta(doc, errors);
  if (!Array.isArray(doc.bars) || doc.bars.length === 0 || doc.bars.length > MAX_BARS) {
    errors.push(`A score must have at least one bar and at most ${MAX_BARS}`);
    return errors;
  }
  const seen = new Set();
  const meterOk = !errors.some(error => error.startsWith('meter'));
  const capacity = meterOk ? { ticks: meterTicks(doc.meter), label: `${doc.meter.beats}/${doc.meter.beatUnit}` } : null;
  doc.bars.forEach((bar, i) => checkBar(bar, i, seen, errors, capacity));
  return errors;
}

function assertValid(doc) {
  const errors = validateDocument(doc);
  if (errors.length) {
    const more = errors.length > 3 ? ` (and ${errors.length - 3} more problems)` : '';
    throw new DocumentError(`This score has problems: ${errors.slice(0, 3).join('; ')}${more}`);
  }
  return doc;
}

// ── Files ─────────────────────────────────────────────────────────────────────

// Human-readable .drumhub.json text. Refuses to write an invalid document.
export function serializeDocument(doc) {
  return `${JSON.stringify(assertValid(doc), null, 2)}\n`;
}

// Text → valid document. A file with only `bars` (an unversioned editor export) is
// migrated with fresh ids. Files from a newer DrumHub are refused, never rewritten.
export function parseDocument(text, { idFactory = newId } = {}) {
  let raw;
  try { raw = JSON.parse(text); }
  catch { throw new DocumentError('This file is not valid JSON, so it cannot be opened as a score.', 'unreadable'); }
  if (!isObject(raw)) throw new DocumentError('This file is not a DrumHub score.', 'unreadable');

  if (raw.schemaVersion === undefined) {
    if (!Array.isArray(raw.bars)) throw new DocumentError('This file is not a DrumHub score.', 'unreadable');
    return assertValid(toDocument(createMeta({ idFactory }), withIds(raw.bars, idFactory)));
  }
  if (Number.isInteger(raw.schemaVersion) && raw.schemaVersion > SCHEMA_VERSION) {
    throw new DocumentError(
      `This score was saved by a newer version of DrumHub (format ${raw.schemaVersion}). ` +
      'Update DrumHub to open it; the file has not been changed.', 'future_version');
  }
  return assertValid(raw);
}
