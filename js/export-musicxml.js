// ── Score → MusicXML 4.0 ─────────────────────────────────────────────────────
// Pure partwise export of a DrumHub document. MusicXML keeps DrumHub's 48
// ticks-per-quarter divisions, and underfilled bars receive a forward element.

import { DRUMS } from './constants.js';
import { meterTicks } from './score-document.js';
import { noteTicks, tripletStarts } from './bar.js';

import { GM_DRUM_NOTES } from './export-midi.js';

const DIVISIONS = 48;
const PART_ID = 'P1';

const TYPE_NAMES = {
  '32': '32nd',
  '16': '16th',
  '8': 'eighth',
  q: 'quarter',
  h: 'half',
  w: 'whole',
};

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function drumPitch(vexKey) {
  const match = /^([a-g])\/(\d+)$/i.exec(vexKey);
  if (!match) throw new Error(`Invalid drum staff key: ${vexKey}`);
  return { step: match[1].toUpperCase(), octave: match[2] };
}

// MusicXML notehead value, or null for a normal head. (MusicXML "none" means "draw no
// notehead", which would make kicks and snares invisible, so normal heads are omitted.)
function notehead(head) {
  return { n: null, x: 'x', cx: 'circle-x', h: 'diamond', tu: 'triangle' }[head] ?? null;
}

function instrumentId(drum) {
  const index = Object.keys(DRUMS).indexOf(drum);
  if (index < 0) throw new Error(`Unknown drum: ${drum}`);
  return `${PART_ID}-I${index + 1}`;
}

function stemDirection(note) {
  return note.drums.length > 0 && note.drums.every(drum => DRUMS[drum].stemDir === -1) ? 'down' : 'up';
}

function instrumentList() {
  return Object.keys(DRUMS).map(drum => {
    const id = instrumentId(drum);
    return [
      `      <score-instrument id="${id}">`,
      `        <instrument-name>${xml(drum)}</instrument-name>`,
      '      </score-instrument>',
      `      <midi-instrument id="${id}">`,
      '        <midi-channel>10</midi-channel>',
      `        <midi-unpitched>${GM_DRUM_NOTES[drum] + 1}</midi-unpitched>`,
      '      </midi-instrument>',
    ].join('\n');
  }).join('\n');
}

function attributes(doc) {
  return [
    '      <attributes>',
    `        <divisions>${DIVISIONS}</divisions>`,
    '        <time>',
    `          <beats>${xml(doc.meter.beats)}</beats>`,
    `          <beat-type>${xml(doc.meter.beatUnit)}</beat-type>`,
    '        </time>',
    '        <clef>',
    '          <sign>percussion</sign>',
    '          <line>2</line>',
    '        </clef>',
    '      </attributes>',
  ].join('\n');
}

function tupletType(tripletIndex, starts) {
  if (starts.has(tripletIndex)) return 'start';
  if (starts.has(tripletIndex - 2)) return 'stop';
  return null;
}

function noteXml(note, drum, chord, tuplet) {
  const duration = noteTicks(note);
  const common = [
    '      <note>',
    ...(chord ? ['        <chord/>'] : []),
  ];

  if (!drum) {
    common.push('        <rest/>');
  } else {
    const pitch = drumPitch(DRUMS[drum].vexKey);
    common.push(
      '        <unpitched>',
      `          <display-step>${pitch.step}</display-step>`,
      `          <display-octave>${pitch.octave}</display-octave>`,
      '        </unpitched>',
    );
  }

  common.push(`        <duration>${duration}</duration>`);
  if (drum) common.push(`        <instrument id="${instrumentId(drum)}"/>`);
  common.push(
    '        <voice>1</voice>',
    `        <type>${TYPE_NAMES[note.duration]}</type>`,
  );
  if (note.dotted) common.push('        <dot/>');
  if (note.triplet) {
    common.push(
      '        <time-modification>',
      '          <actual-notes>3</actual-notes>',
      '          <normal-notes>2</normal-notes>',
      '        </time-modification>',
    );
  }
  if (drum) {
    const head = notehead(DRUMS[drum].head);
    common.push(`        <stem>${stemDirection(note)}</stem>`, ...(head ? [`        <notehead>${head}</notehead>`] : []));
  }
  if (tuplet) {
    common.push('        <notations>', `          <tuplet type="${tuplet}"/>`, '        </notations>');
  }
  common.push('      </note>');
  return common.join('\n');
}

function noteGroupXml(note, index, starts) {
  const drums = note.drums.length > 0 ? note.drums : [null];
  const tuplet = note.triplet ? tupletType(index, starts) : null;
  return drums.map((drum, drumIndex) => noteXml(note, drum, drumIndex > 0, drumIndex === 0 ? tuplet : null)).join('\n');
}

function measureXml(doc, bar, index) {
  const lines = [`    <measure number="${index + 1}">`];
  if (index === 0) {
    lines.push(attributes(doc));
    lines.push(`      <sound tempo="${xml(doc.tempoBpm)}"/>`);
  }

  const starts = new Set(tripletStarts(bar));
  let filled = 0;
  bar.notes.forEach((note, noteIndex) => {
    lines.push(noteGroupXml(note, noteIndex, starts));
    filled += noteTicks(note);
  });
  const remaining = meterTicks(doc.meter) - filled;
  if (remaining < 0) throw new Error(`Bar ${index + 1} exceeds its meter`);
  if (remaining > 0) {
    lines.push('      <forward>', `        <duration>${remaining}</duration>`, '        <voice>1</voice>', '      </forward>');
  }
  lines.push('    </measure>');
  return lines.join('\n');
}

// Return a MusicXML 4.0 partwise document as UTF-8-safe text.
export function scoreToMusicXml(doc) {
  const measures = doc.bars.map((bar, index) => measureXml(doc, bar, index)).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    '  <work>',
    `    <work-title>${xml(doc.title)}</work-title>`,
    '  </work>',
    '  <part-list>',
    '    <score-part id="P1">',
    '      <part-name>Drum Set</part-name>',
    instrumentList(),
    '    </score-part>',
    '  </part-list>',
    '  <part id="P1">',
    measures,
    '  </part>',
    '</score-partwise>',
    '',
  ].join('\n');
}
