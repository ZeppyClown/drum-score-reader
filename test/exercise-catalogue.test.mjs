import test from 'node:test';
import assert from 'node:assert/strict';

import { DRUMS } from '../js/constants.js';
import { createMeta, toDocument, validateDocument, withIds } from '../js/score-document.js';
import { createEditor, execute, undo } from '../js/commands.js';
import { scoreSnapshot } from '../js/score-snapshot.js';
import { inspectBars, findComplexPassages } from '../js/score-analysis.js';
import { songEditor } from './fixture-scores.mjs';
import { EXERCISES, FILLS } from '../js/exercise-catalogue.js';
import {
  searchExercises, exercisesForPassage, recommendFills,
  validateGeneratedFill, insertExerciseCommand,
} from '../js/exercise-search.js';

const allItems = [...EXERCISES, ...FILLS];
const levels = new Set(['beginner', 'intermediate', 'advanced']);
const kinds = new Set(['exercise', 'fill']);
const subdivisions = new Set(['whole', 'half', 'quarter', 'dotted quarter', '8th', 'dotted 8th', 'triplet 8th', '16th', 'dotted 16th', 'triplet 16th', '32nd']);
const limbs = new Set(['hands', 'feet']);
const counter = (prefix = 'id') => {
  let next = 0;
  return () => `${prefix}-${++next}`;
};

function validFragment(item) {
  const idFactory = counter(item.id);
  const document = toDocument(createMeta({ idFactory, title: item.title, tempoBpm: item.tempo.target }), withIds(item.bars, idFactory));
  return validateDocument(document);
}

test('catalogue is frozen, original, complete, and every fragment is a valid full bar', () => {
  assert.ok(Object.isFrozen(EXERCISES));
  assert.ok(Object.isFrozen(FILLS));
  assert.ok(EXERCISES.length >= 24 && EXERCISES.length <= 30);
  assert.ok(FILLS.length >= 18 && FILLS.length <= 24);
  assert.equal(new Set(allItems.map(item => item.id)).size, allItems.length);

  for (const item of allItems) {
    assert.match(item.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(kinds.has(item.kind));
    assert.match(item.title, /\S/);
    assert.ok(levels.has(item.level));
    assert.ok(Array.isArray(item.styles) && item.styles.length > 0);
    assert.ok(subdivisions.has(item.subdivision), `${item.id} subdivision`);
    assert.ok(item.limbs.every(limb => limbs.has(limb)));
    assert.ok(item.goals.length > 0);
    assert.ok(Number.isInteger(item.tempo.min) && Number.isInteger(item.tempo.target) && Number.isInteger(item.tempo.max));
    assert.ok(item.tempo.min >= 40 && item.tempo.target <= 220 && item.tempo.min <= item.tempo.target && item.tempo.target <= item.tempo.max);
    assert.deepEqual(item.source, { owner: 'DrumHub', license: 'original', reviewedByTeacher: false });
    assert.ok(item.bars.length >= 1 && item.bars.length <= 2);
    if (item.kind === 'fill') assert.equal(item.bars.length, 1);
    assert.deepEqual(validFragment(item), [], item.id);
    for (const fragment of item.bars) {
      for (const note of fragment.notes) {
        assert.ok(note.drums.every(drum => Object.hasOwn(DRUMS, drum)), `${item.id} drum ${note.drums}`);
      }
    }
  }
});

test('prerequisites exist and form an acyclic graph', () => {
  const byId = new Map(allItems.map(item => [item.id, item]));
  for (const item of allItems) for (const prerequisite of item.prerequisites) assert.ok(byId.has(prerequisite), `${item.id} -> ${prerequisite}`);
  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    if (visiting.has(id)) throw new Error(`cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const prerequisite of byId.get(id).prerequisites) visit(prerequisite);
    visiting.delete(id);
    visited.add(id);
  };
  for (const item of allItems) visit(item.id);
});

test('search filters are applied before deterministic ranking', () => {
  const beginnerFunk = searchExercises({ level: 'beginner', styles: ['rock'], maxTempo: 120 });
  assert.ok(beginnerFunk.length > 0);
  for (const result of beginnerFunk) {
    const item = EXERCISES.find(candidate => candidate.id === result.id);
    assert.equal(item.level, 'beginner');
    assert.ok(item.styles.includes('rock'));
    assert.ok(item.tempo.max <= 120);
  }
  const fills = searchExercises({ kind: 'fill', goals: ['tom movement'] }, { catalogue: FILLS });
  assert.ok(fills.length > 0);
  assert.ok(fills.every(result => FILLS.find(item => item.id === result.id).kind === 'fill'));
  assert.deepEqual(searchExercises({ text: 'sixteenth kick' }), searchExercises({ text: 'sixteenth kick' }));
  assert.deepEqual(searchExercises({ text: 'sixteenth kick' }).map(result => result.id),
    [...searchExercises({ text: 'sixteenth kick' })].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).map(result => result.id));
});

test('passage retrieval maps 16ths and triplets to explainable exercises', () => {
  const snapshot = scoreSnapshot(songEditor());
  const ranked = findComplexPassages(snapshot, { top: 10 }).ranked;
  const barsSevenEight = inspectBars(snapshot, { fromBar: 7, toBar: 8 });
  const sixteenths = exercisesForPassage({ ...barsSevenEight, ranked });
  assert.ok(sixteenths.length <= 3 && sixteenths.length > 0);
  assert.ok(sixteenths.every(result => result.reasons.some(reason => /bar 7/.test(reason) && /16th/.test(reason))));

  const barTen = inspectBars(snapshot, { fromBar: 10, toBar: 10 });
  const triplets = exercisesForPassage({ ...barTen, ranked });
  assert.ok(triplets.length > 0 && triplets.length <= 3);
  assert.ok(triplets.every(result => result.reasons.some(reason => /bar 10/.test(reason))));
  assert.ok(triplets.some(result => result.reasons.some(reason => /triplet/.test(reason))));
});

test('fill recommendations respect tempo, level, subdivision, and one-bar scope', () => {
  const results = recommendFills({ tempoBpm: 100, subdivision: '16th', level: 'intermediate', style: 'rock' });
  assert.ok(results.length > 0 && results.length <= 3);
  for (const result of results) {
    const item = FILLS.find(candidate => candidate.id === result.id);
    assert.ok(item);
    assert.equal(item.bars.length, 1);
    assert.ok(['beginner', 'intermediate'].includes(item.level));
    assert.ok(item.tempo.min <= 100 && 100 <= item.tempo.max);
    assert.ok(['quarter', '8th', '16th'].includes(item.subdivision));
  }
  assert.deepEqual(recommendFills({ tempoBpm: 100, subdivision: '16th', level: 'intermediate', style: 'rock' }), results);
  assert.deepEqual(recommendFills({ tempoBpm: 100, subdivision: '16th', level: 'intermediate', style: 'rock', bars: 2 }), []);
});

test('generated-fill validation rejects malformed bars and accepts a good one', () => {
  const good = FILLS[0].bars[0].notes;
  assert.equal(validateGeneratedFill(good).ok, true);
  assert.match(validateGeneratedFill([...good, { duration: 'q', dotted: false, drums: [] }]).errors.join(' '), /overfills|complete/);
  assert.match(validateGeneratedFill([
    { duration: 'q', dotted: false, drums: ['unknown_drum'] }, { duration: 'q', dotted: false, drums: [] },
    { duration: 'q', dotted: false, drums: [] }, { duration: 'q', dotted: false, drums: [] },
  ]).errors.join(' '), /unknown drum/);
  assert.match(validateGeneratedFill([
    { duration: '8', dotted: false, triplet: true, drums: ['snare'] },
    { duration: '8', dotted: false, triplet: true, drums: ['snare'] },
    { duration: '8', dotted: false, drums: ['snare'] },
    { duration: 'q', dotted: false, drums: [] }, { duration: 'q', dotted: false, drums: [] }, { duration: 'q', dotted: false, drums: [] },
  ]).errors.join(' '), /triplet/);
  assert.doesNotThrow(() => validateGeneratedFill(null));
});

test('exercise insertion copies manual reviewed bars and undo removes one edit', () => {
  const idFactory = counter('editor');
  const editor = createEditor({ meta: createMeta({ idFactory }), bars: [{ notes: [] }], idFactory });
  const before = JSON.stringify(EXERCISES[0].bars);
  const inserted = execute(editor, insertExerciseCommand(EXERCISES[0]));
  assert.equal(inserted.bars.length, EXERCISES[0].bars.length);
  assert.equal(inserted.bars[0].provenance.source, 'manual');
  assert.equal(inserted.bars[0].provenance.reviewed, true);
  assert.notEqual(inserted.bars[0].notes, EXERCISES[0].bars[0].notes);
  assert.equal(JSON.stringify(EXERCISES[0].bars), before);
  assert.equal(undo(inserted).bars, editor.bars);
});

test('quarter notes are not counted as off-beat hits, and fill reasons never say "undefined"', async () => {
  const { exercisesForPassage: forPassage, recommendFills: fills } = await import('../js/exercise-search.js');
  const quarterBar = { bars: [{ barNumber: 1, smallestNote: 'quarter', tripletGroups: 0, rests: 0,
    events: [0, 48, 96, 144].map((onset, i) => ({ count: String(i + 1), duration: 'quarter', drums: ['snare'], isRest: false })) }] };
  const reasons = forPassage(quarterBar).flatMap(result => result.reasons).join(' | ');
  assert.doesNotMatch(reasons, /off-beat/);
  const results = fills({ tempoBpm: 90, subdivision: '16th', level: 'intermediate' });
  assert.ok(results.length > 0);
  assert.equal(JSON.stringify(results).includes('undefined'), false);
});
