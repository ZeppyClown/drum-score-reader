import test from 'node:test';
import assert from 'node:assert/strict';

import { readingOrder, boxesFromSegmentation, validateBoxes, clampBox, boxFromCorners, MAX_BOXES } from '../js/page-boxes.js';

const page = (n, width = 1000, height = 800) => ({ page: n, width, height });
const box = (id, pageNumber, x, y, width = 200, height = 100) => ({ id, page: pageNumber, x, y, width, height });

test('reading order: pages first, then rows top to bottom, then left to right', () => {
  const boxes = [
    box('c', 1, 500, 300), box('a', 1, 50, 100), box('e', 2, 50, 100),
    box('b', 1, 400, 110), box('d', 1, 50, 310),
  ];
  assert.deepEqual(readingOrder(boxes).map(b => b.id), ['a', 'b', 'd', 'c', 'e']);
});

test('a hand-drawn box slightly taller or shorter than its row still joins that row', () => {
  const boxes = [box('first', 1, 50, 100), box('drawn', 1, 700, 85, 150, 140), box('second', 1, 300, 100), box('next row', 1, 20, 400)];
  assert.deepEqual(readingOrder(boxes).map(b => b.id), ['first', 'second', 'drawn', 'next row']);
});

test('detected boxes get ids in reading order', () => {
  const pages = [{ page: 1, width: 1000, height: 800, systems: [
    { bars: [{ x: 400, y: 100, width: 300, height: 100 }, { x: 50, y: 100, width: 300, height: 100 }] },
    { bars: [{ x: 50, y: 400, width: 600, height: 100 }] },
  ] }];
  assert.deepEqual(boxesFromSegmentation(pages).map(b => [b.id, b.x, b.y]), [['box-1', 50, 100], ['box-2', 400, 100], ['box-3', 50, 400]]);
});

test('boxes are kept on the page and drawn in either direction', () => {
  assert.deepEqual(clampBox(box('a', 1, -20, 790, 5000, 50), page(1)), { id: 'a', page: 1, x: 0, y: 788, width: 1000, height: 12 });
  assert.deepEqual(boxFromCorners('n', 1, { x: 300, y: 200 }, { x: 100, y: 50 }, page(1)), { id: 'n', page: 1, x: 100, y: 50, width: 200, height: 150 });
});

test('boxes sent for transcription are validated', () => {
  const pages = [page(1)];
  assert.deepEqual(validateBoxes([box('a', 1, 0, 0)], pages), []);
  assert.match(validateBoxes([], pages)[0], /at least one/);
  assert.match(validateBoxes(Array.from({ length: MAX_BOXES + 1 }, (_, i) => box(`b${i}`, 1, 0, 0)), pages)[0], /at most/);
  const problems = validateBoxes([
    box('a', 1, 0, 0), box('a', 1, 0, 0), box('x', 9, 0, 0), box('tiny', 1, 0, 0, 5, 5),
    box('edge', 1, 900, 0), { id: 'nan', page: 1, x: 'a', y: 0, width: 1, height: 1 }, box('bad id!', 1, 0, 0),
  ], pages).join(' | ');
  for (const pattern of [/Box 2 has a missing or repeated id/, /page that does not exist/, /too small/, /past the edge/, /invalid position/, /Box 7 has a missing/]) {
    assert.match(problems, pattern);
  }
});
