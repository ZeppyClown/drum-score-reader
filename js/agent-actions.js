// ── Ask DrumHub proposed actions ──────────────────────────────────────────────
// Actions are suggestions, not score edits. They are validated locally, shown as
// a preview, and only applied after an explicit confirmation. Pure: no state, DOM,
// Electron or network. Notes and saved tempo are never changed here.

import { execute } from './commands.js';
import { selectBarsCommand } from './selection.js';

export const ACTION_TYPES = ['select_bars', 'set_loop', 'set_tempo', 'open_exercise'];

const ACTION_FIELDS = ['type', 'fromBar', 'toBar', 'tempoBpm', 'exerciseId', 'reason'];
const ACTION_FIELD_SET = new Set(ACTION_FIELDS);
const MAX_ACTIONS = 3;
const MAX_REASON_LENGTH = 160;

const nullable = (type, description) => ({ type: [type, 'null'], description });

// Responses API strict schemas require every property to be present. Unused
// properties are nullable instead of optional, so a model cannot smuggle in a
// second shape for an action. Lengths and counts are checked in validateActions,
// not in the schema: strict mode has refused keywords such as minLength/maxLength.
export const ACTION_SCHEMA = {
  type: 'array',
  description: 'Up to three safe, reversible actions to preview for the drummer.',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ACTION_FIELDS,
    properties: {
      type: { type: 'string', enum: ACTION_TYPES, description: 'The proposed reversible action.' },
      fromBar: nullable('integer', 'First bar number, for a bar selection or loop.'),
      toBar: nullable('integer', 'Last bar number, for a bar selection or loop.'),
      tempoBpm: nullable('integer', 'Playback tempo in beats per minute, from 40 to 220.'),
      exerciseId: nullable('string', 'Catalogue exercise ID to open.'),
      reason: { type: 'string', description: 'A short sentence explaining why this helps.' },
    },
  },
};

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInteger = value => Number.isInteger(value);

function scoreTempo(snapshot, editor) {
  const fromSnapshot = snapshot?.tempoBpm;
  if (isInteger(fromSnapshot)) return fromSnapshot;
  const fromEditor = editor?.meta?.tempoBpm;
  return isInteger(fromEditor) ? fromEditor : null;
}

function exerciseIds(exercises) {
  if (Array.isArray(exercises)) return new Set(exercises.map(item => typeof item === 'string' ? item : item?.id).filter(Boolean));
  if (exercises instanceof Set) return exercises;
  if (exercises instanceof Map) return new Set(exercises.keys());
  if (isObject(exercises)) return new Set(Object.keys(exercises));
  return new Set();
}

function barCount(snapshot, editor) {
  if (isInteger(snapshot?.totalBars) && snapshot.totalBars >= 0) return snapshot.totalBars;
  return Array.isArray(editor?.bars) ? editor.bars.length : 0;
}

function validateRange(action, snapshot, editor, problems) {
  if (!isInteger(action.fromBar) || !isInteger(action.toBar)) {
    problems.push('Set "fromBar" and "toBar" to whole bar numbers for the range.');
    return false;
  }
  const first = snapshot?.range?.fromBar;
  const last = snapshot?.range?.toBar;
  if (!isInteger(first) || !isInteger(last) || action.fromBar < first || action.toBar > last || action.fromBar > action.toBar) {
    if (isInteger(first) && isInteger(last)) {
      problems.push(`Use an ordered bar range from ${first} to ${last}, because those are the bars available in the snapshot.`);
    } else {
      problems.push('Use an ordered bar range from the snapshot.');
    }
    return false;
  }
  const total = barCount(snapshot, editor);
  if (action.fromBar < 1 || action.toBar > total) {
    problems.push(`Use bars 1–${total}; the proposed range is outside the score.`);
    return false;
  }
  return true;
}

function fieldsAreStrict(action, problems, index) {
  if (!isObject(action)) {
    problems.push(`Action ${index} must be an object with the six required action fields.`);
    return false;
  }
  const keys = Object.keys(action);
  const unknown = keys.filter(key => !ACTION_FIELD_SET.has(key));
  if (unknown.length) problems.push(`Remove unknown field${unknown.length === 1 ? '' : 's'} ${unknown.map(key => JSON.stringify(key)).join(', ')} from action ${index}.`);
  const missing = ACTION_FIELDS.filter(key => !Object.hasOwn(action, key));
  if (missing.length) problems.push(`Add the missing field${missing.length === 1 ? '' : 's'} ${missing.map(key => JSON.stringify(key)).join(', ')} to action ${index}.`);
  return unknown.length === 0 && missing.length === 0;
}

function validateReason(action, problems) {
  if (typeof action.reason !== 'string' || !action.reason.trim() || action.reason.length > MAX_REASON_LENGTH || /[\r\n]/.test(action.reason)) {
    problems.push(`Give each action a short, non-empty reason sentence of at most ${MAX_REASON_LENGTH} characters.`);
    return false;
  }
  return true;
}

function unusedFieldsAreNull(action, type, problems) {
  const expected = type === 'select_bars' || type === 'set_loop'
    ? ['tempoBpm', 'exerciseId']
    : type === 'set_tempo'
      ? ['fromBar', 'toBar', 'exerciseId']
      : ['fromBar', 'toBar', 'tempoBpm'];
  const bad = expected.filter(field => action[field] !== null);
  if (bad.length) {
    problems.push(`Set unused field${bad.length === 1 ? '' : 's'} ${bad.map(field => JSON.stringify(field)).join(', ')} to null for a ${type} action.`);
    return false;
  }
  return true;
}

function duplicateKey(action) {
  return JSON.stringify([action.type, action.fromBar, action.toBar, action.tempoBpm, action.exerciseId]);
}

// Validate model-produced actions without ever allowing malformed input to escape
// into the editor. Problems are instructions for one model repair round.
export function validateActions(rawActions, { snapshot = null, editor = null, exercises = [] } = {}) {
  try {
    const problems = [];
    if (!Array.isArray(rawActions)) return { actions: [], problems: ['Reply with an actions array containing up to three action objects.'] };
    if (rawActions.length > MAX_ACTIONS) problems.push(`Return at most ${MAX_ACTIONS} actions; remove the extras.`);

    const ids = exerciseIds(exercises);
    const currentTempo = scoreTempo(snapshot, editor);
    const actions = [];
    const seen = new Set();
    rawActions.slice(0, MAX_ACTIONS).forEach((raw, offset) => {
      const index = offset + 1;
      if (!fieldsAreStrict(raw, problems, index)) return;
      if (!ACTION_TYPES.includes(raw.type)) {
        problems.push(`Set action ${index} "type" to one of: ${ACTION_TYPES.join(', ')}.`);
        return;
      }
      if (!validateReason(raw, problems) || !unusedFieldsAreNull(raw, raw.type, problems)) return;

      let valid = true;
      if (raw.type === 'select_bars' || raw.type === 'set_loop') {
        valid = validateRange(raw, snapshot, editor, problems);
      } else if (raw.type === 'set_tempo') {
        if (!isInteger(raw.tempoBpm) || raw.tempoBpm < 40 || raw.tempoBpm > 220) {
          problems.push('Set "tempoBpm" to a whole-number playback tempo from 40 to 220 BPM.');
          valid = false;
        }
        if (currentTempo === null || raw.tempoBpm < currentTempo * 0.6 || raw.tempoBpm > currentTempo * 1.4) {
          problems.push(currentTempo === null
            ? 'Choose a playback tempo only when the score tempo is available.'
            : `Keep "tempoBpm" within 40% of the score tempo of ${currentTempo} BPM (between ${currentTempo * 0.6} and ${currentTempo * 1.4} BPM).`);
          valid = false;
        }
      } else if (!ids.has(raw.exerciseId)) {
        problems.push(`Use an "exerciseId" that is present in the exercise catalogue; ${JSON.stringify(raw.exerciseId)} was not found.`);
        valid = false;
      }
      if (!valid) return;

      const normalized = {
        type: raw.type,
        fromBar: raw.fromBar,
        toBar: raw.toBar,
        tempoBpm: raw.tempoBpm,
        exerciseId: raw.exerciseId,
        reason: raw.reason.trim(),
      };
      const key = duplicateKey(normalized);
      if (seen.has(key)) {
        problems.push(`Remove duplicate action ${index}; keep only one copy of the same proposal.`);
        return;
      }
      seen.add(key);
      actions.push(normalized);
    });
    return { actions, problems };
  } catch {
    return { actions: [], problems: ['Reply with a valid actions array whose fields match the action schema.'] };
  }
}

const rangeText = (from, to, label = 'bars') => from === to ? `bar ${from}` : `${label} ${from}–${to}`;

function exerciseTitle(id) {
  if (typeof id !== 'string') return String(id ?? 'unknown');
  if (/\s/.test(id)) return id;
  return id.split(/[-_]+/).filter(Boolean).map(word => word[0]?.toUpperCase() + word.slice(1)).join(' ');
}

// Text shown in the confirmation preview. Keep it short and easy for a young drummer.
export function describeAction(action) {
  try {
    switch (action?.type) {
      case 'select_bars': return `Select ${rangeText(action.fromBar, action.toBar)}`;
      case 'set_loop': return `Loop ${rangeText(action.fromBar, action.toBar)}`;
      case 'set_tempo': {
        const scoreTempo = action.scoreTempoBpm ?? action.scoreTempo ?? action.savedTempoBpm;
        return Number.isInteger(scoreTempo)
          ? `Practise at ${action.tempoBpm} BPM (the score is ${scoreTempo} BPM)`
          : `Practise at ${action.tempoBpm} BPM`;
      }
      case 'open_exercise': return `Open the exercise '${exerciseTitle(action.exerciseId)}'`;
      default: return 'Review this proposed action';
    }
  } catch {
    return 'Review this proposed action';
  }
}

function actionBarIds(action, editor) {
  const fromBarId = action?.fromBarId ?? (isInteger(action?.fromBar) ? editor?.bars?.[action.fromBar - 1]?.barId : null);
  const toBarId = action?.toBarId ?? (isInteger(action?.toBar) ? editor?.bars?.[action.toBar - 1]?.barId : null);
  if (typeof fromBarId !== 'string' || typeof toBarId !== 'string') return null;
  if (!editor?.bars?.some(bar => bar.barId === fromBarId) || !editor.bars.some(bar => bar.barId === toBarId)) return null;
  return { fromBarId, toBarId };
}

// Turn an already validated action into the narrow editor command/effect pair.
// The command itself is still inert until a caller runs it through execute().
export function actionCommand(action, editor) {
  try {
    if (action?.type === 'select_bars' || action?.type === 'set_loop') {
      const ids = actionBarIds(action, editor);
      if (!ids) return { command: null, effect: null };
      return {
        command: selectBarsCommand(ids.fromBarId, ids.toBarId),
        effect: action.type === 'set_loop' ? { kind: 'playback', loop: true } : null,
      };
    }
    if (action?.type === 'set_tempo' && isInteger(action.tempoBpm)) {
      return { command: null, effect: { kind: 'playback', tempoBpm: action.tempoBpm } };
    }
    if (action?.type === 'open_exercise' && typeof action.exerciseId === 'string') {
      return { command: null, effect: { kind: 'exercise', exerciseId: action.exerciseId } };
    }
  } catch { /* malformed proposals are refused below */ }
  return { command: null, effect: null };
}

// Apply only a finalized proposal that still describes this exact score version.
// Selection is view state and therefore does not advance revision or history; the
// other supported actions return effects and do not alter score metadata.
export function applyConfirmed(editor, action, { confirmed = false } = {}) {
  if (confirmed !== true || !editor || action?.scoreId !== editor.meta?.scoreId || action?.revision !== editor.meta?.revision) {
    return { editor, effect: null };
  }
  const { command, effect } = actionCommand(action, editor);
  return command ? { editor: execute(editor, command), effect } : { editor, effect };
}

// Attach the score version and stable bar IDs only after local validation succeeds.
// The generated id is deterministic within a proposal and unique across revisions.
export function finalizeActions(actions, snapshot) {
  try {
    if (!Array.isArray(actions)) return [];
    const bars = Array.isArray(snapshot?.bars) ? snapshot.bars : [];
    return actions.slice(0, MAX_ACTIONS).map((action, index) => {
      const from = isInteger(action?.fromBar) ? bars.find(bar => bar?.barNumber === action.fromBar)?.barId ?? null : null;
      const to = isInteger(action?.toBar) ? bars.find(bar => bar?.barNumber === action.toBar)?.barId ?? null : null;
      return {
        ...action,
        scoreId: snapshot?.scoreId ?? null,
        revision: snapshot?.revision ?? null,
        fromBarId: from,
        toBarId: to,
        id: `action-${snapshot?.scoreId ?? 'score'}-${snapshot?.revision ?? 'revision'}-${index + 1}`,
      };
    });
  } catch {
    return [];
  }
}
