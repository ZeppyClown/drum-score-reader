// ── Page and PDF import screen ────────────────────────────────────────────────
// Open a page → check the suggested bar boxes (draw, move, resize, remove) → read
// with the local model or GPT-5.6 Luna → add the bars to the score in reading order.
// Box positions are page-image pixels; they are drawn as percentages so the page can be
// shown at any size. Recognition, cropping and saving happen in main (page-import.cjs).

import { dispatch } from './editor-store.js';
import { importBarsCommand } from './commands.js';
import { importedProvenance } from './score-document.js';
import { barFromPrediction } from './import.js';
import { readingOrder, boxFromCorners, clampBox } from './page-boxes.js';
import { state } from './state.js';

const $ = id => document.getElementById(id);
const DRAG_MIN = 12;
const bars = n => `${n} bar${n === 1 ? '' : 's'}`;

let job = null;          // { jobId, fileName, pages, boxes, results, recognizer }
let busy = false;
let stopping = false;
let drawnCount = 0;
let currentPageNumber = null;
let dialogOpener = null;

const pageOf = number => job.pages.find(p => p.page === number);
const statusText = message => { $('page-status').textContent = message; };
const failureText = error => `Page import failed: ${error?.message ?? String(error)}`;

const stateLabel = state => ({ pending: 'waiting', working: 'reading', done: 'done', failed: 'failed' }[state] ?? state);
const stateVisual = state => ({ pending: 'waiting', working: 'reading', done: '✓', failed: 'failed' }[state] ?? state);

// What the user sees on a box: nothing yet, working, done, or failed (+ retry).
function boxState(box) {
  if (box.working) return 'working';
  const result = job.results[box.id];
  if (!result || result.key !== `${box.page}:${box.x},${box.y},${box.width},${box.height}:${$('page-recognizer').value}`) return 'pending';
  return result.status;
}

function counts() {
  const tally = { pending: 0, working: 0, done: 0, failed: 0 };
  job.boxes.forEach(box => { tally[boxState(box)] += 1; });
  return tally;
}

function updateButtons() {
  const tally = counts();
  $('page-transcribe').hidden = busy;
  $('page-stop').hidden = !busy;
  $('page-transcribe').disabled = busy || job.boxes.length === 0 || tally.pending + tally.failed === 0;
  $('page-stop').disabled = stopping;
  $('page-transcribe').textContent = tally.done ? `Read ${tally.pending + tally.failed} remaining ${tally.pending + tally.failed === 1 ? 'bar' : 'bars'}` : `Read ${bars(job.boxes.length)}`;
  $('page-add').disabled = busy || tally.done === 0;
  $('page-add').textContent = `Add ${bars($('page-keep-blank').checked ? job.boxes.length : tally.done)} to score`;
  $('page-recognizer').disabled = busy;
}

function renumber() {
  job = { ...job, boxes: readingOrder(job.boxes) };
}

function boxElement(box, index, page) {
  const state = boxState(box);
  const element = document.createElement('div');
  element.className = `page-box page-box-${state}`;
  element.dataset.boxId = box.id;
  element.tabIndex = 0;
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', `Bar ${index + 1}, page ${page.page} — ${stateLabel(state)}`);
  Object.assign(element.style, {
    left: `${(box.x / page.width) * 100}%`, top: `${(box.y / page.height) * 100}%`,
    width: `${(box.width / page.width) * 100}%`, height: `${(box.height / page.height) * 100}%`,
  });
  const number = document.createElement('span');
  number.className = 'page-box-num';
  number.textContent = index + 1;
  const stateText = document.createElement('span');
  stateText.className = 'page-box-state';
  stateText.textContent = stateVisual(state);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'page-box-remove';
  remove.setAttribute('aria-label', `Remove bar box ${index + 1}`);
  remove.textContent = '×';
  const handle = document.createElement('span');
  handle.className = 'page-box-handle';
  element.append(number, stateText, remove, handle);
  const result = job.results[box.id];
  if (state === 'failed') {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'page-box-retry';
    retry.textContent = 'Retry';
    retry.title = result.error;
    element.append(retry);
  }
  return element;
}

function render(focusBoxId = document.activeElement?.closest?.('.page-box')?.dataset.boxId) {
  const container = $('page-pages');
  container.replaceChildren(...job.pages.map(page => {
    const wrap = document.createElement('div');
    wrap.className = 'page-sheet';
    wrap.dataset.page = page.page;
    const img = document.createElement('img');
    img.src = page.image;
    img.alt = `Page ${page.page} of ${job.fileName}`;
    img.draggable = false;
    wrap.append(img);
    job.boxes.forEach((box, index) => { if (box.page === page.page) wrap.append(boxElement(box, index, page)); });
    return wrap;
  }));
  updateButtons();
  if (focusBoxId) queueMicrotask(() => [...document.querySelectorAll('.page-box')].find(element => element.dataset.boxId === focusBoxId)?.focus());
}

// ── Editing boxes with the pointer ──────────────────────────────────────────

function pagePoint(sheet, event, page) {
  const rect = sheet.getBoundingClientRect();
  return { x: ((event.clientX - rect.left) / rect.width) * page.width, y: ((event.clientY - rect.top) / rect.height) * page.height };
}

function replaceBox(id, next) {
  job = { ...job, boxes: job.boxes.map(box => (box.id === id ? next : box)) };
}

function startDrag(event) {
  if (busy || event.button !== 0) return;
  const sheet = event.target.closest('.page-sheet');
  if (!sheet || event.target.closest('button')) return;
  const page = pageOf(Number(sheet.dataset.page));
  currentPageNumber = page.page;
  const origin = pagePoint(sheet, event, page);
  const boxEl = event.target.closest('.page-box');
  const box = boxEl ? job.boxes.find(b => b.id === boxEl.dataset.boxId) : null;
  const mode = !box ? 'draw' : event.target.classList.contains('page-box-handle') ? 'resize' : 'move';
  const preview = document.createElement('div');
  preview.className = 'page-box page-box-preview';
  if (mode === 'draw') sheet.append(preview);
  try { sheet.setPointerCapture(event.pointerId); } catch { /* synthetic events have no capturable pointer */ }
  event.preventDefault();

  const shaped = point => {
    if (mode === 'draw') return boxFromCorners('preview', page.page, origin, point, page);
    if (mode === 'move') return clampBox({ ...box, x: box.x + point.x - origin.x, y: box.y + point.y - origin.y }, page);
    return clampBox({ ...box, width: box.width + point.x - origin.x, height: box.height + point.y - origin.y }, page);
  };
  const show = (element, shape) => Object.assign(element.style, {
    left: `${(shape.x / page.width) * 100}%`, top: `${(shape.y / page.height) * 100}%`,
    width: `${(shape.width / page.width) * 100}%`, height: `${(shape.height / page.height) * 100}%`,
  });
  const onMove = moveEvent => show(mode === 'draw' ? preview : boxEl, shaped(pagePoint(sheet, moveEvent, page)));
  const onUp = upEvent => {
    sheet.removeEventListener('pointermove', onMove);
    sheet.removeEventListener('pointerup', onUp);
    preview.remove();
    const point = pagePoint(sheet, upEvent, page);
    const moved = Math.abs(point.x - origin.x) + Math.abs(point.y - origin.y) >= DRAG_MIN / 2;
    if (mode === 'draw' && moved) {
      const drawn = shaped(point);
      if (drawn.width >= DRAG_MIN && drawn.height >= DRAG_MIN) {
        job = { ...job, boxes: [...job.boxes, { ...drawn, id: `drawn-${++drawnCount}` }] };
      }
    } else if (box && moved) {
      replaceBox(box.id, shaped(point));
    }
    renumber();
    render();
  };
  sheet.addEventListener('pointermove', onMove);
  sheet.addEventListener('pointerup', onUp);
}

function onPagesClick(event) {
  const boxEl = event.target.closest('.page-box');
  if (!boxEl || busy) return;
  if (event.target.classList.contains('page-box-remove')) {
    const index = job.boxes.findIndex(box => box.id === boxEl.dataset.boxId);
    focusAfterDelete(index, boxEl.dataset.boxId);
  } else if (event.target.classList.contains('page-box-retry')) {
    runRecognition(() => window.pages.retry(job.jobId, boxEl.dataset.boxId));
  }
}

function onBoxFocus(event) {
  const boxEl = event.target.closest('.page-box');
  if (boxEl) currentPageNumber = job.boxes.find(box => box.id === boxEl.dataset.boxId)?.page ?? currentPageNumber;
}

function focusAfterDelete(removedIndex, removedId) {
  const remaining = job.boxes.filter(box => box.id !== removedId);
  job = { ...job, boxes: remaining };
  renumber();
  const next = job.boxes[removedIndex] ?? job.boxes[removedIndex - 1];
  render(next?.id);
  if (!next) $('page-add-box').focus();
}

function onPagesKeydown(event) {
  const boxEl = event.target.closest('.page-box');
  if (!boxEl || event.target !== boxEl || busy) return;
  const index = job.boxes.findIndex(box => box.id === boxEl.dataset.boxId);
  const box = job.boxes[index];
  if (!box) return;
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    focusAfterDelete(index, box.id);
    return;
  }
  const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (!direction) return;
  event.preventDefault();
  const step = event.shiftKey ? 20 : 4;
  const page = pageOf(box.page);
  const [horizontal, vertical] = direction;
  const next = event.altKey
    ? clampBox({ ...box, width: box.width + horizontal * step, height: box.height + vertical * step }, page)
    : clampBox({ ...box, x: box.x + horizontal * step, y: box.y + vertical * step }, page);
  replaceBox(box.id, next);
  renumber();
  render(box.id);
}

function addBox() {
  if (busy || !job?.pages.length) return;
  const page = pageOf(currentPageNumber) ?? job.pages[0];
  const width = Math.max(DRAG_MIN, Math.round(page.width * 0.2));
  const height = Math.max(DRAG_MIN, Math.round(page.height * 0.1));
  const box = clampBox({
    id: `drawn-${++drawnCount}`,
    page: page.page,
    x: (page.width - width) / 2,
    y: (page.height - height) / 2,
    width,
    height,
  }, page);
  currentPageNumber = page.page;
  job = { ...job, boxes: [...job.boxes, box] };
  renumber();
  render(box.id);
}

// ── Recognition ─────────────────────────────────────────────────────────────

function onProgress(update) {
  if (!job || update.jobId !== job.jobId) return;
  const box = job.boxes.find(b => b.id === update.boxId);
  if (!box) return;
  if (update.status === 'working') {
    replaceBox(box.id, { ...box, working: true });
  } else {
    replaceBox(box.id, { ...box, working: false });
    job = { ...job, results: { ...job.results, [box.id]: update.result } };
  }
  render();
}

async function runRecognition(request, startMessage = 'Reading bars…') {
  busy = true;
  stopping = false;
  statusText(startMessage);
  try {
    render();
    const result = await request();
    if (!result || result.error) { statusText(failureText(result?.error ?? 'The reader returned no result.')); return; }
    job = { ...job, results: result.results ?? job.results, boxes: job.boxes.map(({ working, ...box }) => box) };
    const tally = counts();
    statusText(result.canceled
      ? `Stopped. ${bars(tally.done)} read so far; they are saved.`
      : `${tally.done} of ${bars(job.boxes.length)} read.${tally.failed ? ` ${tally.failed} could not be read: retry ${tally.failed === 1 ? 'it' : 'them'} or add ${tally.failed === 1 ? 'an empty bar' : 'empty bars'} to fill in by hand.` : ''} Check the result, then add the bars.`);
  } catch (error) {
    statusText(failureText(error));
  } finally {
    if (job) job = { ...job, boxes: job.boxes.map(({ working, ...box }) => box) };
    busy = false;
    stopping = false;
    render();
  }
}

function transcribe() {
  const boxes = job.boxes.map(({ id, page, x, y, width, height }) => ({ id, page, x, y, width, height }));
  runRecognition(() => window.pages.transcribe(job.jobId, boxes, $('page-recognizer').value));
}

async function stopRecognition() {
  if (!busy || !job) return;
  if (typeof window.pages.cancel !== 'function') {
    statusText('Stop reading first.');
    return;
  }
  if (stopping) return;
  stopping = true;
  statusText('Stopping…');
  render();
  try {
    const result = await window.pages.cancel(job.jobId);
    if (result?.error) statusText(failureText(result.error));
  } catch (error) {
    stopping = false;
    statusText(failureText(error));
    render();
  }
}

// ── Adding to the score ─────────────────────────────────────────────────────

function barsForBox(box, index) {
  const result = job.results[box.id];
  const source = $('page-recognizer').value === 'luna' ? 'openai_omr' : 'local_omr';
  const where = `Box ${index + 1} on page ${box.page} of ${job.fileName}`;
  const blank = reason => [{ bar: { notes: [] }, provenance: importedProvenance({ source, warnings: [`${where} ${reason} Fill it in by hand.`] }) }];
  if (boxState(box) !== 'done') return $('page-keep-blank').checked ? blank(result?.error ? `could not be read (${result.error}).` : 'was not read.') : [];
  return result.bars.flatMap(prediction => {
    try {
      const converted = barFromPrediction(prediction.notes, { gridSlots: result.gridSlots });
      const warnings = [
        ...(prediction.uncertainties ?? []).map(u => `Luna flagged position ${u.position}: ${u.reason}`),
        ...converted.warnings.map(w => w.message),
        ...(prediction.notes.length ? [] : ['No drum hits were detected in this box.']),
        ...(result.bars.length > 1 ? [`${where} held ${result.bars.length} bars.`] : []),
      ];
      return [{ bar: converted.bar, provenance: importedProvenance({ source, model: result.model, warnings: warnings.slice(0, 50) }) }];
    } catch (error) {
      return $('page-keep-blank').checked ? blank(`gave notes that could not be used (${error.message}).`) : [];
    }
  });
}

async function addToScore() {
  const items = job.boxes.flatMap(barsForBox);
  if (!items.length) { statusText('No bars to add yet.'); return; }
  if (!dispatch(importBarsCommand(items))) {
    statusText('This score is view-only because it is not in 4/4. Start a new score to import bars.');
    return;
  }
  const first = state.cursor.barIndex + 1;
  const fileName = job.fileName;
  await window.pages.discard(job.jobId);
  close();
  const where = items.length === 1 ? `bar ${first}` : `bars ${first}–${first + items.length - 1}`;
  $('import-status').textContent = `Added ${bars(items.length)} from ${fileName} as ${where}. Check each one: they start unchecked.`;
}

// ── Opening, resuming, closing ──────────────────────────────────────────────

function show(loaded) {
  job = { ...loaded, boxes: loaded.boxes };
  drawnCount = loaded.boxes.filter(b => b.id.startsWith('drawn-')).length;
  currentPageNumber = loaded.pages[0]?.page ?? null;
  $('page-recognizer').value = loaded.recognizer ?? 'local';
  $('page-import-file').textContent = `${loaded.fileName} — ${loaded.pages.length} page${loaded.pages.length === 1 ? '' : 's'}`;
  statusText(loaded.boxes.length
    ? `Found ${loaded.boxes.length} bars. Check the boxes, then read.`
    : 'No bars were found. Drag on the page to draw a box around each bar.');
  $('page-import').hidden = false;
  document.body.classList.add('modal-open');
  render();
  $('page-recognizer').focus();
}

function close() {
  if (busy) { stopRecognition(); return; }
  $('page-import').hidden = true;
  document.body.classList.remove('modal-open');
  job = null;
  currentPageNumber = null;
  const opener = dialogOpener;
  dialogOpener = null;
  opener?.focus();
}

async function openPage() {
  $('import-status').textContent = 'Choose a page image or PDF. Finding the bars may take a moment…';
  try {
    const result = await window.pages.open();
    if (result.canceled) { $('import-status').textContent = 'Page import canceled.'; dialogOpener?.focus(); return; }
    if (result.error) { $('import-status').textContent = failureText(result.error); dialogOpener?.focus(); return; }
    $('import-status').textContent = '';
    show(result);
  } catch (error) {
    $('import-status').textContent = failureText(error);
    dialogOpener?.focus();
  }
}

function focusableDialogControls() {
  return [...$('page-import').querySelectorAll('button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter(element => !element.hidden && element.offsetParent !== null);
}

function onDialogKeydown(event) {
  if (!job || $('page-import').hidden) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== 'Tab') return;
  const controls = focusableDialogControls();
  if (!controls.length) return;
  const current = document.activeElement;
  const index = controls.indexOf(current);
  if (event.shiftKey && (index <= 0 || index === -1)) {
    event.preventDefault();
    controls.at(-1).focus();
  } else if (!event.shiftKey && (index === controls.length - 1 || index === -1)) {
    event.preventDefault();
    controls[0].focus();
  }
}

async function offerResume() {
  const waiting = await window.pages.recoverable();
  if (!Array.isArray(waiting) || !waiting.length) return;
  const [latest] = waiting;
  const status = $('import-status');
  status.textContent = `An unfinished page import is waiting: ${latest.fileName} (${latest.done} of ${latest.total} bars read). `;
  const resume = Object.assign(document.createElement('button'), { type: 'button', id: 'page-resume', textContent: 'Resume' });
  const discard = Object.assign(document.createElement('button'), { type: 'button', id: 'page-discard', textContent: 'Discard' });
  resume.addEventListener('click', async event => {
    dialogOpener = event.currentTarget;
    try {
      const loaded = await window.pages.load(latest.jobId);
      if (loaded.error) status.textContent = failureText(loaded.error);
      else { status.textContent = ''; show(loaded); }
    } catch (error) {
      status.textContent = failureText(error);
    }
  });
  discard.addEventListener('click', async () => { await window.pages.discard(latest.jobId); status.textContent = 'Discarded the unfinished page import.'; });
  status.append(resume, ' ', discard);
}

export function initPageImport() {
  if (!window.pages) { $('page-import-btn').hidden = true; return; }
  window.pages.onProgress(onProgress);
  $('page-import-btn').addEventListener('click', event => { dialogOpener = event.currentTarget; event.currentTarget.blur(); openPage(); });
  $('page-close').addEventListener('click', close);
  $('page-transcribe').addEventListener('click', transcribe);
  $('page-stop').addEventListener('click', stopRecognition);
  $('page-add').addEventListener('click', addToScore);
  $('page-add-box').addEventListener('click', addBox);
  $('page-keep-blank').addEventListener('change', updateButtons);
  $('page-recognizer').addEventListener('change', render);
  $('page-pages').addEventListener('pointerdown', startDrag);
  $('page-pages').addEventListener('click', onPagesClick);
  $('page-pages').addEventListener('focusin', onBoxFocus);
  $('page-pages').addEventListener('keydown', onPagesKeydown);
  document.addEventListener('keydown', onDialogKeydown);
  offerResume();
}
