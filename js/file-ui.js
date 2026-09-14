// ── Save, open, new, autosave, recovery ───────────────────────────────────────
// Menu commands arrive from Electron main (desktop/score-ipc.cjs). The renderer
// sends whole documents; main decides where they go on disk. File operations run
// one at a time so an autosave can never land between a save and its bookkeeping.

import { state } from './state.js';
import { replaceEditor, undoEdit, redoEdit, onEditorChange } from './editor-store.js';
import { createEditor, documentOf, isDirty } from './commands.js';
import { createMeta, splitDocument } from './score-document.js';
import { scoreToMidi } from './export-midi.js';
import { scoreToMusicXml } from './export-musicxml.js';

const AUTOSAVE_DELAY_MS = 1000;
let queue = Promise.resolve();
let autosaveTimer = null;

const api = () => window.scoreFiles;
const status = message => { document.getElementById('import-status').textContent = message; };

function serially(task) {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}

function editorFromDocument(doc) {
  const { meta, bars } = splitDocument(doc);
  return createEditor({ meta, bars });
}

// Mark what was actually sent as saved, even if the user kept editing meanwhile.
function markSent(sent) {
  replaceEditor({ ...state.editor, saved: { meta: sent.meta, bars: sent.bars } });
}

async function save({ saveAs = false } = {}) {
  const sent = state.editor;
  const result = await api().save(documentOf(sent), { saveAs });
  if (result.error) { status(`Save failed: ${result.error}`); return false; }
  if (result.canceled) return false;
  markSent(sent);
  status(`Saved ${result.name}.`);
  return true;
}

// true when it is fine to replace the current score.
async function confirmLeave() {
  if (!isDirty(state.editor)) return true;
  const { choice, error } = await api().confirmDiscard(state.editor.meta.title, state.editor.meta.scoreId);
  if (error) { status(error); return false; }
  if (choice === 'save') return save();
  return choice === 'discard';
}

async function open(options) {
  if (!(await confirmLeave())) return;
  const result = await api().open(options);
  if (result.error) { status(`Open failed: ${result.error}`); return; }
  if (result.canceled) return;
  replaceEditor(editorFromDocument(result.doc));
  status(`Opened ${result.name}.`);
}

async function newScore() {
  if (!(await confirmLeave())) return;
  await api().newScore();
  replaceEditor(createEditor({ meta: createMeta(), bars: [{ notes: [] }] }));
  status('New score. Use the drum keys or import a bar image.');
}

// In a text field, Undo/Redo edit the text; elsewhere they edit the score.
function editInPlace(kind) {
  const field = document.activeElement?.closest?.('input, textarea');
  if (field) { document.execCommand(kind); return; }
  if (kind === 'undo') undoEdit(); else redoEdit();
}

// MIDI and MusicXML are built here from the score; PDF prints this page (print styles in
// styles.css hide everything but the title and the notation).
async function exportScore(kind) {
  const doc = documentOf(state.editor);
  const data = kind === 'midi' ? scoreToMidi(doc) : kind === 'musicxml' ? scoreToMusicXml(doc) : null;
  document.getElementById('print-title').textContent = `${doc.title} — ${doc.tempoBpm} BPM`;
  const result = await api().exportScore(kind, data, doc.title);
  if (result.error) status(`Export failed: ${result.error}`);
  else if (result.saved) status(`Exported ${result.name}.`);
}

const COMMANDS = {
  new: () => serially(newScore),
  open: () => serially(() => open()),
  'open-recent': index => serially(() => open({ recentIndex: index })),
  save: () => serially(() => save()),
  'save-as': () => serially(() => save({ saveAs: true })),
  'save-and-close': () => serially(() => save()),  // main closes the window once this save succeeds
  export: kind => serially(() => exportScore(kind)),
  undo: () => editInPlace('undo'),
  redo: () => editInPlace('redo'),
};

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => serially(async () => {
    try {
      const result = await api().autosave(documentOf(state.editor), isDirty(state.editor));
      if (result?.error) status(`Autosave failed: ${result.error}`);
    } catch (error) {
      status(`Autosave failed: ${error.message}`);
    }
  }), AUTOSAVE_DELAY_MS);
}

function reportStatus(editor) {
  api().setStatus({ dirty: isDirty(editor), title: editor.meta.title, scoreId: editor.meta.scoreId });
}

export async function initFiles() {
  if (!api()) return;  // opened outside Electron: editing still works, files do not
  api().onCommand((name, arg) => {
    COMMANDS[name]?.(arg)?.catch?.(error => status(`Something went wrong: ${error.message}`));
  });
  onEditorChange((next, previous) => {
    reportStatus(next);
    if (next.bars !== previous.bars || next.meta !== previous.meta || next.saved !== previous.saved) scheduleAutosave();
  });
  reportStatus(state.editor);
  await serially(async () => {
    const recovered = await api().recover();
    if (recovered?.doc) {
      // Restored changes are unsaved until the user saves them.
      const editor = editorFromDocument(recovered.doc);
      replaceEditor({ ...editor, saved: { ...editor.saved, bars: null } });
      status(`Restored unsaved changes to “${recovered.doc.title}”. Save to keep them.`);
    }
  });
}
