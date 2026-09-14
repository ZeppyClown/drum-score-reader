import { barFromPrediction } from './import.js';
import { dispatch } from './editor-store.js';
import { importBarCommand } from './commands.js';
import { importedProvenance } from './score-document.js';
import { state } from './state.js';

// source: 'local_omr' | 'openai_omr'. The bar is added through a command, so it is
// undoable, gets fresh ids, and starts unreviewed with the model name and warnings.
function applyPrediction(result, sourceName, source, status) {
  const converted = barFromPrediction(result.notes, { gridSlots: result.gridSlots });
  const messages = converted.warnings.map(warning => warning.message);
  for (const uncertainty of result.uncertainties ?? []) {
    messages.unshift(`Luna flagged position ${uncertainty.position}: ${uncertainty.reason}`);
  }
  if (!result.notes.length) messages.unshift('No drum hits were detected. A bar of rests was imported; check the crop and add any missing notes.');
  const provenance = importedProvenance({ source, model: result.model, warnings: messages.slice(0, 50) });
  if (!dispatch(importBarCommand({ bar: converted.bar, provenance }))) {
    throw new Error('This score is view-only because it is not in 4/4. Start a new score to import bars.');
  }
  const index = state.cursor.barIndex;
  status.textContent = `Imported ${sourceName} as bar ${index + 1}. Use the arrow keys and drum keypad to correct it.`;
  // The review panel (review-ui.js) lists the new bar's warnings from its provenance.
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
      applyPrediction(result, result.filename, 'local_omr', status);
    } catch (error) { status.textContent = `Import failed: ${error.message}`; }
    finally { button.disabled = aiButton.disabled = false; button.blur(); }
  });

  // "Turn on cloud help…" next to the message: shows the adult confirmation (in main),
  // tells the Ask DrumHub tab, and retries the paste once cloud help is on.
  function offerCloudHelp() {
    const turnOn = document.createElement('button');
    turnOn.type = 'button';
    turnOn.id = 'import-cloud-btn';
    turnOn.textContent = 'Turn on cloud help…';
    turnOn.addEventListener('click', async () => {
      turnOn.disabled = true;
      const next = await window.agent.setCloud(true);
      window.dispatchEvent(new CustomEvent('cloud-help-changed', { detail: next }));
      if (next.error) { status.textContent = next.error; return; }
      if (next.cloudEnabled) pasteScreenshot();
      else turnOn.disabled = false;
    });
    status.append(' ', turnOn);
  }

  async function pasteScreenshot() {
    if (aiButton.disabled) return;
    button.disabled = aiButton.disabled = true;
    status.textContent = 'Sending the clipboard screenshot to GPT-5.6 Luna… busy bars can take up to a minute.';
    warnings.replaceChildren();
    try {
      if (!window.omr) throw new Error('Open the desktop app with npm start to import images.');
      const result = await window.omr.pasteAiImage();
      if (result.code === 'cloud_required' && window.agent) {
        status.textContent = `Luna import needs cloud help: ${result.error}`;
        offerCloudHelp();
        return;
      }
      if (result.error) throw new Error(result.error);
      applyPrediction(result, `${result.model} screenshot`, 'openai_omr', status);
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
