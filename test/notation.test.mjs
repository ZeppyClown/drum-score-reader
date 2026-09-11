import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { DRUMS, KEY_DRUMS, SHIFT_KEY_DRUMS } from '../js/constants.js';
import { drumKey, noteKeys, noteStemDir } from '../js/notation.js';

// Read the model's drum list from the training contract so the two cannot drift apart.
function modelDrums() {
  const source = fs.readFileSync(new URL('../ml/omr/training_contract.py', import.meta.url), 'utf8');
  const block = /^DRUMS = \[([\s\S]*?)\]/m.exec(source);
  assert.ok(block, 'DRUMS list not found in training_contract.py');
  return [...block[1].matchAll(/'([a-z0-9_]+)'/g)].map(match => match[1]);
}

const sorted = list => [...list].sort();

test('the editor knows exactly the 14 drums the OMR model reads', () => {
  const model = modelDrums();
  assert.equal(model.length, 14);
  assert.deepEqual(sorted(Object.keys(DRUMS)), sorted(model));
});

test('every drum is reachable from exactly one key or Shift+key', () => {
  const reachable = [...Object.values(KEY_DRUMS), ...Object.values(SHIFT_KEY_DRUMS)];
  assert.equal(new Set(reachable).size, reachable.length);
  assert.deepEqual(sorted(reachable), sorted(Object.keys(DRUMS)));
});

test('no two drums share both staff position and notehead', () => {
  const looks = Object.values(DRUMS).map(d => `${d.vexKey}/${d.head}`);
  assert.equal(new Set(looks).size, looks.length);
});

test('chord keys carry each drum’s own notehead shape', () => {
  assert.deepEqual(noteKeys({ drums: ['snare', 'hi_hat_closed', 'ride_bell'] }), ['c/5', 'f/5/x', 'b/5/h']);
  assert.deepEqual(noteKeys({ drums: [] }), ['b/4']);
  assert.throws(() => drumKey('cowbell'), /Unknown drum: cowbell/);
});

test('stems point down only when every drum in the chord is a foot or floor drum', () => {
  assert.equal(noteStemDir({ drums: ['kick', 'hi_hat_pedal'] }), -1);
  assert.equal(noteStemDir({ drums: ['kick', 'hi_hat_closed'] }), 1);
  assert.equal(noteStemDir({ drums: [] }), 1);
});
