// ── Score snapshot ────────────────────────────────────────────────────────────
// A compact, verifiable description of (part of) the score for the analysis tools
// and the Ask DrumHub agent. Pure: tested in Node and re-validated in Electron main
// before any model call.
//
// It holds timing facts, not display data: no title, cursor pixels, images, or import
// warning text (only a count). Titles and warnings can contain text copied from an
// image or file, so they never reach a model through the snapshot.
//
// snapshotHash detects accidental corruption and ties answers to one exact version. It
// is not proof of authenticity: the page computes it, and the page owns the score.
//
// snapshot = {
//   schemaVersion, scoreId, revision, snapshotHash,
//   meter, tempoBpm, totalBars, range: { fromBar, toBar }, truncated,
//   selection: { barId, eventId, barNumber } | null,
//   bars: [{ barId, barNumber, reviewed, source, warningCount, events: [{
//     eventId, onsetTicks, durationTicks, writtenDuration, dotted, triplet, drums, isRest }] }]
// }
// Bar numbers are 1-based, as a person reads them. Ticks are 48 per quarter note.
// drums are sorted so the same chord always looks the same.

import { DRUMS, DURATIONS } from './constants.js';
import { noteTicks } from './bar.js';
import { meterTicks } from './score-document.js';
import { sha256 } from './sha256.js';

export const SNAPSHOT_VERSION = 1;
export const MAX_SNAPSHOT_BARS = 64;
export const MAX_EVENTS_PER_BAR = 64;

const SNAPSHOT_FIELDS = ['schemaVersion', 'scoreId', 'revision', 'snapshotHash', 'meter', 'tempoBpm',
  'totalBars', 'range', 'truncated', 'selection', 'bars'];
const BAR_FIELDS = ['barId', 'barNumber', 'reviewed', 'source', 'warningCount', 'events'];
const EVENT_FIELDS = ['eventId', 'onsetTicks', 'durationTicks', 'writtenDuration', 'dotted', 'triplet', 'drums', 'isRest'];

function snapshotBar(bar, index) {
  let onset = 0;
  const events = bar.notes.map(note => {
    const event = {
      eventId: note.eventId,
      onsetTicks: onset,
      durationTicks: noteTicks(note),
      writtenDuration: note.duration,
      dotted: note.dotted,
      triplet: note.triplet === true,
      drums: [...note.drums].sort(),
      isRest: note.drums.length === 0,
    };
    onset += event.durationTicks;
    return event;
  });
  const { reviewed, source, warnings } = bar.provenance;
  return { barId: bar.barId, barNumber: index + 1, reviewed, source, warningCount: warnings.length, events };
}

// Hash of every field except snapshotHash itself. Objects are built with a fixed key
// order, so JSON.stringify is canonical here.
export function snapshotHash(withoutHash) {
  return sha256(JSON.stringify(withoutHash));
}

// editor: from commands.js. fromBar/toBar: 1-based, inclusive, clamped and ordered.
// At most maxBars bars are included, starting at fromBar; `truncated` says so.
export function scoreSnapshot(editor, { fromBar = 1, toBar = editor.bars.length, maxBars = MAX_SNAPSHOT_BARS } = {}) {
  const total = editor.bars.length;
  const clamp = n => Math.min(total, Math.max(1, Math.round(Number(n) || 1)));
  let [from, to] = [clamp(fromBar), clamp(toBar)].sort((a, b) => a - b);
  const truncated = to - from + 1 > maxBars;
  if (truncated) to = from + maxBars - 1;

  const { barIndex, noteIndex } = editor.cursor;
  const cursorBar = editor.bars[barIndex];
  const body = {
    schemaVersion: SNAPSHOT_VERSION,
    scoreId: editor.meta.scoreId,
    revision: editor.meta.revision,
    meter: { beats: editor.meta.meter.beats, beatUnit: editor.meta.meter.beatUnit },
    tempoBpm: editor.meta.tempoBpm,
    totalBars: total,
    range: { fromBar: from, toBar: to },
    truncated,
    selection: cursorBar
      ? { barId: cursorBar.barId, eventId: cursorBar.notes[noteIndex]?.eventId ?? null, barNumber: barIndex + 1 }
      : null,
    bars: editor.bars.slice(from - 1, to).map((bar, i) => snapshotBar(bar, from - 1 + i)),
  };
  const { schemaVersion, scoreId, revision, ...rest } = body;
  return { schemaVersion, scoreId, revision, snapshotHash: snapshotHash(body), ...rest };
}

// ── Validation (Electron main re-checks everything the page sends) ────────────

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);

function unknown(value, allowed, where, errors) {
  Object.keys(value).filter(k => !allowed.includes(k)).forEach(k => errors.push(`${where}: Unknown field "${k}"`));
}

function checkEvents(bar, where, capacity, seen, errors) {
  if (!Array.isArray(bar.events) || bar.events.length > MAX_EVENTS_PER_BAR) {
    errors.push(`${where}: events must be a list of at most ${MAX_EVENTS_PER_BAR}`);
    return;
  }
  let onset = 0;
  bar.events.forEach((event, i) => {
    const at = `${where} event ${i + 1}`;
    if (!isObject(event)) { errors.push(`${at}: is not an event`); return; }
    unknown(event, EVENT_FIELDS, at, errors);
    if (!isId(event.eventId) || seen.has(event.eventId)) errors.push(`${at}: missing or Duplicate eventId`);
    else seen.add(event.eventId);
    if (!DURATIONS.includes(event.writtenDuration)) errors.push(`${at}: unknown duration`);
    if (typeof event.dotted !== 'boolean' || typeof event.triplet !== 'boolean') errors.push(`${at}: dotted/triplet must be true or false`);
    const expected = DURATIONS.includes(event.writtenDuration)
      ? noteTicks({ duration: event.writtenDuration, dotted: event.dotted, triplet: event.triplet, drums: [] }) : null;
    if (event.onsetTicks !== onset) errors.push(`${at}: onsetTicks should be ${onset}`);
    if (event.durationTicks !== expected) errors.push(`${at}: durationTicks does not match its duration`);
    if (!Array.isArray(event.drums) || event.drums.some(d => !Object.hasOwn(DRUMS, d))) errors.push(`${at}: unknown drum`);
    else if (event.isRest !== (event.drums.length === 0)) errors.push(`${at}: isRest does not match drums`);
    onset += Number.isInteger(expected) ? expected : 0;
  });
  if (onset > capacity) errors.push(`${where}: events overfill the bar`);
}

// The selection must point at the bar it names; a bar outside the shared range may only
// be named by number and id pairs we cannot check, so it is refused.
function checkSelection(snap, errors) {
  const { selection } = snap;
  if (selection === null) return;
  const bar = isObject(selection) && Number.isInteger(selection.barNumber) && Array.isArray(snap.bars)
    ? snap.bars.find(b => b?.barNumber === selection.barNumber) : null;
  const inRange = isObject(selection) && isObject(snap.range) && Number.isInteger(selection.barNumber) &&
    selection.barNumber >= 1 && selection.barNumber <= snap.totalBars;
  if (!inRange || !isId(selection.barId) || (bar && bar.barId !== selection.barId) ||
      !(selection.eventId === null || (isId(selection.eventId) && (!bar || bar.events?.some(e => e?.eventId === selection.eventId))))) {
    errors.push('selection is invalid');
  }
}

export function validateSnapshot(snap) {
  if (!isObject(snap)) return ['A snapshot must be an object'];
  const errors = [];
  unknown(snap, SNAPSHOT_FIELDS, 'Snapshot', errors);
  if (snap.schemaVersion !== SNAPSHOT_VERSION) errors.push(`schemaVersion must be ${SNAPSHOT_VERSION}`);
  if (!isId(snap.scoreId)) errors.push('scoreId is invalid');
  if (!Number.isInteger(snap.revision) || snap.revision < 0) errors.push('revision is invalid');
  if (!Number.isInteger(snap.tempoBpm) || snap.tempoBpm < 20 || snap.tempoBpm > 300) errors.push('tempoBpm is invalid');
  const meterOk = isObject(snap.meter) && Number.isInteger(snap.meter.beats) && snap.meter.beats >= 1 &&
    snap.meter.beats <= 32 && [1, 2, 4, 8, 16, 32].includes(snap.meter.beatUnit);
  if (!meterOk) errors.push('meter is invalid');
  if (!Number.isInteger(snap.totalBars) || snap.totalBars < 1) errors.push('totalBars is invalid');
  if (!isObject(snap.range) || !Number.isInteger(snap.range.fromBar) || !Number.isInteger(snap.range.toBar) ||
      snap.range.fromBar < 1 || snap.range.toBar < snap.range.fromBar || snap.range.toBar > snap.totalBars) {
    errors.push('range is invalid');
  }
  if (typeof snap.truncated !== 'boolean') errors.push('truncated must be true or false');
  else if (isObject(snap.range) && Number.isInteger(snap.totalBars) &&
      snap.truncated !== (snap.range.fromBar > 1 || snap.range.toBar < snap.totalBars) && snap.truncated) {
    errors.push('truncated does not match the range');
  }
  if (!Array.isArray(snap.bars) || snap.bars.length > MAX_SNAPSHOT_BARS) {
    errors.push(`bars must be a list of at most ${MAX_SNAPSHOT_BARS}`);
    return errors;
  }
  if (isObject(snap.range) && (snap.bars.length !== snap.range.toBar - snap.range.fromBar + 1 ||
      snap.bars.some((bar, i) => bar?.barNumber !== snap.range.fromBar + i))) {
    errors.push('bar numbers must run through the range in order');
  }
  const seen = new Set();
  const capacity = meterOk ? meterTicks(snap.meter) : 0;
  snap.bars.forEach((bar, i) => {
    const where = `Bar ${bar?.barNumber ?? i + 1}`;
    if (!isObject(bar)) { errors.push(`${where}: is not a bar`); return; }
    unknown(bar, BAR_FIELDS, where, errors);
    if (!isId(bar.barId) || seen.has(bar.barId)) errors.push(`${where}: missing or Duplicate barId`);
    else seen.add(bar.barId);
    if (typeof bar.reviewed !== 'boolean') errors.push(`${where}: reviewed must be true or false`);
    if (!['manual', 'local_omr', 'openai_omr'].includes(bar.source)) errors.push(`${where}: unknown source`);
    if (!Number.isInteger(bar.warningCount) || bar.warningCount < 0 || bar.warningCount > 50) errors.push(`${where}: warningCount is invalid`);
    checkEvents(bar, where, capacity, seen, errors);
  });
  checkSelection(snap, errors);
  if (!errors.length) {
    const { snapshotHash: hash, ...rest } = snap;
    const { schemaVersion, scoreId, revision, ...others } = rest;
    if (snapshotHash({ schemaVersion, scoreId, revision, ...others }) !== hash) errors.push('The snapshot hash does not match its content');
  }
  return errors;
}
