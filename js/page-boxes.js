// ── Page import boxes ─────────────────────────────────────────────────────────
// The bar boxes a user reviews before a page is transcribed (master plan B3). Pure:
// shared by the review screen and Electron main, which re-checks every box it is sent.
//
// box = { id, page (1-based), x, y, width, height } in that page image's pixels.
// Reading order: page by page; on a page, boxes whose vertical middles fall inside the
// same row band are one row (left to right), and rows run top to bottom. Detected
// boxes, moved boxes and boxes drawn by hand are ordered by the same rule, so the
// order the user sees numbered is the order bars are added to the score.

export const MIN_BOX_SIDE = 12;
export const MAX_BOXES = 400;

export function clampBox(box, page) {
  const x = Math.max(0, Math.min(Math.round(box.x), page.width - MIN_BOX_SIDE));
  const y = Math.max(0, Math.min(Math.round(box.y), page.height - MIN_BOX_SIDE));
  const width = Math.max(MIN_BOX_SIDE, Math.min(Math.round(box.width), page.width - x));
  const height = Math.max(MIN_BOX_SIDE, Math.min(Math.round(box.height), page.height - y));
  return { ...box, x, y, width, height };
}

// A box from two drag corners (in either direction), kept on the page.
export function boxFromCorners(id, pageNumber, a, b, page) {
  return clampBox({
    id, page: pageNumber,
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y),
  }, page);
}

export function readingOrder(boxes) {
  const byPage = new Map();
  for (const box of boxes) byPage.set(box.page, [...(byPage.get(box.page) ?? []), box]);
  return [...byPage.keys()].sort((a, b) => a - b).flatMap(pageNumber => {
    const rows = [];
    const sorted = [...byPage.get(pageNumber)].sort((a, b) => (a.y + a.height / 2) - (b.y + b.height / 2));
    for (const box of sorted) {
      const middle = box.y + box.height / 2;
      const row = rows.find(r => middle >= r.top && middle <= r.bottom);
      if (row) {
        row.boxes.push(box);
      } else {
        rows.push({ top: box.y, bottom: box.y + box.height, boxes: [box] });
      }
    }
    return rows.sort((a, b) => a.top - b.top).flatMap(row => row.boxes.sort((a, b) => a.x - b.x || a.y - b.y));
  });
}

// Boxes from the detection response, ids in reading order.
export function boxesFromSegmentation(pages) {
  const boxes = pages.flatMap(page => page.systems.flatMap(system => system.bars.map(bar => ({
    page: page.page, x: bar.x, y: bar.y, width: bar.width, height: bar.height,
  }))));
  return readingOrder(boxes).map((box, index) => ({ id: `box-${index + 1}`, ...box }));
}

// Problems with boxes sent for transcription; an empty list means they can be used.
export function validateBoxes(boxes, pages) {
  if (!Array.isArray(boxes) || boxes.length === 0) return ['Keep at least one bar box.'];
  if (boxes.length > MAX_BOXES) return [`Import at most ${MAX_BOXES} bars at a time.`];
  const problems = [];
  const ids = new Set();
  for (const [i, box] of boxes.entries()) {
    const page = pages.find(p => p.page === box?.page);
    const where = `Box ${i + 1}`;
    if (!box || typeof box.id !== 'string' || !/^[\w-]{1,40}$/.test(box.id) || ids.has(box.id)) problems.push(`${where} has a missing or repeated id.`);
    else ids.add(box.id);
    if (!page) { problems.push(`${where} is on a page that does not exist.`); continue; }
    const numbers = [box.x, box.y, box.width, box.height];
    if (!numbers.every(Number.isFinite)) { problems.push(`${where} has an invalid position.`); continue; }
    if (box.width < MIN_BOX_SIDE || box.height < MIN_BOX_SIDE) problems.push(`${where} is too small to hold a bar.`);
    if (box.x < 0 || box.y < 0 || box.x + box.width > page.width || box.y + box.height > page.height) {
      problems.push(`${where} goes past the edge of page ${box.page}.`);
    }
  }
  return problems;
}
