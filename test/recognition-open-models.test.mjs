// Picking the notes out of an open model's free-text answer (eval/recognition/run.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { notesFromReply, summarize } from '../eval/recognition/run.mjs';

const notes = [{ position: 0, duration: 'quarter', drums: ['kick'] }];

test('notes are read from JSON wrapped in prose or a code fence', () => {
  assert.deepEqual(notesFromReply(`Here you go:\n\`\`\`json\n${JSON.stringify({ status: 'ok', bars: [{ notes }] })}\n\`\`\``), notes);
  assert.deepEqual(notesFromReply('{"status":"ok","bars":[]}'), []);
});

test('an answer that is not usable counts as an error, not as an empty bar', () => {
  assert.throws(() => notesFromReply(null), /no JSON/);
  assert.throws(() => notesFromReply('I cannot read this.'), /no JSON/);
  assert.throws(() => notesFromReply('{"status":"needs_crop","message":"crop it","bars":[]}'), /needs_crop/);
  assert.throws(() => notesFromReply('{"bars":[{"notes":[{"beat":1}]}]}'), /shape/);
});

test('the cost reported per call is added up', () => {
  const score = { exact: true, onsets: { truth: 1, predicted: 1, matched: 1 }, drumHits: { truth: 1, predicted: 1, matched: 1 }, durations: { compared: 1, matched: 1 } };
  assert.equal(summarize([{ id: 'a', ms: 1, score, usage: { cost: 0.01 } }, { id: 'b', ms: 1, score, usage: { cost: 0.02 } }]).estimatedCostUsd, 0.03);
});
