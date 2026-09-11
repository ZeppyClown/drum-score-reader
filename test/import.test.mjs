import test from 'node:test';
import assert from 'node:assert/strict';

import { barFromPrediction, MODEL_DURATIONS, PredictionError } from '../js/import.js';
import { barTicks, toggleDrum, toggleTriplet, tripletStarts } from '../js/bar.js';
import { BAR_TICKS } from '../js/constants.js';
import { contractList } from './contract.mjs';

// A /predict note as the local OMR service returns it.
const p = (position, duration, ...drums) => ({ position, duration, drums });

// Editor notes.
const n = (duration, ...drums) => ({ duration, dotted: false, drums });
const dotted = (duration, ...drums) => ({ duration, dotted: true, drums });
const t = (duration, ...drums) => ({ duration, dotted: false, triplet: true, drums });

function frozen(value) {
  Object.values(value).forEach(v => { if (v && typeof v === 'object') frozen(v); });
  return Object.freeze(value);
}

function convert(...notes) {
  return barFromPrediction(frozen(notes));
}

const codes = result => result.warnings.map(w => w.code);

test('every model duration has an editor shape, and no extras', () => {
  assert.deepEqual(Object.keys(MODEL_DURATIONS).sort(), contractList('DURATIONS').sort());
});

test('a straight eighth-note groove imports unchanged', () => {
  const hh = 'hi_hat_closed';
  const result = convert(
    p(0, 'eighth', 'kick', hh), p(4, 'eighth', hh), p(8, 'eighth', 'snare', hh), p(12, 'eighth', hh),
    p(16, 'eighth', 'kick', hh), p(20, 'eighth', hh), p(24, 'eighth', 'snare', hh), p(28, 'eighth', hh));
  assert.deepEqual(result.bar.notes, [
    n('8', 'kick', hh), n('8', hh), n('8', 'snare', hh), n('8', hh),
    n('8', 'kick', hh), n('8', hh), n('8', 'snare', hh), n('8', hh),
  ]);
  assert.deepEqual(result.warnings, []);
});

test('silence between hits becomes rests', () => {
  const result = convert(p(0, 'quarter', 'kick'), p(16, 'half', 'snare'));
  assert.deepEqual(result.bar.notes, [n('q', 'kick'), n('q'), n('h', 'snare')]);
  assert.deepEqual(result.warnings, []);
});

test('a written duration that overlaps the next hit is shortened and reported', () => {
  const result = convert(p(0, 'half', 'kick'), p(8, 'quarter', 'snare'));
  assert.deepEqual(result.bar.notes, [n('q', 'kick'), n('q', 'snare'), n('h')]);
  assert.deepEqual(result.warnings, [{
    code: 'shortened', position: 0,
    message: 'The note on beat 1 was shortened so it ends before the next note',
  }]);
});

test('a last note that runs past the bar is shortened to end at the barline', () => {
  const result = convert(p(24, 'half', 'crash'));
  assert.deepEqual(result.bar.notes, [n('h'), n('q'), n('q', 'crash')]);
  assert.deepEqual(codes(result), ['shortened']);
});

test('dotted notes keep their dots', () => {
  const result = convert(p(0, 'dotted_quarter', 'kick'), p(12, 'eighth', 'snare'));
  assert.deepEqual(result.bar.notes, [dotted('q', 'kick'), n('8', 'snare'), n('h')]);
});

test('triplet eighths rounded onto the 32nd grid land in the right slots', () => {
  const result = convert(
    p(0, 'triplet_eighth', 'kick'), p(3, 'triplet_eighth', 'snare'),
    p(5, 'triplet_eighth', 'hi_hat_closed'), p(8, 'quarter', 'crash'));
  assert.deepEqual(result.bar.notes, [
    t('8', 'kick'), t('8', 'snare'), t('8', 'hi_hat_closed'), n('q', 'crash'), n('h'),
  ]);
  assert.deepEqual(tripletStarts(result.bar), [0]);
  assert.deepEqual(result.warnings, []);
});

test('a missing triplet hit leaves a triplet rest', () => {
  const result = convert(p(0, 'triplet_eighth', 'kick'), p(5, 'triplet_eighth', 'hi_hat_closed'));
  assert.deepEqual(result.bar.notes, [t('8', 'kick'), t('8'), t('8', 'hi_hat_closed'), n('h'), n('q')]);
});

test('triplet sixteenths group from the start of their eighth', () => {
  const result = convert(
    p(8, 'triplet_sixteenth', 'snare'), p(9, 'triplet_sixteenth', 'snare'), p(11, 'triplet_sixteenth', 'snare'));
  assert.deepEqual(result.bar.notes, [
    n('q'), t('16', 'snare'), t('16', 'snare'), t('16', 'snare'), n('h'), n('8'),
  ]);
});

test('hits that share a triplet slot become a chord, and plain hits inside are folded in', () => {
  const result = convert(
    p(0, 'triplet_eighth', 'kick'), p(1, 'triplet_eighth', 'snare'), p(2, 'sixteenth', 'hi_hat_closed'));
  assert.deepEqual(result.bar.notes, [t('8', 'kick', 'snare'), t('8', 'hi_hat_closed'), t('8'), n('h'), n('q')]);
  assert.deepEqual(codes(result), ['merged_into_chord', 'merged_into_triplet']);
});

test('a triplet whose beat started under the previous note is imported as a plain note', () => {
  const result = convert(p(0, 'dotted_quarter', 'kick'), p(13, 'triplet_eighth', 'snare'));
  assert.deepEqual(result.bar.notes, [
    dotted('q', 'kick'), n('32'), n('8', 'snare'), n('q'), n('8'), n('16'), n('32'),
  ]);
  assert.deepEqual(codes(result), ['triplet_unplaced']);
  assert.match(result.warnings[0].message, /beat 2\.625/);
});

test('an empty prediction is a bar of rest', () => {
  assert.deepEqual(convert().bar.notes, [n('w')]);
});

test('every imported bar is a full bar the editor rules can keep editing', () => {
  const fixtures = [
    [p(0, 'quarter', 'kick'), p(16, 'half', 'snare')],
    [p(0, 'triplet_eighth', 'kick'), p(5, 'triplet_eighth', 'hi_hat_closed')],
    [p(0, 'dotted_quarter', 'kick'), p(13, 'triplet_eighth', 'snare')],
    [p(31, 'thirty_second', 'crash')],
  ];
  for (const fixture of fixtures) {
    const { bar } = convert(...fixture);
    assert.equal(barTicks(bar), BAR_TICKS);
    assert.notEqual(toggleDrum(bar, 0, 'ride'), bar);
  }
  const { bar } = convert(p(0, 'triplet_eighth', 'kick'), p(5, 'triplet_eighth', 'hi_hat_closed'));
  assert.deepEqual(toggleTriplet(bar, 0).notes.slice(0, 2), [n('8', 'kick'), n('8', 'hi_hat_closed')]);
});

test('output that cannot be a bar is rejected with a clear reason', () => {
  const cases = [
    [() => barFromPrediction({ notes: [] }), /must be a list of notes/],
    [() => barFromPrediction([p(32, 'eighth', 'kick')]), /Note 1 has an invalid position: 32/],
    [() => barFromPrediction([p(4, 'eighth', 'kick'), p(4, 'eighth', 'snare')]), /Note 2 is out of order/],
    [() => barFromPrediction([p(0, 'quintuplet', 'kick')]), /unknown duration: quintuplet/],
    [() => barFromPrediction([p(0, 'eighth')]), /Note 1 has no drums/],
    [() => barFromPrediction([p(0, 'eighth', 'cowbell')]), /unknown drum: cowbell/],
    [() => barFromPrediction([], { gridSlots: 30 }), /Unsupported beat grid of 30/],
  ];
  for (const [run, message] of cases) {
    assert.throws(run, error => error instanceof PredictionError && message.test(error.message));
  }
});
