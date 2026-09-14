import { state } from './state.js';
import { render } from './score.js';
import { barFromPrediction } from './import.js';

function applyPrediction(result, sourceName, status, warnings) {
  const converted = barFromPrediction(result.notes, { gridSlots: result.gridSlots });
  const previousBars = state.bars;
  const previousCursor = state.cursor;
  const empty = state.bars.length === 1 && state.bars[0].notes.length === 0;
  const index = empty ? 0 : state.bars.length;
  state.bars = empty ? [converted.bar] : [...state.bars, converted.bar];
  state.cursor = { barIndex: index, noteIndex: 0, position: 1 };
  try { render(); }
  catch (error) { state.bars = previousBars; state.cursor = previousCursor; render(); throw error; }
  status.textContent = `Imported ${sourceName} as bar ${index + 1}. Use the arrow keys and drum keypad to correct it.`;
  const messages = converted.warnings.map(warning => warning.message);
  for (const uncertainty of result.uncertainties ?? []) {
    messages.unshift(`Luna flagged position ${uncertainty.position}: ${uncertainty.reason}`);
  }
  if (!result.notes.length) messages.unshift('No drum hits were detected. A bar of rests was imported; check the crop and add any missing notes.');
  for (const message of messages) {
    const item = document.createElement('li'); item.textContent = message; warnings.append(item);
  }
  document.getElementById('score-cursor')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export function initImport() {
  const button = document.getElementById('import-btn');
  const aiButton = document.getElementById('ai-import-btn');
  const status = document.getElementById('import-status');
  const warnings = document.getElementById('import-warnings');
  button.addEventListener('click', async () => {
    button.disabled = aiButton.disabled = true;
    status.textContent = 'Choose one bar image. Recognition may take a moment…';
    warnings.replaceChildren();
    try {
      if (!window.omr) throw new Error('Open the desktop app with npm start to import images.');
      const result = await window.omr.importBar();
      if (result.canceled) { status.textContent = 'Import canceled.'; return; }
      if (result.error) throw new Error(result.error);
      applyPrediction(result, result.filename, status, warnings);
    } catch (error) { status.textContent = `Import failed: ${error.message}`; }
    finally { button.disabled = aiButton.disabled = false; button.blur(); }
  });

  async function pasteScreenshot() {
    if (aiButton.disabled) return;
    button.disabled = aiButton.disabled = true;
    status.textContent = 'Sending the clipboard screenshot to GPT-5.6 Luna…';
    warnings.replaceChildren();
    try {
      if (!window.omr) throw new Error('Open the desktop app with npm start to import images.');
      const result = await window.omr.pasteAiImage();
      if (result.error) throw new Error(result.error);
      applyPrediction(result, `${result.model} screenshot`, status, warnings);
    } catch (error) { status.textContent = `Luna import failed: ${error.message}`; }
    finally { button.disabled = aiButton.disabled = false; aiButton.blur(); }
  }

  aiButton.addEventListener('click', pasteScreenshot);
  document.addEventListener('paste', event => {
    if (event.target instanceof Element &&
        event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    pasteScreenshot();
  });
}
