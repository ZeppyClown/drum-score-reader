import test from 'node:test';
import assert from 'node:assert/strict';

import { needsReview, reviewSummary, nextUnreviewed } from '../js/review.js';
import { createEditor, execute, goToBarCommand, markReviewedCommand } from '../js/commands.js';
import { createMeta, importedProvenance, manualProvenance } from '../js/score-document.js';

const bar = (reviewed, warnings = []) => ({
  notes: [],
  provenance: reviewed ? manualProvenance() : importedProvenance({ source: 'local_omr', warnings }),
});

test('manual bars never need review; imported bars do until marked', () => {
  assert.equal(needsReview(bar(true)), false);
  assert.equal(needsReview(bar(false)), true);
});

test('reviewSummary lists unreviewed bars in order with their warning counts', () => {
  const bars = [bar(true), bar(false, ['a', 'b']), bar(true), bar(false)];
  assert.deepEqual(reviewSummary(bars), {
    count: 2, total: 4, indices: [1, 3], warnings: 2,
  });
});

test('nextUnreviewed goes forward and wraps, skipping the current bar', () => {
  const bars = [bar(false), bar(true), bar(false), bar(true)];
  assert.equal(nextUnreviewed(bars, 0), 2);
  assert.equal(nextUnreviewed(bars, 2), 0);
  assert.equal(nextUnreviewed(bars, 1), 2);
  assert.equal(nextUnreviewed([bar(false)], 0), 0);
  assert.equal(nextUnreviewed([bar(true), bar(true)], 0), -1);
});

test('goToBar moves only the cursor; marking reviewed is an explicit undoable edit', () => {
  let editor = createEditor({ meta: createMeta(), bars: [bar(true), bar(false)] });
  const moved = execute(editor, goToBarCommand(1));
  assert.deepEqual(moved.cursor, { ...editor.cursor, barIndex: 1, noteIndex: 0 });
  assert.equal(moved.meta.revision, editor.meta.revision);
  assert.equal(execute(editor, goToBarCommand(5)), editor);
  assert.equal(execute(moved, goToBarCommand(1)), moved);
  editor = execute(moved, markReviewedCommand(1));
  assert.equal(needsReview(editor.bars[1]), false);
  assert.equal(editor.meta.revision, 1);
});
