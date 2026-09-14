// ── Score → Standard MIDI File ───────────────────────────────────────────────
// Pure export of a DrumHub document as a deterministic format-0 MIDI file.
// DrumHub's 48 ticks per quarter note are scaled to MIDI's 480 ticks per
// quarter, while bars keep their meter-sized offset even when underfilled.

import { DRUMS } from './constants.js';
import { meterTicks } from './score-document.js';
import { noteTicks } from './bar.js';

// General MIDI percussion note numbers. Keep this list in sync with DRUMS.
export const GM_DRUM_NOTES = {
  kick: 36,
  snare: 38,
  snare_rim: 37,
  hi_hat_closed: 42,
  hi_hat_pedal: 44,
  hi_hat_open_half: 46,
  hi_hat_open_full: 46,
  crash: 49,
  ride: 51,
  ride_bell: 53,
  tom_hi: 50,
  tom_mid: 47,
  floor_tom_1: 43,
  floor_tom_2: 41,
};

const MIDI_PPQ = 480;
const DRUM_CHANNEL = 9; // MIDI channel 10, represented internally as zero-based 9.
const NOTE_ON = 0x90 | DRUM_CHANNEL;
const NOTE_OFF = 0x80 | DRUM_CHANNEL;
const VELOCITY = 96;

function uint16(value) {
  return [(value >> 8) & 0xff, value & 0xff];
}

function uint32(value) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function vlq(value) {
  let buffer = value & 0x7f;
  const bytes = [];
  while ((value >>= 7)) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  for (;;) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else return bytes;
  }
}

function utf8(text) {
  return [...new TextEncoder().encode(String(text))];
}

function metaEvent(type, data) {
  return [0xff, type, ...vlq(data.length), ...data];
}

function tempoData(tempoBpm) {
  const micros = Math.round(60_000_000 / tempoBpm);
  return [(micros >> 16) & 0xff, (micros >> 8) & 0xff, micros & 0xff];
}

function timeSignatureData(meter) {
  return [meter.beats, Math.round(Math.log2(meter.beatUnit)), 24, 8];
}

function noteEvents(doc) {
  const events = [];
  const barLength = meterTicks(doc.meter) * 10;
  let sequence = 0;

  doc.bars.forEach((bar, barIndex) => {
    let offset = 0;
    for (const note of bar.notes) {
      const duration = noteTicks(note) * 10;
      const onset = barIndex * barLength + offset;
      if (note.drums.length > 0) {
        for (const drum of note.drums) {
          const midiNote = GM_DRUM_NOTES[drum];
          if (midiNote === undefined || !Object.hasOwn(DRUMS, drum)) {
            throw new Error(`Unknown drum: ${drum}`);
          }
          events.push({ time: onset, kind: 1, note: midiNote, sequence: sequence++, bytes: [NOTE_ON, midiNote, VELOCITY] });
          events.push({ time: onset + Math.max(1, duration - 1), kind: 0, note: midiNote, sequence: sequence++, bytes: [NOTE_OFF, midiNote, 0] });
        }
      }
      offset += duration;
    }
  });

  // Stable sequence is only a final tie-breaker; the observable order is the
  // requested time, note-off, note-on, then note number ordering.
  return events.sort((a, b) => a.time - b.time || a.kind - b.kind || a.note - b.note || a.sequence - b.sequence);
}

function makeTrack(doc) {
  const data = [];
  const append = (delta, bytes) => data.push(...vlq(delta), ...bytes);
  append(0, metaEvent(0x03, utf8(doc.title)));
  append(0, metaEvent(0x51, tempoData(doc.tempoBpm)));
  append(0, metaEvent(0x58, timeSignatureData(doc.meter)));

  let previousTime = 0;
  for (const event of noteEvents(doc)) {
    append(event.time - previousTime, event.bytes);
    previousTime = event.time;
  }
  append(0, [0xff, 0x2f, 0x00]);
  return data;
}

// Return a format-0, one-track SMF. The result is a fresh Uint8Array each time.
export function scoreToMidi(doc) {
  const track = makeTrack(doc);
  return new Uint8Array([
    0x4d, 0x54, 0x68, 0x64,
    0x00, 0x00, 0x00, 0x06,
    ...uint16(0), ...uint16(1), ...uint16(MIDI_PPQ),
    0x4d, 0x54, 0x72, 0x6b, ...uint32(track.length), ...track,
  ]);
}
