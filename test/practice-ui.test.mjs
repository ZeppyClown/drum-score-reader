import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardRows, formatDuration, sessionRangeFor, validateStudentName } from '../js/practice-ui.js';

test('formatDuration uses a compact timer format', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(3661), '1:01:01');
  assert.equal(formatDuration(-4), '0:00');
});

test('sessionRangeFor uses selected bars or the cursor bar', () => {
  const editor = {
    bars: [{ barId: 'a' }, { barId: 'b' }, { barId: 'c' }],
    cursor: { barIndex: 2 },
    selection: { fromBarId: 'c', toBarId: 'a' },
  };
  assert.deepEqual(sessionRangeFor(editor), { fromBar: 1, toBar: 3 });
  assert.deepEqual(sessionRangeFor({ ...editor, selection: null }), { fromBar: 3, toBar: 3 });
});

test('dashboardRows joins summary and difficulty by passage', () => {
  const rows = dashboardRows({ bestCleanBpmByRange: [{ scoreId: 'score-1', fromBar: 1, toBar: 2, bestCleanBpm: 90, attempts: 4 }] }, [
    { scoreId: 'score-1', fromBar: 1, toBar: 2, difficulty: 0.4, enoughData: true, reasons: ['Some tries were unclean.'] },
  ], 'score-1');
  assert.equal(dashboardRows({ bestCleanBpmByRange: [{ scoreId: 'other', fromBar: 3, toBar: 3 }] }, [], 'score-1')[0].label, 'Another score, bar 3');
  assert.deepEqual(rows[0], {
    scoreId: 'score-1', fromBar: 1, toBar: 2, label: 'This score, bars 1–2', bestCleanBpm: 90,
    attempts: 4, difficulty: 0.4, enoughData: true, reasons: ['Some tries were unclean.'],
  });
});

test('validateStudentName accepts a nickname and rejects personal contact details', () => {
  assert.equal(validateStudentName('Avery'), null);
  assert.match(validateStudentName(''), /1–60/);
  assert.match(validateStudentName('avery@example.com'), /email/);
  assert.match(validateStudentName('+1 (555) 123-4567'), /phone/);
  assert.match(validateStudentName('x'.repeat(61)), /1–60/);
});
