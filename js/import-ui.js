import { barFromPrediction } from './import.js';
import { dispatch } from './editor-store.js';
import { importBarsCommand } from './commands.js';
import { importedProvenance } from './score-document.js';
import { state } from './state.js';

// predictions: [{ notes, uncertainties? }] in reading order (one for a local image, one or
// more for a Luna screenshot). All usable bars are added as one undoable command; each
// starts unreviewed with the model name and its own warnings. A bar that cannot be turned
// into notes is skipped and reported instead of stopping the others.
function applyPredictions(predictions, { gridSlots, model, sourceName, source, note = '' }, status) {
  const items = [];
  const skipped = [];
  predictions.forEach((prediction, i) => {
    try {
      const converted = barFromPrediction(prediction.notes, { gridSlots });
      const messages = converted.warnings.map(warning => warning.message);
      for (const uncertainty of prediction.uncertainties ?? []) {
        messages.unshift(`Luna flagged position ${uncertainty.position}: ${uncertainty.reason}`);
      }
      if (!prediction.notes.length) messages.unshift('No drum hits were detected. A bar of rests was imported; check the crop and add any missing notes.');
      items.push({ bar: converted.bar, provenance: importedProvenance({ source, model, warnings: messages.slice(0, 50) }) });
    } catch (error) {
      skipped.push(`bar ${i + 1} of the image (${error.message})`);
    }
  });
  if (!items.length) throw new Error(skipped.length ? `No bar could be imported: ${skipped.join('; ')}` : 'No bars were found.');
  if (!dispatch(importBarsCommand(items))) {
    throw new Error('This score is view-only because it is not in 4/4. Start a new score to import bars.');
  }
  const first = state.cursor.barIndex + 1;
  const where = items.length === 1 ? `bar ${first}` : `bars ${first}–${first + items.length - 1}`;
  const parts = [`Imported ${sourceName} as ${where}.`];
  if (note) parts.push(note);
  if (skipped.length) parts.push(`Skipped ${skipped.join('; ')}.`);
  parts.push('Use the arrow keys and drum keypad to correct it.');
  status.textContent = parts.join(' ');
  // The review panel (review-ui.js) lists the current bar's warnings from its provenance.
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
      applyPredictions([result], { gridSlots: result.gridSlots, model: result.model, sourceName: result.filename, source: 'local_omr' }, status);
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
      let next;
      try { next = await window.agent.setCloud(true); }
      catch (error) { status.textContent = `Could not turn on cloud help: ${error.message}`; return; }
      finally { turnOn.disabled = false; }
      window.dispatchEvent(new CustomEvent('cloud-help-changed', { detail: next }));
      if (next.error) { status.textContent = next.error; return; }
      if (next.cloudEnabled) pasteScreenshot();
    });
    status.append(' ', turnOn);
  }

  async function pasteScreenshot() {
    if (aiButton.disabled) return;
    button.disabled = aiButton.disabled = true;
    status.textContent = 'Sending the clipboard screenshot to GPT-5.6 Luna… this can take a few minutes, longer with several bars.';
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
      applyPredictions(result.bars, { gridSlots: result.gridSlots, model: result.model, sourceName: `${result.model} screenshot`, source: 'openai_omr', note: result.message }, status);
    } catch (error) { status.textContent = `Luna import failed: ${error.message}`; }
    finally { button.disabled = aiButton.disabled = false; aiButton.blur(); }
  }

  aiButton.addEventListener('click', pasteScreenshot);
  document.addEventListener('paste', event => {
    if (document.body.classList.contains('modal-open')) return;
    if (event.target instanceof Element &&
        event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    pasteScreenshot();
  });
}
