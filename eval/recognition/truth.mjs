// Ground truth for recognition benchmarks: an editor bar → the recognisers' note format
// ({ position 0-31, duration, drums }), and a comparison of one prediction with the truth.
// Pure; used by render-synthetic.cjs and run.mjs.
import { MODEL_DURATIONS } from '../../js/import.js';
import { noteTicks } from '../../js/bar.js';

const TICKS_PER_SLOT = 6;   // 192 ticks per 4/4 bar, 32 slots

function modelDuration(note) {
  const match = Object.entries(MODEL_DURATIONS).find(([, shape]) =>
    shape.duration === note.duration && Boolean(shape.dotted) === note.dotted && Boolean(shape.triplet) === Boolean(note.triplet));
  return match ? match[0] : null;
}

// null when the bar uses something the recognisers' vocabulary cannot express
// (for example a dotted 16th), so it is left out of the benchmark.
export function barToTruth(bar) {
  let onset = 0;
  const notes = [];
  for (const note of bar.notes) {
    const duration = modelDuration(note);
    if (!duration) return null;
    if (note.drums.length) {
      notes.push({ position: Math.round(onset / TICKS_PER_SLOT), duration, drums: [...note.drums].sort() });
    }
    onset += noteTicks(note);
  }
  if (onset !== 192) return null;
  return notes;
}

const key = note => `${note.position}:${[...note.drums].sort().join('+')}`;

// Scores one predicted bar. exact: same onsets, drums and durations.
export function compareBar(truth, predicted) {
  const t = new Map(truth.map(n => [n.position, n]));
  const p = new Map(predicted.map(n => [n.position, { ...n, drums: [...n.drums].sort() }]));
  const onsetsMatched = [...t.keys()].filter(pos => p.has(pos)).length;
  const truthHits = new Set(truth.flatMap(n => n.drums.map(d => `${n.position}:${d}`)));
  const predHits = new Set([...p.values()].flatMap(n => n.drums.map(d => `${n.position}:${d}`)));
  const drumHitsMatched = [...truthHits].filter(h => predHits.has(h)).length;
  const durationsMatched = [...t.keys()].filter(pos => p.has(pos) && p.get(pos).duration === t.get(pos).duration).length;
  const exact = truth.length === p.size && truth.every(n => p.has(n.position) && key(p.get(n.position)) === key(n) && p.get(n.position).duration === n.duration);
  return {
    exact,
    onsets: { truth: t.size, predicted: p.size, matched: onsetsMatched },
    drumHits: { truth: truthHits.size, predicted: predHits.size, matched: drumHitsMatched },
    durations: { compared: onsetsMatched, matched: durationsMatched },
  };
}
