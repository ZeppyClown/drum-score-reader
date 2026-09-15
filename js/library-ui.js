// Exercise library and Fill Lab. The catalogue and score rules stay pure; this
// file only turns their results into a small, keyboard-friendly panel.

import { EXERCISES, FILLS } from './exercise-catalogue.js';
import {
  exercisesForPassage, insertExerciseCommand, recommendFills, searchExercises,
  validateGeneratedFill,
} from './exercise-search.js';
import { noteTicks } from './bar.js';
import { countLabel, findComplexPassages, inspectBars } from './score-analysis.js';
import { scoreSnapshot } from './score-snapshot.js';
import { resolveSelection } from './selection.js';

const MODULE = 'library-ui';
const LEVELS = ['beginner', 'intermediate', 'advanced'];
const SUBDIVISIONS = ['quarter', '8th', '16th', 'triplet 8th', '32nd'];
const human = value => String(value ?? '').replaceAll('_', ' ');

// Return display-ready rows. Onsets are derived from note order, just like the
// editor and score snapshot do; no position is added to the saved note format.
export function noteGrid(bar) {
  let onset = 0;
  return (Array.isArray(bar?.notes) ? bar.notes : []).map(note => {
    const row = {
      count: countLabel(onset),
      drums: Array.isArray(note?.drums) && note.drums.length
        ? note.drums.map(human).join(' + ')
        : 'rest',
    };
    onset += noteTicks(note);
    return row;
  });
}

function scoreRange(editor) {
  const selection = resolveSelection(editor);
  if (selection) return { fromBar: selection.fromIndex + 1, toBar: selection.toIndex + 1 };
  const bar = Math.max(0, Math.min(editor.bars.length - 1, editor.cursor?.barIndex ?? 0));
  return { fromBar: bar + 1, toBar: bar + 1 };
}

// This is the exact analysis shape expected by exercisesForPassage: inspected
// bars plus the complexity ranking calculated from the same score snapshot.
export function passageQuery(editor) {
  const range = scoreRange(editor);
  const snapshot = scoreSnapshot(editor, { maxBars: editor.bars.length });
  const inspection = inspectBars(snapshot, range);
  const complexity = findComplexPassages(snapshot, { top: snapshot.bars.length });
  return { ...inspection, ranked: complexity.ranked ?? [] };
}

export function addedMessage(editorBefore, editorAfter, title) {
  const beforeIds = new Set((editorBefore?.bars ?? []).map(bar => bar.barId));
  const added = (editorAfter?.bars ?? []).reduce((numbers, bar, index) => {
    if (!beforeIds.has(bar.barId)) numbers.push(index + 1);
    return numbers;
  }, []);
  if (!added.length) return `Could not add '${String(title)}'.`;
  const from = Math.min(...added);
  const to = Math.max(...added);
  const range = from === to ? `bar ${from}` : `bars ${from}–${to}`;
  return `Added '${String(title)}' as ${range}`;
}

const add = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className.split(/\s+/).filter(Boolean).map(name => `${MODULE}-${name}`).join(' ');
  if (text !== undefined) node.textContent = text;
  return node;
};

function labelFor(text, control) {
  const label = add('label', 'label', text);
  label.append(control);
  return label;
}

function options(select, values, anyText = 'Any') {
  select.replaceChildren();
  const first = add('option', '', anyText);
  first.value = '';
  select.append(first);
  values.forEach(value => {
    const option = add('option', '', human(value));
    option.value = value;
    select.append(option);
  });
}

function gridPre(item) {
  const pre = add('pre', 'grid');
  const lines = [];
  (item?.bars ?? []).forEach((bar, index) => {
    if ((item.bars.length ?? 0) > 1) lines.push(`Bar ${index + 1}`);
    lines.push('Count       | Drums');
    lines.push('------------+----------------------------');
    noteGrid(bar).forEach(row => lines.push(`${row.count.padEnd(11)} | ${row.drums}`));
  });
  pre.textContent = lines.join('\n') || 'There are no notes to preview.';
  return pre;
}

function resultCard(result, item, { onAdd, previewKey, previewStates }) {
  const card = add('article', 'card');
  const heading = add('h4', 'card-title', item.title);
  card.append(heading);
  const facts = add('p', 'facts', `${human(item.level)} · ${item.tempo.min}–${item.tempo.max} BPM · ${human(item.subdivision)}`);
  card.append(facts);
  card.append(add('p', 'description', item.description));
  const why = add('p', 'why', 'Why it matched: ' + (result.reasons?.join('; ') || 'it fits your choices.'));
  card.append(why);
  const actions = add('div', 'actions');
  const preview = add('button', 'button', previewStates.has(previewKey) ? 'Hide preview' : 'Preview');
  preview.type = 'button';
  preview.addEventListener('click', () => {
    if (previewStates.has(previewKey)) previewStates.delete(previewKey);
    else previewStates.add(previewKey);
    card.querySelector(`.${MODULE}-preview`)?.remove();
    if (previewStates.has(previewKey)) {
      const wrap = add('div', 'preview');
      wrap.append(gridPre(item));
      card.append(wrap);
    }
    preview.textContent = previewStates.has(previewKey) ? 'Hide preview' : 'Preview';
  });
  actions.append(preview);
  const addButton = add('button', 'button', 'Add to score');
  addButton.type = 'button';
  addButton.addEventListener('click', onAdd);
  actions.append(addButton);
  card.append(actions);
  if (previewStates.has(previewKey)) {
    const wrap = add('div', 'preview');
    wrap.append(gridPre(item));
    card.append(wrap);
  }
  return card;
}

// The fill generator writes 8th, 16th or triplet 8th fills, so the bar's shortest note is
// mapped to the nearest of those (a 32nd or dotted 16th bar gets a 16th fill).
export function fillSubdivision(smallestNote) {
  const label = String(smallestNote ?? '');
  if (label.includes('triplet 8th')) return 'triplet 8th';
  if (/16th|32nd/.test(label)) return '16th';
  return '8th';
}

function fillRequest(editor, level, style) {
  const range = scoreRange(editor);
  const snapshot = scoreSnapshot(editor, { maxBars: editor.bars.length });
  const inspection = inspectBars(snapshot, { fromBar: range.fromBar, toBar: range.fromBar });
  return {
    tempoBpm: Math.max(40, Math.min(220, editor.meta.tempoBpm)),
    subdivision: fillSubdivision(inspection.bars?.[0]?.smallestNote),
    level,
    style,
    bars: 1,
  };
}

export function mountLibrary(container, { getEditor, dispatch, onChange, fills = globalThis.window?.fills } = {}) {
  if (!container || typeof document === 'undefined') throw new Error('A library container is required.');
  const style = add('style');
  style.dataset.module = MODULE;
  style.textContent = `
    .${MODULE}-root { font: 14px system-ui, sans-serif; color: #1f2937; padding: 12px; max-width: 760px; }
    .${MODULE}-tabs, .${MODULE}-filters, .${MODULE}-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; }
    .${MODULE}-tabs { margin-bottom: 12px; }
    .${MODULE}-tab[aria-pressed="true"] { background: #1d4ed8; color: white; }
    .${MODULE}-label { display: flex; flex-direction: column; gap: 3px; font-weight: 600; }
    .${MODULE}-input, .${MODULE}-select { min-height: 32px; padding: 4px 7px; border: 1px solid #9ca3af; border-radius: 4px; font: inherit; }
    /* The label (a column) grows along the row; the box inside keeps its normal height. */
    .${MODULE}-search-label { flex: 1 1 220px; }
    .${MODULE}-search { height: 32px; width: 100%; }
    .${MODULE}-button { min-height: 32px; padding: 5px 10px; border: 1px solid #1d4ed8; border-radius: 4px; background: #eff6ff; color: #1e3a8a; cursor: pointer; font: inherit; }
    .${MODULE}-button:focus-visible, .${MODULE}-input:focus-visible, .${MODULE}-select:focus-visible { outline: 3px solid #f59e0b; outline-offset: 2px; }
    .${MODULE}-card { margin: 10px 0; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; }
    .${MODULE}-card-title { margin: 0 0 4px; font-size: 1rem; }
    .${MODULE}-facts, .${MODULE}-description, .${MODULE}-why, .${MODULE}-fill-context { margin: 5px 0; }
    .${MODULE}-facts { color: #4b5563; }
    .${MODULE}-why { color: #374151; font-size: .92rem; }
    .${MODULE}-preview { margin: 8px 0; padding: 8px; background: #f3f4f6; overflow: auto; }
    .${MODULE}-grid { margin: 0; font: 13px ui-monospace, SFMono-Regular, monospace; white-space: pre-wrap; }
    .${MODULE}-status { min-height: 1.4em; margin: 10px 0; color: #124e2a; }
    .${MODULE}-error { color: #9f1239; }
    .${MODULE}-section-title { margin: 10px 0 6px; }
    .${MODULE}-checks { margin: 5px 0; }
  `;

  const root = add('div', 'root');
  const tabs = add('div', 'tabs');
  const exerciseTab = add('button', 'button tab', 'Exercises');
  const fillTab = add('button', 'button tab', 'Fill Lab');
  exerciseTab.type = fillTab.type = 'button';
  // Two toggle buttons (not tabs): aria-pressed says which section is showing.
  exerciseTab.setAttribute('aria-pressed', 'true');
  fillTab.setAttribute('aria-pressed', 'false');
  tabs.append(exerciseTab, fillTab);
  root.append(add('h2', 'section-title', 'Exercise library and Fill Lab'), tabs);
  const status = add('p', 'status');
  status.setAttribute('aria-live', 'polite');
  root.append(status);

  const exerciseSection = add('section', 'section');
  exerciseSection.setAttribute('aria-label', 'Exercises');
  const exerciseControls = add('div', 'filters');
  const search = add('input', 'input search');
  search.type = 'search'; search.id = 'library-ui-search'; search.placeholder = 'Search exercises';
  const searchLabel = labelFor('Search', search);
  searchLabel.classList.add(`${MODULE}-search-label`);
  exerciseControls.append(searchLabel);
  const level = add('select', 'select'); options(level, LEVELS);
  const styleSelect = add('select', 'select');
  const subdivision = add('select', 'select'); options(subdivision, SUBDIVISIONS, 'Any note value');
  const goal = add('select', 'select');
  const catalogueStyles = [...new Set(EXERCISES.flatMap(item => item.styles))].sort();
  const catalogueGoals = [...new Set(EXERCISES.flatMap(item => item.goals))].sort();
  options(styleSelect, catalogueStyles, 'Any style');
  options(goal, catalogueGoals, 'Any goal');
  exerciseControls.append(labelFor('Level', level), labelFor('Style', styleSelect), labelFor('Note value', subdivision), labelFor('Goal', goal));
  const suggest = add('button', 'button', 'Suggested for these bars');
  suggest.type = 'button';
  exerciseControls.append(suggest);
  exerciseSection.append(exerciseControls);
  const exerciseResults = add('div', 'results');
  exerciseSection.append(exerciseResults);
  root.append(exerciseSection);

  const fillSection = add('section', 'section');
  fillSection.hidden = true;
  fillSection.setAttribute('aria-label', 'Fill Lab');
  fillSection.append(add('h3', 'section-title', 'Fill Lab'));
  const fillContext = add('p', 'fill-context');
  fillSection.append(fillContext);
  const fillControls = add('div', 'filters');
  // Fills need a real level (no "Any"): recommendations and new fills are chosen for it.
  const fillLevel = add('select', 'select'); options(fillLevel, LEVELS); fillLevel.firstElementChild.remove(); fillLevel.value = 'beginner';
  const fillStyle = add('select', 'select');
  const fillStyles = [...new Set(FILLS.flatMap(item => item.styles))].sort();
  options(fillStyle, fillStyles, 'Choose a style');
  fillStyle.value = fillStyles.includes('rock') ? 'rock' : fillStyles[0] ?? '';
  const findFills = add('button', 'button', 'Find fills');
  findFills.type = 'button';
  fillControls.append(labelFor('Level', fillLevel), labelFor('Style', fillStyle), findFills);
  const makeFill = add('button', 'button', 'Make a new fill (cloud)');
  makeFill.type = 'button';
  fillControls.append(makeFill);
  fillSection.append(fillControls);
  const fillResults = add('div', 'results');
  fillSection.append(fillResults);
  const generated = add('div', 'generated');
  fillSection.append(generated);
  root.append(fillSection);
  container.replaceChildren(style, root);

  const previewStates = new Set();
  const ui = { suggested: false, fillResults: [], generated: null };
  const itemById = id => EXERCISES.find(item => item.id === id) ?? FILLS.find(item => item.id === id);
  const report = (message, error = false) => { status.textContent = message; status.classList.toggle(`${MODULE}-error`, error); };
  const exerciseQuery = () => ({
    ...(search.value.trim() ? { text: search.value.trim() } : {}),
    ...(level.value ? { level: level.value } : {}),
    ...(styleSelect.value ? { styles: [styleSelect.value] } : {}),
    ...(subdivision.value ? { subdivision: subdivision.value } : {}),
    ...(goal.value ? { goals: [goal.value] } : {}),
  });
  const renderExercises = () => {
    const results = ui.suggested
      ? exercisesForPassage(passageQuery(getEditor()), { level: level.value || undefined, style: styleSelect.value || undefined })
      : searchExercises(exerciseQuery());
    exerciseResults.replaceChildren();
    if (!results.length) { exerciseResults.append(add('p', 'empty', 'No exercises matched those choices.')); return; }
    results.forEach(result => {
      const item = itemById(result.id);
      if (!item) return;
      exerciseResults.append(resultCard(result, item, {
        previewKey: `exercise-${item.id}`, previewStates,
        onAdd: () => {
          const before = getEditor();
          try {
            if (!dispatch(insertExerciseCommand(item))) { report(`Could not add '${item.title}'.`, true); return; }
            report(addedMessage(before, getEditor(), item.title));
          } catch (error) { report(error instanceof Error ? error.message : String(error), true); }
        },
      }));
    });
  };
  const updateFillContext = () => {
    const editor = getEditor();
    const request = fillRequest(editor, fillLevel.value, fillStyle.value);
    fillContext.textContent = `Score tempo: ${request.tempoBpm} BPM. Smallest note in ${scoreRange(editor).fromBar === scoreRange(editor).toBar ? `bar ${scoreRange(editor).fromBar}` : 'the selected bars'}: ${human(request.subdivision)}.`;
  };
  const renderFillResults = () => {
    fillResults.replaceChildren();
    if (!ui.fillResults.length) { fillResults.append(add('p', 'empty', 'No fills match this tempo, note value, and level.')); return; }
    ui.fillResults.forEach(result => {
      const item = FILLS.find(candidate => candidate.id === result.id);
      if (!item) return;
      fillResults.append(resultCard(result, item, {
        previewKey: `fill-${item.id}`, previewStates,
        onAdd: () => {
          const before = getEditor();
          try {
            if (!dispatch(insertExerciseCommand(item))) { report(`Could not add '${item.title}'.`, true); return; }
            report(addedMessage(before, getEditor(), item.title));
          } catch (error) { report(error instanceof Error ? error.message : String(error), true); }
        },
      }));
    });
  };
  const renderGenerated = () => {
    generated.replaceChildren();
    if (!ui.generated) return;
    const result = ui.generated;
    generated.append(add('h4', 'card-title', 'New fill'));
    generated.append(add('p', 'description', 'This generated fill is from GPT-5.6 Luna and was checked by DrumHub.'));
    if (result.idea) generated.append(add('p', 'description', result.idea));
    const validation = validateGeneratedFill(result.notes);
    const checks = add('ul', 'checks');
    (result.checks?.length ? result.checks : validation.errors).forEach(check => checks.append(add('li', '', check)));
    generated.append(checks, gridPre({ bars: [{ notes: validation.bar.notes }] }));
    const addButton = add('button', 'button', 'Add to score');
    addButton.type = 'button'; addButton.disabled = !validation.ok;
    addButton.addEventListener('click', () => {
      if (!validateGeneratedFill(result.notes).ok) return;
      const before = getEditor();
      try {
        if (!dispatch(insertExerciseCommand({ title: 'New generated fill', bars: [{ notes: result.notes }] }))) {
          report('Could not add the new fill.', true); return;
        }
        report(addedMessage(before, getEditor(), 'New generated fill'));
      } catch (error) { report(error instanceof Error ? error.message : String(error), true); }
    });
    generated.append(addButton);
  };

  const refreshExerciseSearch = () => { ui.suggested = false; renderExercises(); };
  [search, level, styleSelect, subdivision, goal].forEach(control => control.addEventListener('input', refreshExerciseSearch));
  [level, styleSelect, subdivision, goal].forEach(control => control.addEventListener('change', refreshExerciseSearch));
  suggest.addEventListener('click', () => {
    ui.suggested = true; renderExercises(); report('These suggestions use the selected bars, or the cursor bar.');
  });
  findFills.addEventListener('click', () => {
    const request = fillRequest(getEditor(), fillLevel.value, fillStyle.value);
    ui.fillResults = recommendFills(request);
    renderFillResults();
    report(ui.fillResults.length ? 'Here are fills that fit this score.' : 'No fills match this score.');
  });
  makeFill.addEventListener('click', async () => {
    const api = fills;
    if (!api || typeof api.generate !== 'function') {
      report('Making a new fill is not available because cloud help is not connected.', true); return;
    }
    makeFill.disabled = true;
    report('Making a new fill…');
    try {
      const result = await api.generate(fillRequest(getEditor(), fillLevel.value, fillStyle.value));
      if (!result || result.error) { report(result?.error || 'DrumHub could not make a new fill.', true); return; }
      ui.generated = result; renderGenerated(); report('The new fill is ready to preview.');
    } catch (error) { report(error instanceof Error ? error.message : String(error), true); }
    finally { makeFill.disabled = false; }
  });
  const showTab = fill => {
    exerciseSection.hidden = fill; fillSection.hidden = !fill;
    exerciseTab.setAttribute('aria-pressed', String(!fill)); fillTab.setAttribute('aria-pressed', String(fill));
    if (fill) updateFillContext();
  };
  exerciseTab.addEventListener('click', () => showTab(false));
  fillTab.addEventListener('click', () => showTab(true));
  updateFillContext();
  renderExercises();
  if (typeof onChange === 'function') onChange(() => { updateFillContext(); });
  // Show one exercise with its preview open (used by Ask DrumHub's "Open the exercise" button).
  const openExercise = id => {
    const item = itemById(id);
    if (!item) { report('That exercise is not in the library.', true); return false; }
    showTab(false);
    previewStates.add(`exercise-${item.id}`);
    exerciseResults.replaceChildren(resultCard({ id: item.id, reasons: ['Suggested by Ask DrumHub'] }, item, {
      previewKey: `exercise-${item.id}`, previewStates,
      onAdd: () => {
        const before = getEditor();
        if (!dispatch(insertExerciseCommand(item))) { report(`Could not add '${item.title}'.`, true); return; }
        report(addedMessage(before, getEditor(), item.title));
      },
    }));
    report(`Showing '${item.title}'. Search again to see the whole library.`);
    return true;
  };
  return { refresh: () => { updateFillContext(); renderExercises(); renderFillResults(); }, openExercise, destroy: () => container.replaceChildren() };
}
