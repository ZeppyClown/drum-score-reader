import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCHEMA_VERSION, DocumentError, createMeta, withIds, toDocument, splitDocument,
  validateDocument, parseDocument, serializeDocument, manualProvenance, importedProvenance,
  meterTicks, isEditableMeter,
} from '../js/score-document.js';

// Deterministic ids so documents can be compared exactly.
function counter(prefix = 'id') {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

const hit = (duration, drums = ['snare'], extra = {}) => ({ duration, dotted: false, drums, ...extra });
const legacyBars = () => [
  { notes: [hit('q', ['kick', 'hi_hat_closed']), hit('q'), hit('h', [])] },
  { notes: [] },
];

function validDoc(overrides = {}) {
  const ids = counter();
  return { ...toDocument(createMeta({ idFactory: ids }), withIds(legacyBars(), ids)), ...overrides };
}

test('createMeta starts an untitled 4/4 score at revision 0', () => {
  const meta = createMeta({ idFactory: () => 'score-1' });
  assert.deepEqual(meta, {
    schemaVersion: SCHEMA_VERSION, scoreId: 'score-1', revision: 0,
    title: 'Untitled score', tempoBpm: 90, meter: { beats: 4, beatUnit: 4 },
  });
});

test('createMeta generates a UUID by default', () => {
  assert.match(createMeta().scoreId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('withIds migrates existing bars in memory without changing their notes', () => {
  const bars = withIds(legacyBars(), counter());
  assert.equal(bars[0].barId, 'id-1');
  assert.deepEqual(bars[0].provenance, manualProvenance());
  assert.deepEqual(bars[0].notes.map(n => n.eventId), ['id-2', 'id-3', 'id-4']);
  assert.equal(bars[1].barId, 'id-5');
  const stripped = bars.map(({ notes }) => ({ notes: notes.map(({ eventId, ...note }) => note) }));
  assert.deepEqual(stripped, legacyBars());
});

test('withIds returns the same objects when every id is already present', () => {
  const bars = withIds(legacyBars(), counter());
  const again = withIds(bars, () => { throw new Error('must not generate'); });
  assert.equal(again, bars);
  const edited = [{ ...bars[0], notes: [...bars[0].notes, hit('8')] }, bars[1]];
  const filled = withIds(edited, counter('new'));
  assert.equal(filled[1], bars[1]);
  assert.equal(filled[0].notes[0], bars[0].notes[0]);
  assert.equal(filled[0].notes[3].eventId, 'new-1');
});

test('importedProvenance is always unreviewed and keeps model and warnings', () => {
  assert.deepEqual(importedProvenance({ source: 'openai_omr', model: 'gpt-5.6-luna', warnings: ['faint snare'] }),
    { source: 'openai_omr', reviewed: false, warnings: ['faint snare'], model: 'gpt-5.6-luna' });
  assert.throws(() => importedProvenance({ source: 'manual' }), DocumentError);
});

test('splitDocument and toDocument round-trip', () => {
  const doc = validDoc();
  const { meta, bars } = splitDocument(doc);
  assert.equal(meta.bars, undefined);
  assert.deepEqual(toDocument(meta, bars), doc);
});

test('a migrated editor score is valid', () => {
  assert.deepEqual(validateDocument(validDoc()), []);
});

test('validation rejects bad metadata and meter', () => {
  const cases = [
    [{ schemaVersion: 2 }, /schemaVersion/],
    [{ scoreId: '' }, /scoreId/],
    [{ scoreId: 'has spaces/../x' }, /scoreId/],
    [{ revision: -1 }, /revision/],
    [{ revision: 1.5 }, /revision/],
    [{ title: 42 }, /title/],
    [{ title: 'x'.repeat(201) }, /title/],
    [{ tempoBpm: 0 }, /tempo/],
    [{ tempoBpm: 400 }, /tempo/],
    [{ meter: { beats: 0, beatUnit: 4 } }, /meter/],
    [{ meter: { beats: 4, beatUnit: 5 } }, /meter/],
    [{ meter: null }, /meter/],
    [{ bars: [] }, /at least one bar/],
    [{ extra: true }, /Unknown field "extra"/],
  ];
  for (const [override, pattern] of cases) {
    const errors = validateDocument(validDoc(override));
    assert.ok(errors.some(e => pattern.test(e)), `${JSON.stringify(override)} → ${errors}`);
  }
  assert.match(validateDocument(null)[0], /object/);
});

test('other valid meters are allowed but only 4/4 is editable, and bars must fit the meter', () => {
  assert.deepEqual(meterTicks({ beats: 4, beatUnit: 4 }), 192);
  assert.deepEqual(meterTicks({ beats: 6, beatUnit: 8 }), 144);
  assert.equal(isEditableMeter({ beats: 4, beatUnit: 4 }), true);
  assert.equal(isEditableMeter({ beats: 3, beatUnit: 4 }), false);
  const waltz = validDoc({ meter: { beats: 3, beatUnit: 4 } });
  const fits = { ...waltz, bars: [{ ...waltz.bars[0], notes: waltz.bars[0].notes.slice(0, 2).concat({ eventId: 'r1', duration: 'q', dotted: false, drums: [] }) }] };
  assert.deepEqual(validateDocument(fits), []);
  assert.ok(validateDocument(waltz).some(e => /overfills a 3\/4 bar/.test(e)));
});

test('validation rejects bad ids and provenance', () => {
  const doc = validDoc();
  const withBar = (i, bar) => ({ ...doc, bars: doc.bars.map((b, j) => (i === j ? bar : b)) });
  const cases = [
    [withBar(1, { ...doc.bars[1], barId: doc.bars[0].barId }), /Duplicate id/],
    [withBar(1, { ...doc.bars[1], notes: [{ ...doc.bars[0].notes[0] }] }), /Duplicate id/],
    [withBar(0, { ...doc.bars[0], barId: undefined }), /barId/],
    [withBar(0, { ...doc.bars[0], provenance: { ...doc.bars[0].provenance, source: 'gemini' } }), /source/],
    [withBar(0, { ...doc.bars[0], provenance: { ...doc.bars[0].provenance, reviewed: 'yes' } }), /reviewed/],
    [withBar(0, { ...doc.bars[0], provenance: { ...doc.bars[0].provenance, warnings: [3] } }), /warnings/],
    [withBar(0, { ...doc.bars[0], provenance: undefined }), /provenance/],
  ];
  for (const [bad, pattern] of cases) {
    const errors = validateDocument(bad);
    assert.ok(errors.some(e => pattern.test(e)), errors.join('; '));
  }
});

test('validation rejects impossible notes and overfilled bars', () => {
  const doc = validDoc();
  const withNotes = notes => ({ ...doc, bars: [{ ...doc.bars[0], notes: notes.map((n, i) => ({ eventId: `e${i}`, ...n })) }] });
  const cases = [
    [[hit('x')], /duration/],
    [[hit('q', ['cowbell'])], /drum/],
    [[hit('q', [undefined])], /unknown drum "undefined"/],
    [[hit('q', [null, 'snare'])], /unknown drum "null"/],
    [[hit('q', ['snare', 'snare'])], /repeats/],
    [[hit('q', 'snare')], /drums/],
    [[hit('32', ['snare'], { dotted: true })], /dotted 32nd/],
    [[hit('8', ['snare'], { triplet: true, dotted: true })], /dotted triplet/],
    [[hit('8', ['snare'], { triplet: true }), hit('8')], /triplet group/],
    [[hit('w'), hit('8')], /overfills/],
    [[hit('q', ['snare'], { accent: true })], /Unknown field "accent"/],
  ];
  for (const [notes, pattern] of cases) {
    const errors = validateDocument(withNotes(notes));
    assert.ok(errors.some(e => pattern.test(e)), `${JSON.stringify(notes)} → ${errors}`);
  }
  const triplets = [0, 1, 2].map(() => hit('8', ['snare'], { triplet: true }));
  assert.deepEqual(validateDocument(withNotes([...triplets, hit('h', []), hit('q')])), []);
});

test('serialize then parse returns an equal document', () => {
  const doc = validDoc({ title: 'Back in Black' });
  const text = serializeDocument(doc);
  assert.match(text, /\n  "schemaVersion": 1,/);
  assert.ok(text.endsWith('\n'));
  assert.deepEqual(parseDocument(text), doc);
});

test('serialize refuses an invalid document', () => {
  assert.throws(() => serializeDocument(validDoc({ tempoBpm: -5 })), /tempo/);
});

test('parse explains unreadable, future-version and invalid files', () => {
  assert.throws(() => parseDocument('{nope'), /not valid JSON/);
  assert.throws(() => parseDocument('[]'), /not a DrumHub score/);
  assert.throws(() => parseDocument(JSON.stringify(validDoc({ schemaVersion: 7 }))),
    err => err instanceof DocumentError && err.code === 'future_version' && /newer version/.test(err.message));
  assert.throws(() => parseDocument(JSON.stringify(validDoc({ tempoBpm: 'fast' }))),
    err => err.code === 'invalid' && /tempo/.test(err.message));
});

test('parse migrates a legacy editor export that has only bars', () => {
  const doc = parseDocument(JSON.stringify({ bars: legacyBars() }), { idFactory: counter('m') });
  assert.equal(doc.schemaVersion, SCHEMA_VERSION);
  assert.equal(doc.revision, 0);
  assert.equal(doc.bars[0].notes[0].eventId, 'm-3');
  assert.deepEqual(validateDocument(doc), []);
});
