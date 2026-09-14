// ── Web Audio drum kit ───────────────────────────────────────────────────────
// These sounds are deliberately generated from oscillators and in-memory noise.
// There are no bundled samples, so the renderer does not carry sample licences
// or a loading step before a score can play.

import { DRUMS } from './constants.js';

const MIN_GAIN = 0.0001;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : max));
}

function setParam(param, method, value, time) {
  if (!param) return;
  if (typeof param[method] === 'function') param[method](value, time);
  else param.value = value;
}

function setFrequency(oscillator, value, time) {
  setParam(oscillator.frequency, 'setValueAtTime', value, time);
}

function connect(node, destination) {
  if (node && typeof node.connect === 'function') node.connect(destination);
}

function disconnect(node) {
  if (node && typeof node.disconnect === 'function') node.disconnect();
}

function noiseBuffer(audioContext, duration) {
  const sampleRate = audioContext.sampleRate || 44100;
  const buffer = audioContext.createBuffer(1, Math.max(1, Math.ceil(sampleRate * duration)), sampleRate);
  const channel = typeof buffer.getChannelData === 'function' ? buffer.getChannelData(0) : null;
  if (channel) {
    for (let i = 0; i < channel.length; i++) channel[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function envelope(audioContext, when, duration, peak, attack = 0.003) {
  const node = audioContext.createGain();
  const end = when + duration;
  const attackEnd = Math.min(end, when + attack);
  setParam(node.gain, 'setValueAtTime', 0, when);
  setParam(node.gain, 'linearRampToValueAtTime', peak, attackEnd);
  setParam(node.gain, 'exponentialRampToValueAtTime', MIN_GAIN, end);
  return node;
}

function filterNode(audioContext, type, frequency, q = 0.7, when = 0) {
  const node = audioContext.createBiquadFilter();
  node.type = type;
  setParam(node.frequency, 'setValueAtTime', frequency, when);
  setParam(node.Q, 'setValueAtTime', q, when);
  return node;
}

function scheduleVoice({ sources, nodes, when, duration }) {
  const end = when + duration;
  let ended = 0;
  let cleaned = false;
  const cleanup = () => {
    ended += 1;
    if (cleaned || ended < sources.length) return;
    cleaned = true;
    nodes.forEach(disconnect);
  };

  sources.forEach(source => {
    source.onended = cleanup;
    source.start(when);
    source.stop(end);
  });
}

function oscillatorVoice(audioContext, output, {
  when, duration, startFrequency, endFrequency = startFrequency,
  type = 'sine', peak = 0.5, attack = 0.003,
}) {
  const oscillator = audioContext.createOscillator();
  oscillator.type = type;
  setFrequency(oscillator, startFrequency, when);
  if (endFrequency !== startFrequency) {
    setParam(oscillator.frequency, 'exponentialRampToValueAtTime', endFrequency, when + duration);
  }
  const gain = envelope(audioContext, when, duration, peak, attack);
  connect(oscillator, gain);
  connect(gain, output);
  scheduleVoice({ sources: [oscillator], nodes: [oscillator, gain], when, duration });
}

function noiseVoice(audioContext, output, {
  when, duration, peak = 0.4, filter = null, attack = 0.001,
}) {
  const source = audioContext.createBufferSource();
  source.buffer = noiseBuffer(audioContext, duration);
  const gain = envelope(audioContext, when, duration, peak, attack);
  const nodes = [source, gain];
  if (filter) {
    connect(source, filter);
    connect(filter, gain);
    nodes.push(filter);
  } else connect(source, gain);
  connect(gain, output);
  scheduleVoice({ sources: [source], nodes, when, duration });
}

function hiHat(audioContext, output, when, velocity, duration) {
  noiseVoice(audioContext, output, {
    when, duration, peak: 0.34 * velocity,
    filter: filterNode(audioContext, 'highpass', 5200, 0.7, when),
  });
}

function kick(audioContext, output, when, velocity) {
  oscillatorVoice(audioContext, output, {
    when, duration: 0.32, startFrequency: 155, endFrequency: 48,
    peak: 0.78 * velocity, attack: 0.002,
  });
  noiseVoice(audioContext, output, {
    when, duration: 0.018, peak: 0.25 * velocity,
    filter: filterNode(audioContext, 'highpass', 1800, 0.8, when),
  });
}

function snare(audioContext, output, when, velocity) {
  noiseVoice(audioContext, output, {
    when, duration: 0.22, peak: 0.48 * velocity,
    filter: filterNode(audioContext, 'bandpass', 1900, 0.8, when),
  });
  oscillatorVoice(audioContext, output, {
    when, duration: 0.16, startFrequency: 190, endFrequency: 115,
    peak: 0.32 * velocity, attack: 0.002,
  });
}

function tom(audioContext, output, when, velocity, frequency) {
  oscillatorVoice(audioContext, output, {
    when, duration: 0.36, startFrequency: frequency, endFrequency: frequency * 0.62,
    peak: 0.62 * velocity, attack: 0.003,
  });
}

function metallic(audioContext, output, when, velocity, partials, duration) {
  partials.forEach(([frequency, level]) => oscillatorVoice(audioContext, output, {
    when, duration, startFrequency: frequency, type: 'square',
    peak: level * velocity, attack: 0.001,
  }));
}

function metronomeClick(audioContext, output, when, accent) {
  const frequency = accent ? 2200 : 1450;
  oscillatorVoice(audioContext, output, {
    when, duration: 0.045, startFrequency: frequency, type: 'square',
    peak: accent ? 0.52 : 0.34, attack: 0.001,
  });
}

// Create the renderer's complete synthetic kit. `output` is intentionally
// public so playback-engine.js can mute all already-scheduled voices on stop.
export function createDrumKit(audioContext) {
  if (!audioContext || typeof audioContext.createGain !== 'function') {
    throw new TypeError('createDrumKit requires a Web Audio AudioContext');
  }

  const output = audioContext.createGain();
  setParam(output.gain, 'setValueAtTime', 0.82, audioContext.currentTime || 0);
  connect(output, audioContext.destination);

  const play = (drum, when, { velocity = 1 } = {}) => {
    if (!Object.hasOwn(DRUMS, drum)) throw new RangeError(`Unknown drum: ${drum}`);
    const level = clamp(velocity, 0, 1);
    switch (drum) {
      case 'kick': return kick(audioContext, output, when, level);
      case 'snare': return snare(audioContext, output, when, level);
      case 'snare_rim':
        return oscillatorVoice(audioContext, output, {
          when, duration: 0.08, startFrequency: 1700, endFrequency: 900,
          type: 'square', peak: 0.38 * level, attack: 0.001,
        });
      case 'hi_hat_closed': return hiHat(audioContext, output, when, level, 0.08);
      case 'hi_hat_open_half': return hiHat(audioContext, output, when, level, 0.18);
      case 'hi_hat_open_full': return hiHat(audioContext, output, when, level, 0.45);
      case 'hi_hat_pedal':
        return noiseVoice(audioContext, output, {
          when, duration: 0.055, peak: 0.28 * level,
          filter: filterNode(audioContext, 'highpass', 3500, 0.8, when),
        });
      case 'floor_tom_2': return tom(audioContext, output, when, level, 88);
      case 'floor_tom_1': return tom(audioContext, output, when, level, 112);
      case 'tom_mid': return tom(audioContext, output, when, level, 150);
      case 'tom_hi': return tom(audioContext, output, when, level, 210);
      case 'crash':
        return noiseVoice(audioContext, output, {
          when, duration: 0.9, peak: 0.52 * level,
          filter: filterNode(audioContext, 'bandpass', 5200, 0.45, when),
        });
      case 'ride':
        return metallic(audioContext, output, when, level,
          [[2300, 0.16], [3000, 0.12], [3900, 0.09], [5100, 0.06]], 0.58);
      case 'ride_bell':
        return metallic(audioContext, output, when, level,
          [[2850, 0.2], [4100, 0.15], [5700, 0.1], [7200, 0.06]], 0.42);
      default:
        // DRUMS is the source of truth; this branch protects the kit if a new
        // definition is added before its characteristic is tuned.
        return oscillatorVoice(audioContext, output, {
          when, duration: 0.12, startFrequency: 180, endFrequency: 100,
          peak: 0.35 * level,
        });
    }
  };

  const click = (when, { accent = false } = {}) => {
    metronomeClick(audioContext, output, when, Boolean(accent));
  };

  return { play, click, output };
}
