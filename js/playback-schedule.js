// ── Pure playback timing ─────────────────────────────────────────────────────
// This module turns editor bars into exact tick-based playback events. It has
// no Web Audio, UI, or mutable score state, so the same schedule can be used by
// a renderer, a look-ahead scheduler, and tests.
//
// A bar's notes are sequential: their onset is the sum of preceding noteTicks.
// Chords become one hit per drum at the same tick; rests keep their timing but
// produce no hits. Seconds are only calculated from integer tick positions so
// repeated playback never accumulates floating-point drift.

import { DUR_TICKS } from './constants.js';
import { noteTicks } from './bar.js';
import { meterTicks } from './score-document.js';

const TICKS_PER_QUARTER = 48;
const TEMPO_MIN = 20;
const TEMPO_MAX = 300;
const VALID_BEAT_UNITS = new Set([1, 2, 4, 8, 16, 32]);

// The public schedule deliberately contains only the playback arrays. Private
// metadata lets positionAt retain source-note onset data and the loop setting
// without changing that public contract.
const scheduleMetadata = new WeakMap();

export class PlaybackError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlaybackError';
  }
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

function assert(condition, message) {
  if (!condition) throw new PlaybackError(message);
}

function validateOptions(bars, options) {
  assert(Array.isArray(bars), 'bars must be a list');
  assert(bars.length > 0, 'bars must contain at least one bar');
  assert(options && typeof options === 'object', 'playback options are required');

  const { tempoBpm, meter, fromBar, toBar, countInBeats = 0, loop = false, metronome = true } = options;
  assert(Number.isInteger(tempoBpm) && tempoBpm >= TEMPO_MIN && tempoBpm <= TEMPO_MAX,
    `tempoBpm must be a whole number from ${TEMPO_MIN} to ${TEMPO_MAX}`);
  assert(meter && typeof meter === 'object' && !Array.isArray(meter),
    'meter must have whole beats and a supported beatUnit');
  assert(Number.isInteger(meter.beats) && meter.beats > 0 && VALID_BEAT_UNITS.has(meter.beatUnit),
    'meter must have positive whole beats and a beatUnit of 1, 2, 4, 8, 16 or 32');
  assert(Number.isInteger(fromBar) && fromBar >= 1 && fromBar <= bars.length,
    `fromBar must be a whole number from 1 to ${bars.length}`);
  assert(Number.isInteger(toBar) && toBar >= 1 && toBar <= bars.length,
    `toBar must be a whole number from 1 to ${bars.length}`);
  assert(fromBar <= toBar, 'fromBar must be less than or equal to toBar');
  assert(Number.isInteger(countInBeats) && countInBeats >= 0,
    'countInBeats must be a whole number of 0 or more');
  assert(typeof loop === 'boolean', 'loop must be true or false');
  assert(typeof metronome === 'boolean', 'metronome must be true or false');

  return { tempoBpm, meter, fromBar, toBar, countInBeats, loop, metronome };
}

function noteTickValue(note, barIndex, noteIndex) {
  assert(Object.hasOwn(DUR_TICKS, note?.duration),
    `Bar ${barIndex + 1} note ${noteIndex + 1} has an unsupported duration`);
  const ticks = noteTicks(note);
  assert(Number.isFinite(ticks) && ticks >= 0,
    `Bar ${barIndex + 1} note ${noteIndex + 1} has an unsupported duration`);
  return ticks;
}

function itemInWindow(item, from, to) {
  return from <= item.time && item.time < to;
}

function sortHits(a, b) {
  return (a.time - b.time) || a.drum.localeCompare(b.drum) ||
    (a.barIndex - b.barIndex) || (a.noteIndex - b.noteIndex);
}

function sortClicks(a, b) {
  return (a.time - b.time) || (Number(b.accent) - Number(a.accent)) ||
    (Number(a.countIn) - Number(b.countIn));
}

function cloneWithLoopIndex(item, time, loopIndex) {
  return { ...item, time, loopIndex };
}

export function buildSchedule(bars, options) {
  const validated = validateOptions(bars, options);
  const { tempoBpm, meter, fromBar, toBar, countInBeats, loop, metronome } = validated;
  const beatTicks = TICKS_PER_QUARTER * 4 / meter.beatUnit;
  const barTickLength = meterTicks(meter);
  const secondsPerTick = 60 / (tempoBpm * TICKS_PER_QUARTER);
  const countInTicks = countInBeats * beatTicks;
  const countInSeconds = countInTicks * secondsPerTick;
  const playedBarCount = toBar - fromBar + 1;
  const totalPassageTicks = playedBarCount * barTickLength;
  const loopSeconds = totalPassageTicks * secondsPerTick;

  const hits = [];
  const clicks = [];
  const barOutput = [];
  const barMetadata = [];

  // Count-in belongs before the selected passage and is never repeated by a loop.
  for (let beat = 0; beat < countInBeats; beat++) {
    clicks.push({
      time: beat * beatTicks * secondsPerTick,
      accent: beat % meter.beats === 0,
      countIn: true,
    });
  }

  for (let sourceIndex = fromBar - 1; sourceIndex <= toBar - 1; sourceIndex++) {
    const bar = bars[sourceIndex];
    const playedIndex = sourceIndex - (fromBar - 1);
    const barStartTicks = countInTicks + playedIndex * barTickLength;
    const barEndTicks = barStartTicks + barTickLength;
    const startTime = barStartTicks * secondsPerTick;
    const endTime = barEndTicks * secondsPerTick;
    const noteStarts = [];
    let noteTicksAt = 0;

    barOutput.push({ barIndex: sourceIndex, startTime, endTime });

    // Metronome beats are generated from the bar grid, not from note contents.
    if (metronome) {
      for (let beat = 0; beat < meter.beats; beat++) {
        const beatTicksAt = barStartTicks + beat * beatTicks;
        clicks.push({
          time: beatTicksAt * secondsPerTick,
          accent: beat === 0,
          countIn: false,
        });
      }
    }

    bar.notes.forEach((note, noteIndex) => {
      const ticks = noteTickValue(note, sourceIndex, noteIndex);
      noteStarts.push(noteTicksAt);
      if (Array.isArray(note.drums)) {
        note.drums.forEach(drum => {
          hits.push({
            time: (barStartTicks + noteTicksAt) * secondsPerTick,
            drum,
            barIndex: sourceIndex,
            noteIndex,
            eventId: note.eventId,
          });
        });
      }
      noteTicksAt += ticks;
    });

    barMetadata.push({ sourceIndex, startTime, endTime, noteStarts });
  }

  hits.sort(sortHits);
  clicks.sort(sortClicks);
  const schedule = freezeDeep({
    secondsPerTick,
    loopSeconds,
    countInSeconds,
    hits,
    clicks,
    bars: barOutput,
  });
  scheduleMetadata.set(schedule, {
    loop,
    secondsPerTick,
    passageStart: countInSeconds,
    passageEnd: countInSeconds + loopSeconds,
    barMetadata,
  });
  return schedule;
}

function addItemsBetween(items, from, to, loopIndexFrom, loopSeconds, includeLoop, output) {
  for (const item of items) {
    if (!includeLoop) {
      if (itemInWindow(item, from, to)) output.push(cloneWithLoopIndex(item, item.time, 0));
      continue;
    }

    // Expand the calculated range by one on either side, then use the exact
    // comparison below. This protects boundary windows from quotient rounding.
    const firstCandidate = Math.max(loopIndexFrom,
      Math.floor((from - item.time) / loopSeconds) - 1);
    const lastCandidate = Math.ceil((to - item.time) / loopSeconds) + 1;
    for (let loopIndex = firstCandidate; loopIndex <= lastCandidate; loopIndex++) {
      const time = loopIndex * loopSeconds + item.time;
      if (itemInWindow({ time }, from, to)) output.push(cloneWithLoopIndex(item, time, loopIndex));
    }
  }
}

export function eventsBetween(schedule, from, to, { loop = false, loopIndexFrom = 0 } = {}) {
  assert(schedule && typeof schedule === 'object' && Array.isArray(schedule.hits) && Array.isArray(schedule.clicks),
    'schedule must be a playback schedule');
  assert(Number.isFinite(from) && Number.isFinite(to) && from < to,
    'eventsBetween requires a finite window with from less than to');
  assert(Number.isInteger(loopIndexFrom) && loopIndexFrom >= 0,
    'loopIndexFrom must be a whole number of 0 or more');
  assert(typeof loop === 'boolean', 'loop must be true or false');

  const hits = [];
  const clicks = [];
  if (!loop) {
    addItemsBetween(schedule.hits, from, to, 0, schedule.loopSeconds, false, hits);
    addItemsBetween(schedule.clicks, from, to, 0, schedule.loopSeconds, false, clicks);
  } else {
    const metadata = scheduleMetadata.get(schedule);
    assert(metadata, 'schedule was not created by buildSchedule');

    // Count-in is emitted only for the first pass, before its musical events.
    addItemsBetween(schedule.hits, from, to, loopIndexFrom, schedule.loopSeconds, true, hits);
    addItemsBetween(schedule.clicks.filter(click => !click.countIn), from, to,
      loopIndexFrom, schedule.loopSeconds, true, clicks);
    if (loopIndexFrom === 0) {
      addItemsBetween(schedule.clicks.filter(click => click.countIn), from, to,
        0, schedule.loopSeconds, false, clicks);
    }
  }

  hits.sort(sortHits);
  clicks.sort(sortClicks);
  return freezeDeep({ hits, clicks });
}

function barAtTime(barMetadata, time) {
  return barMetadata.find(bar => bar.startTime <= time && time < bar.endTime) ?? null;
}

export function positionAt(schedule, time) {
  const metadata = scheduleMetadata.get(schedule);
  if (!metadata || !Number.isFinite(time) || time < 0) return null;

  let loopIndex = 0;
  let passTime = time;
  if (metadata.loop) {
    if (time < metadata.passageStart) return null;
    loopIndex = Math.floor((time - metadata.passageStart) / (metadata.passageEnd - metadata.passageStart));
    passTime = time - loopIndex * (metadata.passageEnd - metadata.passageStart);
  } else if (time < metadata.passageStart || time >= metadata.passageEnd) {
    return null;
  }

  const bar = barAtTime(metadata.barMetadata, passTime);
  if (!bar) return null;
  let noteIndex = -1;
  for (let i = 0; i < bar.noteStarts.length; i++) {
    const onset = bar.startTime + bar.noteStarts[i] * metadata.secondsPerTick;
    if (onset <= passTime) noteIndex = i;
    else break;
  }
  return noteIndex >= 0 ? { barIndex: bar.sourceIndex, noteIndex, loopIndex } : null;
}
