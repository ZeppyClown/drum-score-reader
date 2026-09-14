import test from 'node:test';
import assert from 'node:assert/strict';

import { DRUMS } from '../js/constants.js';
import { buildSchedule } from '../js/playback-schedule.js';
import { createDrumKit } from '../js/drum-synth.js';
import { PlaybackEngine } from '../js/playback-engine.js';

class FakeParam {
  constructor(value = 0) { this.value = value; this.events = []; }
  setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }
  linearRampToValueAtTime(value, time) { this.value = value; this.events.push(['linear', value, time]); }
  exponentialRampToValueAtTime(value, time) { this.value = value; this.events.push(['exponential', value, time]); }
  cancelScheduledValues(time) { this.events.push(['cancel', time]); }
}

class FakeNode {
  constructor(context, kind) {
    this.context = context;
    this.kind = kind;
    this.connections = [];
    this.startTimes = [];
    this.stopTimes = [];
    this.frequency = new FakeParam();
    this.Q = new FakeParam();
    this.gain = new FakeParam();
    this.type = '';
  }
  connect(node) { this.connections.push(node); }
  disconnect() { this.disconnected = true; this.connections = []; }
  start(time) { this.startTimes.push(time); this.context.started.push(this); }
  stop(time) { this.stopTimes.push(time); this.context.stopped.push(this); }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 1000;
    this.destination = new FakeNode(this, 'destination');
    this.started = [];
    this.stopped = [];
    this.created = [];
  }
  createGain() { const node = new FakeNode(this, 'gain'); this.created.push(node); return node; }
  createOscillator() { const node = new FakeNode(this, 'oscillator'); this.created.push(node); return node; }
  createBufferSource() { const node = new FakeNode(this, 'buffer-source'); this.created.push(node); return node; }
  createBiquadFilter() { const node = new FakeNode(this, 'filter'); this.created.push(node); return node; }
  createBuffer(channels, length, sampleRate) {
    return { channels, length, sampleRate, getChannelData: () => new Float32Array(length) };
  }
}

class FakeTimers {
  constructor() { this.nextId = 1; this.callbacks = new Map(); }
  setInterval(callback) { const id = this.nextId++; this.callbacks.set(id, callback); return id; }
  clearInterval(id) { this.callbacks.delete(id); }
  tick() { [...this.callbacks.values()].forEach(callback => callback()); }
}

const hit = (eventId, drums = ['snare']) => ({ eventId, duration: 'q', dotted: false, drums });
const bars = (...notes) => [{ barId: 'bar-1', provenance: {}, notes }];
const options = (overrides = {}) => ({
  tempoBpm: 120, meter: { beats: 4, beatUnit: 4 }, fromBar: 1, toBar: 1, ...overrides,
});

test('look-ahead schedules each hit once across windows and loop passes', () => {
  const context = new FakeAudioContext();
  const timers = new FakeTimers();
  const calls = [];
  const kit = {
    output: context.createGain(),
    play: (drum, when) => calls.push(['hit', drum, when]),
    click: (when, options) => calls.push(['click', when, options]),
  };
  const schedule = buildSchedule(bars(hit('a'), hit('b')), options({ loop: true, metronome: false }));
  const engine = new PlaybackEngine({
    audioContext: context, kit, timers, lookAheadMs: 25, scheduleAheadSec: 0.6,
    now: () => context.currentTime,
  });

  engine.start(schedule, { loop: true, metronome: false });
  context.currentTime = 0.49; timers.tick();
  context.currentTime = 1.49; timers.tick();
  context.currentTime = 2.01; timers.tick();

  assert.deepEqual(calls.filter(call => call[0] === 'hit').map(([, drum, when]) => [drum, when]), [
    ['snare', 0], ['snare', 0.5], ['snare', 2], ['snare', 2.5],
  ]);
  assert.equal(calls.filter(call => call[0] === 'click').length, 0);
});

test('count-in clicks occur once and bar clicks obey metronome', () => {
  const context = new FakeAudioContext();
  const timers = new FakeTimers();
  const calls = [];
  const kit = {
    output: context.createGain(), play() {},
    click: (when, options) => calls.push({ when, ...options }),
  };
  const schedule = buildSchedule(bars(hit('a')), options({ countInBeats: 2, metronome: true }));
  const engine = new PlaybackEngine({ audioContext: context, kit, timers, scheduleAheadSec: 2 });
  engine.start(schedule, { loop: false, metronome: false });
  assert.deepEqual(calls.map(({ when, countIn, accent }) => [when, countIn, accent]), [
    [0, undefined, true], [0.5, undefined, false],
  ]);
});

test('stop clears scheduling and silences the master gain', () => {
  const context = new FakeAudioContext();
  const timers = new FakeTimers();
  const calls = [];
  const kit = {
    output: context.createGain(),
    play: (...args) => calls.push(args), click() {},
  };
  const schedule = buildSchedule(bars(hit('a')), options());
  const engine = new PlaybackEngine({ audioContext: context, kit, timers });
  engine.start(schedule);
  engine.stop();
  context.currentTime = 1;
  timers.tick();
  assert.equal(engine.isPlaying, false);
  assert.equal(calls.length, 1);
  assert.equal(kit.output.gain.value, 0);
});

test('position listeners receive ordered note and loop changes', () => {
  const context = new FakeAudioContext();
  const timers = new FakeTimers();
  const kit = { output: context.createGain(), play() {}, click() {} };
  const schedule = buildSchedule(bars(hit('a'), hit('b')), options({ loop: true }));
  const positions = [];
  const engine = new PlaybackEngine({ audioContext: context, kit, timers, scheduleAheadSec: 0.1 });
  engine.onPosition(position => positions.push(position));
  engine.start(schedule, { loop: true });
  context.currentTime = 0.51; timers.tick();
  context.currentTime = 2.01; timers.tick();
  assert.deepEqual(positions, [
    { barIndex: 0, noteIndex: 0, loopIndex: 0 },
    { barIndex: 0, noteIndex: 1, loopIndex: 0 },
    { barIndex: 0, noteIndex: 0, loopIndex: 1 },
  ]);
});

test('the synthetic kit plays every defined drum and the metronome click', () => {
  const context = new FakeAudioContext();
  const kit = createDrumKit(context);
  Object.keys(DRUMS).forEach((drum, index) => kit.play(drum, index));
  kit.click(20, { accent: true });
  assert.ok(context.started.length > Object.keys(DRUMS).length);
  assert.equal(context.started.length, context.stopped.length);
  assert.ok(context.started.every(node => node.stopTimes.length === 1));
});

test('scheduled-event bookkeeping stays small during a long loop', async () => {
  const { PlaybackEngine } = await import('../js/playback-engine.js');
  const { buildSchedule } = await import('../js/playback-schedule.js');
  let now = 0; let tick = null;
  const played = [];
  const audioContext = { get currentTime() { return now; } };
  const kit = { output: null, play: (drum, when) => played.push(when), click: () => {} };
  const bars = [{ barId: 'b1', provenance: {}, notes: [{ eventId: 'e1', duration: '8', dotted: false, drums: ['hi_hat_closed'] },
    { eventId: 'e2', duration: '8', dotted: false, drums: ['hi_hat_closed'] }, { eventId: 'e3', duration: 'h', dotted: false, drums: [] }] }];
  const schedule = buildSchedule(bars, { tempoBpm: 240, meter: { beats: 4, beatUnit: 4 }, fromBar: 1, toBar: 1, loop: true, metronome: false });
  const engine = new PlaybackEngine({ audioContext, kit, timers: { setInterval: fn => { tick = fn; return 1; }, clearInterval: () => {} } });
  engine.start(schedule, { loop: true, metronome: false });
  for (let i = 0; i < 4000; i++) { now += 0.025; tick(); }
  assert.ok(engine._scheduled.size < 20, `kept ${engine._scheduled.size} keys`);
  assert.equal(played.length, new Set(played).size, 'nothing was scheduled twice after pruning');
  assert.ok(played.length > 190, `played ${played.length} hits over 100 seconds of looping`);
});
