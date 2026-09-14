import test from 'node:test';
import assert from 'node:assert/strict';

import { DRUMS } from '../js/constants.js';
import { createMeta, toDocument, withIds } from '../js/score-document.js';
import { GM_DRUM_NOTES, scoreToMidi } from '../js/export-midi.js';
import { scoreToMusicXml } from '../js/export-musicxml.js';

function counter(prefix = 'id') {
  let number = 0;
  return () => `${prefix}-${++number}`;
}

function note(duration, drums = [], extra = {}) {
  return { duration, dotted: false, drums, ...extra };
}

function documentFor(bars, options = {}) {
  const ids = counter(options.idPrefix);
  const meta = createMeta({
    idFactory: ids,
    title: options.title ?? 'Export fixture',
    tempoBpm: options.tempoBpm ?? 120,
  });
  return toDocument({ ...meta, meter: options.meter ?? { beats: 4, beatUnit: 4 } }, withIds(bars, ids));
}

function readVlq(bytes, state) {
  let value = 0;
  let byte;
  do {
    byte = bytes[state.index++];
    value = (value << 7) | (byte & 0x7f);
  } while (byte & 0x80);
  return value;
}

function parseMidi(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'MThd');
  assert.equal(view.getUint32(4), 6);
  assert.equal(view.getUint16(8), 0);
  assert.equal(view.getUint16(10), 1);
  assert.equal(view.getUint16(12), 480);
  assert.equal(new TextDecoder().decode(bytes.slice(14, 18)), 'MTrk');

  const trackLength = view.getUint32(18);
  const track = bytes.slice(22, 22 + trackLength);
  const state = { index: 0 };
  let time = 0;
  const events = [];
  while (state.index < track.length) {
    time += readVlq(track, state);
    const status = track[state.index++];
    if (status === 0xff) {
      const type = track[state.index++];
      const length = readVlq(track, state);
      const data = track.slice(state.index, state.index + length);
      state.index += length;
      events.push({ time, type, data });
      if (type === 0x2f) break;
    } else {
      const data = [track[state.index++], track[state.index++]];
      events.push({ time, status, data });
    }
  }
  return events;
}

function assertBalancedXml(text) {
  const stack = [];
  const tags = /<!--[\s\S]*?-->|<\?[^>]*\?>|<!DOCTYPE[^>]*>|<([^>]+)>/g;
  for (const match of text.matchAll(tags)) {
    const tag = match[1];
    if (!tag) continue;
    if (tag.startsWith('!')) continue;
    if (tag.startsWith('/')) {
      assert.equal(stack.pop(), tag.slice(1).trim(), `closing ${tag}`);
    } else if (!tag.endsWith('/')) {
      stack.push(tag.split(/\s+/, 1)[0]);
    }
  }
  assert.deepEqual(stack, []);
}

test('GM drum map covers every DrumHub drum', () => {
  assert.deepEqual(Object.keys(GM_DRUM_NOTES).sort(), Object.keys(DRUMS).sort());
});

test('MIDI exports deterministic timing, metadata, chords, rests, dots and triplets', () => {
  const doc = documentFor([
    {
      notes: [
        note('q', ['kick', 'hi_hat_closed']),
        note('8', ['snare'], { dotted: true }),
        note('8', ['kick'], { triplet: true }),
        note('8', ['snare'], { triplet: true }),
        note('8', ['hi_hat_closed'], { triplet: true }),
        note('q'),
      ],
    },
    { notes: [note('q'), note('q', ['kick']), note('h', ['crash'])] },
  ], { title: 'Export fixture', tempoBpm: 120 });

  const bytes = scoreToMidi(doc);
  assert.deepEqual(bytes, scoreToMidi(doc));
  const events = parseMidi(bytes);
  const trackName = events.find(event => event.type === 0x03);
  const tempo = events.find(event => event.type === 0x51);
  const meter = events.find(event => event.type === 0x58);
  assert.equal(new TextDecoder().decode(trackName.data), 'Export fixture');
  assert.deepEqual([...tempo.data], [0x07, 0xa1, 0x20]); // 500,000 microseconds.
  assert.deepEqual([...meter.data], [4, 2, 24, 8]);

  const noteOns = events
    .filter(event => event.status === 0x99 && event.data[1] > 0)
    .map(event => ({ time: event.time, note: event.data[0], velocity: event.data[1] }));
  assert.deepEqual(noteOns, [
    { time: 0, note: 36, velocity: 96 },
    { time: 0, note: 42, velocity: 96 },
    { time: 480, note: 38, velocity: 96 },
    { time: 840, note: 36, velocity: 96 },
    { time: 1000, note: 38, velocity: 96 },
    { time: 1160, note: 42, velocity: 96 },
    { time: 2400, note: 36, velocity: 96 },
    { time: 2880, note: 49, velocity: 96 },
  ]);
  assert.ok(events.filter(event => event.status === 0x89).length >= noteOns.length);
  assert.ok(events.filter(event => event.status).every(event => (event.status & 0x0f) === 9));
  assert.equal(events.at(-1).type, 0x2f);
});

test('MusicXML exports a balanced part with linked percussion instruments and padding', () => {
  const doc = documentFor([
    {
      notes: [
        note('q', ['kick', 'hi_hat_closed']),
        note('8', ['ride_bell']),
        note('16', ['snare'], { dotted: true }),
        note('8', ['snare'], { triplet: true }),
        note('8', ['kick'], { triplet: true }),
        note('8', ['hi_hat_closed'], { triplet: true }),
        note('q'),
      ],
    },
    { notes: [note('h', ['kick'])] },
  ], { title: 'Tom & "Jerry" <3', tempoBpm: 105 });
  const text = scoreToMusicXml(doc);

  assertBalancedXml(text);
  assert.match(text, /<score-partwise version="4\.0">/);
  assert.match(text, /<work-title>Tom &amp; &quot;Jerry&quot; &lt;3<\/work-title>/);
  assert.match(text, /<part-name>Drum Set<\/part-name>/);
  assert.match(text, /<divisions>48<\/divisions>/);
  assert.match(text, /<beats>4<\/beats>[\s\S]*<beat-type>4<\/beat-type>/);
  assert.match(text, /<sign>percussion<\/sign>/);
  assert.match(text, /<sound tempo="105"\/>/);
  assert.match(text, /<chord\/>/);
  assert.match(text, /<dot\/>/);
  assert.match(text, /<time-modification>[\s\S]*<actual-notes>3<\/actual-notes>[\s\S]*<normal-notes>2<\/normal-notes>/);
  assert.equal((text.match(/<tuplet type="start"\/>/g) ?? []).length, 1);
  assert.equal((text.match(/<tuplet type="stop"\/>/g) ?? []).length, 1);
  assert.match(text, /<notehead>diamond<\/notehead>/);
  assert.match(text, /<notehead>x<\/notehead>/);
  assert.doesNotMatch(text, /<notehead>none<\/notehead>/, 'normal heads must stay visible');
  const snare = text.match(/<note>(?:(?!<\/note>)[\s\S])*?<display-step>C<\/display-step>\s*<display-octave>5<\/display-octave>(?:(?!<\/note>)[\s\S])*?<\/note>/)[0];
  assert.doesNotMatch(snare, /<notehead>/);
  assert.match(text, /<stem>up<\/stem>/);
  assert.match(text, /<stem>down<\/stem>/);
  assert.equal((text.match(/<score-instrument id="P1-I\d+">/g) ?? []).length, Object.keys(DRUMS).length);
  assert.equal((text.match(/<midi-instrument id="P1-I\d+">/g) ?? []).length, Object.keys(DRUMS).length);
  assert.match(text, /<score-instrument id="P1-I1">[\s\S]*?<instrument-name>kick<\/instrument-name>/);
  assert.match(text, /<midi-instrument id="P1-I1">[\s\S]*?<midi-unpitched>37<\/midi-unpitched>/);

  const measures = [...text.matchAll(/<measure number="\d+">([\s\S]*?)<\/measure>/g)].map(match => match[1]);
  assert.equal(measures.length, 2);
  for (const measure of measures) {
    let total = 0;
    for (const match of measure.matchAll(/<note>([\s\S]*?)<\/note>/g)) {
      if (!/<chord\/>/.test(match[1])) total += Number(match[1].match(/<duration>(\d+)<\/duration>/)?.[1] ?? 0);
    }
    total += [...measure.matchAll(/<forward>[\s\S]*?<duration>(\d+)<\/duration>/g)]
      .reduce((sum, match) => sum + Number(match[1]), 0);
    assert.equal(total, 192);
  }
});
