// ── Playback transport ───────────────────────────────────────────────────────
// The transport owns only practice controls. The score's tempo stays in the
// score, while this tempo is used for the next playback run.

import { buildSchedule } from './playback-schedule.js';
import { PlaybackEngine } from './playback-engine.js';
import { createDrumKit } from './drum-synth.js';
import { resolveSelection } from './selection.js';
import { isEditableMeter } from './score-document.js';

const TEMPO_MIN = 40;
const TEMPO_MAX = 220;
const DEFAULT_SCORE_TEMPO = 90;
const MODULE_NAME = 'transport-ui';
let nextTransportId = 1;

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function rangeLabel(fromBar, toBar) {
  return fromBar === toBar ? `bar ${fromBar}` : `bars ${fromBar}–${toBar}`;
}

// Find the range used by a playback run. Bar numbers shown to a player start at 1;
// the score and cursor store their indexes from 0.
export function playbackRange(editor, loop) {
  const totalBars = Array.isArray(editor?.bars) ? editor.bars.length : 0;
  if (totalBars === 0) return { fromBar: 1, toBar: 0, label: 'no bars' };
  if (!loop) return { fromBar: 1, toBar: totalBars, label: rangeLabel(1, totalBars) };

  const selected = resolveSelection(editor);
  const fromBar = selected ? selected.fromIndex + 1 : clamp(
    Number.isInteger(editor?.cursor?.barIndex) ? editor.cursor.barIndex + 1 : 1,
    1,
    totalBars,
  );
  const toBar = selected ? selected.toIndex + 1 : fromBar;
  return { fromBar, toBar, label: rangeLabel(fromBar, toBar) };
}

// The number input can provide a string, so accepting any finite numeric value
// here keeps the DOM layer and the pure helper equally useful.
export function clampPracticeTempo(value, scoreTempo) {
  const scoreValue = Number(scoreTempo);
  const fallback = Number.isFinite(scoreValue) ? scoreValue : DEFAULT_SCORE_TEMPO;
  const numeric = Number(value);
  const chosen = Number.isNaN(numeric) ? fallback : numeric;
  return Math.round(clamp(
    Number.isFinite(chosen) ? chosen : fallback,
    TEMPO_MIN,
    TEMPO_MAX,
  ));
}

// This formatter intentionally takes a plain object so status wording can be
// tested without a browser. `message` is useful for short-lived errors.
export function transportStatus(state = {}) {
  if (state.message) return String(state.message);
  if (state.viewOnly) return 'This score is view-only because it is not in 4/4.';
  if (state.error) return `Playback could not start: ${state.error}`;
  if (state.isPlaying) {
    const tempo = Number.isInteger(state.tempoBpm) ? ` at ${state.tempoBpm} BPM` : '';
    return `Playing${tempo}.`;
  }
  if (state.finished) return 'Playback finished.';
  if (state.changed) return 'The score changed. Press Play to hear the new score.';
  return 'Ready to play.';
}

function addText(element, text) {
  element.textContent = text;
  return element;
}

function makeElement(tag, className, text = '') {
  const element = document.createElement(tag);
  element.className = className;
  if (text) element.textContent = text;
  return element;
}

function installStyles() {
  if (document.querySelector(`style[data-module="${MODULE_NAME}"]`)) return;
  const style = document.createElement('style');
  style.dataset.module = MODULE_NAME;
  style.textContent = `
    .transport-ui__root {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      flex-wrap: wrap;
      padding: 0.45rem 0.65rem;
      font: 0.9rem system-ui, sans-serif;
    }
    .transport-ui__play {
      min-width: 4.5rem;
      min-height: 2rem;
      font-weight: 600;
    }
    .transport-ui__tempo,
    .transport-ui__check,
    .transport-ui__loop-status {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
    }
    .transport-ui__tempo input[type="range"] { width: 8rem; }
    .transport-ui__tempo-number { width: 4rem; }
    .transport-ui__check { white-space: nowrap; }
    .transport-ui__loop-status { color: #475569; font-size: 0.82rem; }
    .transport-ui__status {
      flex-basis: 100%;
      min-height: 1.2em;
      color: #475569;
      font-size: 0.82rem;
    }
  `;
  (document.head || document.documentElement).append(style);
}

function inputId(name) {
  return `${MODULE_NAME}-${name}-${nextTransportId++}`;
}

export function mountTransport(
  container,
  {
    getEditor,
    onChange,
    onPosition,
    createAudioContext = () => new AudioContext(),
  },
) {
  if (!container || typeof container.append !== 'function') {
    throw new TypeError('mountTransport requires a container element');
  }
  if (typeof getEditor !== 'function') throw new TypeError('mountTransport requires getEditor');
  if (typeof onChange !== 'function') throw new TypeError('mountTransport requires onChange');
  if (typeof onPosition !== 'function') throw new TypeError('mountTransport requires onPosition');

  installStyles();

  const editorAtMount = getEditor();
  let practiceTempo = clampPracticeTempo(editorAtMount?.meta?.tempoBpm, editorAtMount?.meta?.tempoBpm);
  let loop = false;
  let countIn = false;
  let metronome = true;
  let audioContext = null;
  let kit = null;
  let engine = null;
  let monitorTimer = null;
  let lastRevision = editorAtMount?.meta?.revision;
  let lastStopReason = null;
  let destroyed = false;

  const root = makeElement('section', `${MODULE_NAME}__root`);
  const playButton = makeElement('button', `${MODULE_NAME}__play`, 'Play');
  playButton.type = 'button';
  playButton.setAttribute('aria-pressed', 'false');

  const tempoId = inputId('tempo');
  const tempoNumberId = inputId('tempo-number');
  const tempoLabel = makeElement('label', `${MODULE_NAME}__tempo`);
  const tempoText = makeElement('span', `${MODULE_NAME}__tempo-label`);
  addText(tempoText, 'Practice tempo');
  const tempoSlider = document.createElement('input');
  tempoSlider.type = 'range';
  tempoSlider.id = tempoId;
  tempoSlider.min = String(TEMPO_MIN);
  tempoSlider.max = String(TEMPO_MAX);
  tempoSlider.step = '1';
  tempoSlider.setAttribute('aria-label', 'Practice tempo');
  const tempoNumber = document.createElement('input');
  tempoNumber.type = 'number';
  tempoNumber.id = tempoNumberId;
  tempoNumber.min = String(TEMPO_MIN);
  tempoNumber.max = String(TEMPO_MAX);
  tempoNumber.step = '1';
  tempoNumber.setAttribute('aria-label', 'Practice tempo number');
  tempoLabel.append(tempoText, tempoSlider, tempoNumber);

  const makeCheck = (name, text, checked) => {
    const label = makeElement('label', `${MODULE_NAME}__check`);
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = `${MODULE_NAME}__${name}`;
    input.checked = checked;
    input.id = inputId(name);
    const labelText = makeElement('span', `${MODULE_NAME}__${name}-label`, text);
    label.append(input, labelText);
    return { label, input };
  };

  const countInControl = makeCheck('count-in', 'Count-in (1 bar)', false);
  const metronomeControl = makeCheck('metronome', 'Metronome', true);
  const loopControl = makeCheck('loop', 'Loop', false);
  const loopLabel = makeElement('span', `${MODULE_NAME}__loop-status`);
  const status = makeElement('div', `${MODULE_NAME}__status`);
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  root.append(playButton, tempoLabel, countInControl.label, metronomeControl.label,
    loopControl.label, loopLabel, status);
  if (typeof container.replaceChildren === 'function') container.replaceChildren(root);
  else container.append(root);

  const updateTempoInputs = () => {
    tempoSlider.value = String(practiceTempo);
    tempoNumber.value = String(practiceTempo);
  };

  const updateRangeLabel = editor => {
    loopLabel.textContent = loop ? `Looping ${playbackRange(editor, true).label}` : '';
  };

  const setStatus = state => {
    status.textContent = transportStatus(state);
  };

  const reportPosition = position => {
    if (!position) {
      onPosition(null);
      return;
    }
    onPosition({ barIndex: position.barIndex, noteIndex: position.noteIndex });
  };

  const clearMonitor = () => {
    if (monitorTimer === null) return;
    clearInterval(monitorTimer);
    monitorTimer = null;
  };

  const finishPlayback = reason => {
    clearMonitor();
    lastStopReason = reason;
    playButton.textContent = 'Play';
    playButton.setAttribute('aria-pressed', 'false');
    reportPosition(null);
    if (reason === 'finished') setStatus({ finished: true });
    else if (reason === 'changed') setStatus({ changed: true });
    else setStatus({});
  };

  const watchPlayback = () => {
    clearMonitor();
    monitorTimer = setInterval(() => {
      if (engine?.isPlaying) return;
      finishPlayback(lastStopReason === 'changed' ? 'changed' : 'finished');
    }, 50);
    // Node tests should not stay alive just because a mounted transport is idle.
    monitorTimer?.unref?.();
  };

  const stop = () => {
    const wasPlaying = Boolean(engine?.isPlaying);
    if (engine) engine.stop();
    if (wasPlaying || monitorTimer !== null) finishPlayback('stopped');
    else {
      playButton.textContent = 'Play';
      playButton.setAttribute('aria-pressed', 'false');
      reportPosition(null);
      setStatus({});
    }
  };

  const play = () => {
    if (destroyed) return false;
    const editor = getEditor();
    if (!isEditableMeter(editor?.meta?.meter)) {
      setStatus({ viewOnly: true });
      return false;
    }

    const range = playbackRange(editor, loop);
    try {
      if (!audioContext) {
        audioContext = createAudioContext();
        kit = createDrumKit(audioContext);
        engine = new PlaybackEngine({ audioContext, kit });
        engine.onPosition(reportPosition);
      }
      const resumeResult = audioContext.resume?.();
      resumeResult?.catch?.(() => {});
      const schedule = buildSchedule(editor.bars, {
        tempoBpm: practiceTempo,
        meter: editor.meta.meter,
        fromBar: range.fromBar,
        toBar: range.toBar,
        countInBeats: countIn ? editor.meta.meter.beats : 0,
        loop,
        metronome,
      });
      lastStopReason = null;
      engine.start(schedule, { loop, metronome });
      playButton.textContent = 'Stop';
      playButton.setAttribute('aria-pressed', 'true');
      setStatus({ isPlaying: true, tempoBpm: practiceTempo });
      watchPlayback();
      return true;
    } catch (error) {
      if (engine?.isPlaying) engine.stop();
      clearMonitor();
      playButton.textContent = 'Play';
      playButton.setAttribute('aria-pressed', 'false');
      reportPosition(null);
      setStatus({ error: error instanceof Error ? error.message : 'Please try again.' });
      return false;
    }
  };

  const togglePlayback = () => {
    if (engine?.isPlaying) stop();
    else play();
    playButton.blur?.();
  };

  const setPracticeTempo = value => {
    practiceTempo = clampPracticeTempo(value, getEditor()?.meta?.tempoBpm);
    updateTempoInputs();
  };

  playButton.addEventListener('click', togglePlayback);
  tempoSlider.addEventListener('input', () => setPracticeTempo(tempoSlider.value));
  tempoNumber.addEventListener('change', () => setPracticeTempo(tempoNumber.value));
  countInControl.input.addEventListener('change', () => { countIn = countInControl.input.checked; });
  metronomeControl.input.addEventListener('change', () => { metronome = metronomeControl.input.checked; });
  loopControl.input.addEventListener('change', () => {
    loop = loopControl.input.checked;
    updateRangeLabel(getEditor());
  });

  const unsubscribe = onChange((nextEditor, previousEditor) => {
    if (destroyed) return;
    const editor = nextEditor ?? getEditor();
    // A new score or a changed score tempo resets the practice tempo to the score's.
    if (previousEditor && (editor?.meta?.scoreId !== previousEditor.meta?.scoreId || editor?.meta?.tempoBpm !== previousEditor.meta?.tempoBpm)) {
      setPracticeTempo(editor?.meta?.tempoBpm);
    }
    const revisionChanged = editor?.meta?.revision !== lastRevision;
    lastRevision = editor?.meta?.revision;
    updateRangeLabel(editor);
    if (revisionChanged && (engine?.isPlaying || monitorTimer !== null)) {
      lastStopReason = 'changed';
      engine?.stop();
      finishPlayback('changed');
    }
  });

  updateTempoInputs();
  updateRangeLabel(editorAtMount);
  setStatus({});

  const controller = {
    play,
    stop,
    applyPlaybackEffect(effect) {
      if (effect?.kind !== 'playback') return;
      if (Number.isFinite(effect.tempoBpm)) setPracticeTempo(effect.tempoBpm);
      if (effect.loop === true) {
        loop = true;
        loopControl.input.checked = true;
        updateRangeLabel(getEditor());
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (engine?.isPlaying) engine.stop();
      clearMonitor();
      reportPosition(null);
      unsubscribe?.();
    },
    get isPlaying() { return Boolean(engine?.isPlaying); },
  };

  return controller;
}
