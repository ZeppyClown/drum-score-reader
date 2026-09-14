// ── Look-ahead playback scheduler ───────────────────────────────────────────
// AudioContext time is the only clock used for audible events. The timer merely
// wakes the scheduler often enough to keep the context's future queue filled.

import { eventsBetween, positionAt } from './playback-schedule.js';

const DEFAULT_LOOK_AHEAD_MS = 25;
const DEFAULT_SCHEDULE_AHEAD_SEC = 0.12;
const STOP_RAMP_SEC = 0.01;

function currentTimeOf(audioContext, now) {
  const injected = typeof now === 'function' ? now() : audioContext.currentTime;
  return Number.isFinite(injected) ? injected : audioContext.currentTime;
}

function setMasterGain(output, value, time, ramp = false) {
  const gain = output?.gain;
  if (!gain) return;
  if (typeof gain.cancelScheduledValues === 'function') gain.cancelScheduledValues(time);
  const baseline = ramp ? (gain.value ?? value) : value;
  if (typeof gain.setValueAtTime === 'function') gain.setValueAtTime(baseline, time);
  else gain.value = value;
  if (ramp && typeof gain.linearRampToValueAtTime === 'function') {
    gain.linearRampToValueAtTime(0, time + STOP_RAMP_SEC);
  } else gain.value = value;
}

function eventKey(kind, event) {
  const loopIndex = event.loopIndex ?? 0;
  if (kind === 'hit') {
    const identity = event.eventId ?? `${event.barIndex}:${event.noteIndex}`;
    return `${kind}:${loopIndex}:${event.time}:${identity}:${event.drum}`;
  }
  return `${kind}:${loopIndex}:${event.time}:${event.countIn ? 'count-in' : 'bar'}:${event.accent}`;
}

export class PlaybackEngine {
  constructor({
    audioContext, kit, lookAheadMs = DEFAULT_LOOK_AHEAD_MS,
    scheduleAheadSec = DEFAULT_SCHEDULE_AHEAD_SEC,
    // Wrapped: browsers throw "Illegal invocation" when window.setInterval is called as
    // a method of another object (this.timers.setInterval).
    timers = { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: id => clearInterval(id) },
    now,
  }) {
    if (!audioContext || !kit) throw new TypeError('PlaybackEngine requires an audioContext and kit');
    this.audioContext = audioContext;
    this.kit = kit;
    this.lookAheadMs = lookAheadMs;
    this.scheduleAheadSec = scheduleAheadSec;
    this.timers = timers;
    this.now = now ?? (() => audioContext.currentTime);
    this._playing = false;
    this._timer = null;
    this._schedule = null;
    this._loop = false;
    this._metronome = true;
    this._startOffset = 0;
    this._scheduled = new Map();   // event key → relative time, pruned once it has played
    this._positionListeners = new Set();
    this._lastPositionKey = undefined;
  }

  get isPlaying() {
    return this._playing;
  }

  onPosition(callback) {
    if (typeof callback !== 'function') throw new TypeError('onPosition requires a callback');
    this._positionListeners.add(callback);
    return () => this._positionListeners.delete(callback);
  }

  start(schedule, { loop = false, metronome = true } = {}) {
    if (this._playing) this.stop();
    this._schedule = schedule;
    this._loop = Boolean(loop);
    this._metronome = Boolean(metronome);
    this._startOffset = this.audioContext.currentTime;
    this._scheduled.clear();
    this._lastPositionKey = undefined;
    this._playing = true;
    setMasterGain(this.kit.output, 1, this._startOffset);
    this._tick();
    this._timer = this.timers.setInterval(() => this._tick(), this.lookAheadMs);
  }

  stop() {
    if (this._timer !== null) {
      this.timers.clearInterval(this._timer);
      this._timer = null;
    }
    const wasPlaying = this._playing;
    this._playing = false;
    if (wasPlaying) setMasterGain(this.kit.output, 0, this.audioContext.currentTime, true);
  }

  _reportPosition(relativeTime) {
    const position = positionAt(this._schedule, relativeTime);
    const key = JSON.stringify(position);
    if (key === this._lastPositionKey) return;
    this._lastPositionKey = key;
    this._positionListeners.forEach(listener => listener(position));
  }

  _scheduleEvents(relativeFrom, relativeTo) {
    const events = eventsBetween(this._schedule, relativeFrom, relativeTo, { loop: this._loop });
    events.hits.forEach(hit => {
      const key = eventKey('hit', hit);
      if (this._scheduled.has(key)) return;
      this._scheduled.set(key, hit.time);
      this.kit.play(hit.drum, this._startOffset + hit.time, { velocity: 1 });
    });
    events.clicks.forEach(click => {
      // Count-in is its own cue and remains audible when the bar metronome is
      // disabled. Bar clicks are controlled by the start() option.
      if (!click.countIn && !this._metronome) return;
      const key = eventKey('click', click);
      if (this._scheduled.has(key)) return;
      this._scheduled.set(key, click.time);
      this.kit.click(this._startOffset + click.time, { accent: click.accent });
    });
  }

  _tick() {
    if (!this._playing) return;
    const audioTime = currentTimeOf(this.audioContext, this.now);
    const relativeTime = Math.max(0, audioTime - this._startOffset);
    this._reportPosition(relativeTime);

    const end = this._schedule.countInSeconds + this._schedule.loopSeconds;
    if (!this._loop && relativeTime >= end) {
      this._playing = false;
      if (this._timer !== null) {
        this.timers.clearInterval(this._timer);
        this._timer = null;
      }
      return;
    }
    this._scheduleEvents(relativeTime, relativeTime + this.scheduleAheadSec);
    // Forget events that are safely in the past, so a long loop session doesn't keep
    // every key it ever scheduled. Anything newer than one look-ahead window is kept.
    for (const [key, time] of this._scheduled) {
      if (time < relativeTime - this.scheduleAheadSec) this._scheduled.delete(key);
    }
  }
}
