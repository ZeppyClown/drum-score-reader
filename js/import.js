// ── OMR prediction → editable bar ─────────────────────────────────────────────
// Converts the local OMR service's /predict notes ({ position, duration, drums },
// see backend/README.md) into one editor bar made of the same notes the keyboard
// creates. Pure: no state, DOM, or VexFlow, so it is tested in Node.
//
// Timing comes from `position` (the grid slot where a hit starts). The model's
// written duration is kept when it ends before the next hit and shortened when it
// would overlap. Gaps become rests, and the bar is always filled to a full 4/4.
// Triplet hits are grouped from the start of their beat into the nearest of three
// slots, because the model's positions round triplets onto the 32nd-note grid.
// Every adjustment is reported in `warnings` so the UI can flag the bar for review.

import { BAR_TICKS, DRUMS, DUR_TICKS, DURATIONS } from './constants.js';
import { fitDuration, noteTicks } from './bar.js';

// Model duration name → editor note shape. Kept in step with the model by a test.
export const MODEL_DURATIONS = {
  whole:             { duration: 'w' },
  half:              { duration: 'h' },
  dotted_quarter:    { duration: 'q', dotted: true },
  quarter:           { duration: 'q' },
  dotted_eighth:     { duration: '8', dotted: true },
  eighth:            { duration: '8' },
  sixteenth:         { duration: '16' },
  thirty_second:     { duration: '32' },
  triplet_eighth:    { duration: '8', triplet: true },
  triplet_sixteenth: { duration: '16', triplet: true },
};

// Thrown when the service's output cannot be a bar (wrong shape, unknown names).
export class PredictionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PredictionError';
  }
}

// Plain note lengths the editor can hold, longest first (dotted 32nds excluded).
const PLAIN_LENGTHS = DURATIONS
  .flatMap(duration => (duration === DURATIONS[0]
    ? [{ duration, dotted: false }]
    : [{ duration, dotted: false }, { duration, dotted: true }]))
  .map(shape => ({ ...shape, ticks: noteTicks({ ...shape, drums: [] }) }))
  .sort((a, b) => b.ticks - a.ticks);

const unique = list => [...new Set(list)];

function validate(notes, gridSlots) {
  if (!Number.isInteger(gridSlots) || gridSlots < 4 || BAR_TICKS % gridSlots !== 0) {
    throw new PredictionError(`Unsupported beat grid of ${gridSlots} slots per bar`);
  }
  if (!Array.isArray(notes)) throw new PredictionError('The prediction must be a list of notes');
  let previous = -1;
  notes.forEach((note, i) => {
    const which = `Note ${i + 1}`;
    if (!note || typeof note !== 'object') throw new PredictionError(`${which} is not a note`);
    if (!Number.isInteger(note.position) || note.position < 0 || note.position >= gridSlots) {
      throw new PredictionError(`${which} has an invalid position: ${note.position}`);
    }
    if (note.position <= previous) {
      throw new PredictionError(`${which} is out of order (position ${note.position})`);
    }
    previous = note.position;
    if (!Object.hasOwn(MODEL_DURATIONS, note.duration)) {
      throw new PredictionError(`${which} has an unknown duration: ${note.duration}`);
    }
    if (!Array.isArray(note.drums) || note.drums.length === 0) {
      throw new PredictionError(`${which} has no drums`);
    }
    const unknown = note.drums.find(drum => !Object.hasOwn(DRUMS, drum));
    if (unknown !== undefined) throw new PredictionError(`${which} has an unknown drum: ${unknown}`);
  });
}

// Plain rests that exactly fill `ticks`, longest first.
function rests(ticks) {
  const out = [];
  for (let left = ticks; left > 0;) {
    const duration = fitDuration(left);
    if (DUR_TICKS[duration] > left) throw new PredictionError(`Cannot fill a gap of ${left} ticks`);
    out.push({ duration, dotted: false, drums: [] });
    left -= DUR_TICKS[duration];
  }
  return out;
}

function warn(warnings, code, event, message) {
  warnings.push({ code, position: event.position, message: message.replace('BEAT', event.beat) });
}

// A plain note that starts at event.onset and ends by nextOnset.
function plainNote(event, nextOnset, warnings) {
  const { duration, dotted = false } = event.shape;
  const written = noteTicks({ duration, dotted, drums: [] });
  const room    = nextOnset - event.onset;
  const length  = PLAIN_LENGTHS.find(candidate => candidate.ticks <= Math.min(written, room));
  if (written > room) {
    warn(warnings, 'shortened', event, 'The note on BEAT was shortened so it ends before the next note');
  }
  return { duration: length.duration, dotted: length.dotted, drums: event.drums };
}

// Three triplet notes covering the beat that contains events[index], or null when
// that beat already started under the previous note.
function tripletGroup(events, index, time, warnings) {
  const first = events[index];
  const span  = 2 * DUR_TICKS[first.shape.duration];
  const start = Math.floor(first.onset / span) * span;
  if (start < time) {
    warn(warnings, 'triplet_unplaced', first,
      'The triplet on BEAT overlapped the previous note, so it was imported as a plain note');
    return null;
  }
  const slots = [[], [], []];
  let next = index;
  for (; next < events.length && events[next].onset < start + span; next++) {
    const event = events[next];
    const slot  = Math.min(2, Math.round((event.onset - start) / (span / 3)));
    if (!event.shape.triplet) {
      warn(warnings, 'merged_into_triplet', event, 'The note on BEAT was folded into a triplet');
    } else if (slots[slot].length > 0) {
      warn(warnings, 'merged_into_chord', event, 'Two notes near BEAT were combined into one chord');
    }
    slots[slot] = unique([...slots[slot], ...event.drums]);
  }
  const notes = slots.map(drums => ({ duration: first.shape.duration, dotted: false, triplet: true, drums }));
  return { start, span, next, notes };
}

// notes: the service's `notes` array. gridSlots: its N_BEATS (32 slots per 4/4 bar).
// Returns { bar, warnings }; throws PredictionError for output that cannot be a bar.
export function barFromPrediction(notes, { gridSlots = 32 } = {}) {
  validate(notes, gridSlots);
  const slotTicks = BAR_TICKS / gridSlots;
  const events = notes.map(note => ({
    position: note.position,
    onset:    note.position * slotTicks,
    beat:     `beat ${1 + note.position / (gridSlots / 4)}`,
    shape:    MODEL_DURATIONS[note.duration],
    drums:    unique(note.drums),
  }));

  const out = [];
  const warnings = [];
  let time = 0;
  for (let i = 0; i < events.length;) {
    const event = events[i];
    const group = event.shape.triplet ? tripletGroup(events, i, time, warnings) : null;
    if (group) {
      out.push(...rests(group.start - time), ...group.notes);
      time = group.start + group.span;
      i = group.next;
    } else {
      const note = plainNote(event, events[i + 1]?.onset ?? BAR_TICKS, warnings);
      out.push(...rests(event.onset - time), note);
      time = event.onset + noteTicks(note);
      i += 1;
    }
  }
  return { bar: { notes: [...out, ...rests(BAR_TICKS - time)] }, warnings };
}
