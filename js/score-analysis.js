// ── Deterministic score intelligence ──────────────────────────────────────────
// Facts about a score snapshot (score-snapshot.js): overview, beat-by-beat bars,
// repeats, comparisons, possible fills, notation complexity, and a practice plan.
// Pure and exact — these are the only source of score facts for Ask DrumHub; a model
// may explain them but never calculates them. Tested in Node against hand-labelled
// fixtures (test/fixture-scores.mjs).
//
// Every result is plain data with bar numbers (1-based) so answers can cite them.
// A tool that cannot answer returns { error } instead of guessing.
//
// Analysis counts beats in 4/4 only for now (the editor's MVP limit).

const TICKS_PER_BEAT = 48;
const FOOT_DRUMS = new Set(['kick', 'hi_hat_pedal']);
const TOMS = new Set(['tom_hi', 'tom_mid', 'floor_tom_1', 'floor_tom_2']);
const HI_HATS = new Set(['hi_hat_closed', 'hi_hat_open_half', 'hi_hat_open_full', 'hi_hat_pedal']);
const CYMBALS = new Set(['crash', 'ride', 'ride_bell']);
const NOTE_NAMES = { 32: '32nd', 16: '16th', 8: '8th', q: 'quarter', h: 'half', w: 'whole' };
const SYLLABLES = { 12: 'e', 24: '&', 36: 'a', 16: 'trip', 32: 'let' };
const round2 = n => Math.round(n * 100) / 100;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Weights for the 0–100 notation-complexity score (plan §4 C5). Initial values, to be
// tuned with teachers; every signal is returned too so the ranking stays inspectable.
export const COMPLEXITY_WEIGHTS = Object.freeze({
  subdivisionDensity: 0.30,
  coordination: 0.25,
  syncopation: 0.15,
  rhythmChanges: 0.15,
  drumMovement: 0.10,
  tempo: 0.05,
});

// ── Labels ────────────────────────────────────────────────────────────────────

// "1", "1e", "1&", "1a", "2trip", "2let", "3 (32nd)", "3 (triplet 16th)"
export function countLabel(onsetTicks) {
  const beat = Math.floor(onsetTicks / TICKS_PER_BEAT) + 1;
  const offset = onsetTicks % TICKS_PER_BEAT;
  if (offset === 0) return String(beat);
  if (SYLLABLES[offset]) return `${beat}${SYLLABLES[offset]}`;
  return offset % 6 === 0 ? `${beat} (32nd)` : `${beat} (triplet 16th)`;
}

// "dotted quarter", "triplet 8th", "16th"
export function durationLabel(event) {
  return `${event.dotted ? 'dotted ' : ''}${event.triplet ? 'triplet ' : ''}${NOTE_NAMES[event.writtenDuration]}`;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

const unsupported = snap => (snap.meter.beats === 4 && snap.meter.beatUnit === 4 ? null
  : { error: `Analysis only counts 4/4 bars for now; this score is in ${snap.meter.beats}/${snap.meter.beatUnit}.` });

const hitsOf = bar => bar.events.filter(e => !e.isRest);
const findBar = (snap, n) => snap.bars.find(b => b.barNumber === n);
const barCapacity = snap => snap.meter.beats * (192 / snap.meter.beatUnit);

// Every (onset, drum) pair — what a listener hears, independent of how rests are written.
const hitSet = bar => new Set(hitsOf(bar).flatMap(e => e.drums.map(d => `${e.onsetTicks}:${d}`)));
const hitList = keys => [...keys]
  .map(key => { const [onset, drum] = key.split(':'); return { onset: Number(onset), drum }; })
  .sort((a, b) => a.onset - b.onset || a.drum.localeCompare(b.drum))
  .map(({ onset, drum }) => ({ count: countLabel(onset), drum }));

function similarity(a, b) {
  const union = new Set([...a, ...b]).size;
  if (union === 0) return 1;
  return [...a].filter(k => b.has(k)).length / union;
}

function smallestEvent(bar) {
  return bar.events.reduce((min, e) => (!min || e.durationTicks < min.durationTicks ? e : min), null);
}

// Spoken counting: the beat number once, then syllables ("1 e & a 2 …"); rests in brackets.
function countingOf(bar) {
  let spokenBeat = 0;
  return bar.events.map(event => {
    const beat = Math.floor(event.onsetTicks / TICKS_PER_BEAT) + 1;
    const full = countLabel(event.onsetTicks);
    const word = beat === spokenBeat ? full.slice(String(beat).length).trim() : full;
    spokenBeat = beat;
    return event.isRest ? `(${word})` : word;
  }).join(' ');
}

function tripletGroupsIn(bar) {
  let groups = 0;
  for (let i = 0; i + 2 < bar.events.length; i++) {
    const trio = bar.events.slice(i, i + 3);
    if (trio.every(e => e.triplet && e.writtenDuration === trio[0].writtenDuration)) { groups++; i += 2; }
  }
  return groups;
}

// ── C1 overview ───────────────────────────────────────────────────────────────

export function getScoreOverview(snap) {
  const refused = unsupported(snap);
  if (refused) return refused;
  const drumHits = new Map();
  let restCount = 0; let chordCount = 0; let tripletGroups = 0;
  let smallest = null; const smallestBars = [];
  for (const bar of snap.bars) {
    for (const event of bar.events) {
      if (event.isRest) restCount++;
      if (event.drums.length > 1) chordCount++;
      event.drums.forEach(d => drumHits.set(d, (drumHits.get(d) ?? 0) + 1));
    }
    tripletGroups += tripletGroupsIn(bar);
    const small = smallestEvent(bar);
    if (!small) continue;
    if (!smallest || small.durationTicks < smallest.durationTicks) { smallest = small; smallestBars.length = 0; }
    if (small.durationTicks === smallest.durationTicks) smallestBars.push(bar.barNumber);
  }
  const perBarSeconds = snap.meter.beats * (4 / snap.meter.beatUnit) * 60 / snap.tempoBpm;
  return {
    totalBars: snap.totalBars,
    range: snap.range,
    truncated: snap.truncated,
    meter: `${snap.meter.beats}/${snap.meter.beatUnit}`,
    tempoBpm: snap.tempoBpm,
    durationSeconds: round2(snap.totalBars * perBarSeconds),
    drumsUsed: [...drumHits].map(([drum, hits]) => ({ drum, hits }))
      .sort((a, b) => b.hits - a.hits || a.drum.localeCompare(b.drum)),
    smallestNote: smallest ? { label: durationLabel(smallest), bars: smallestBars } : null,
    restCount, chordCount, tripletGroups,
    emptyBars: snap.bars.filter(b => hitsOf(b).length === 0).map(b => b.barNumber),
    incompleteBars: snap.bars.filter(b => b.events.reduce((t, e) => t + e.durationTicks, 0) < barCapacity(snap))
      .map(b => b.barNumber),
    unreviewedBars: snap.bars.filter(b => !b.reviewed).map(b => b.barNumber),
  };
}

// ── C2 inspect ────────────────────────────────────────────────────────────────

export function inspectBars(snap, { fromBar, toBar = fromBar }) {
  const [from, to] = [Number(fromBar), Number(toBar)].sort((a, b) => a - b);
  if (!Number.isInteger(from) || !Number.isInteger(to) || to - from > 64) {
    return { error: 'Ask about a range of up to 64 bars, for example bars 5 to 8.' };
  }
  const bars = []; const missingBars = [];
  for (let n = from; n <= to; n++) {
    const bar = findBar(snap, n);
    if (!bar) { missingBars.push(n); continue; }
    const previous = findBar(snap, n - 1);
    const small = smallestEvent(bar);
    bars.push({
      barNumber: n, barId: bar.barId, reviewed: bar.reviewed, source: bar.source,
      warnings: bar.warnings ?? [],
      counting: countingOf(bar),
      smallestNote: small ? durationLabel(small) : null,
      hits: hitsOf(bar).length,
      rests: bar.events.length - hitsOf(bar).length,
      tripletGroups: tripletGroupsIn(bar),
      events: bar.events.map(e => ({
        eventId: e.eventId, count: countLabel(e.onsetTicks), onsetTicks: e.onsetTicks,
        duration: durationLabel(e), drums: e.drums, isRest: e.isRest, isChord: e.drums.length > 1,
      })),
      changesFromPrevious: previous ? diffHits(previous, bar) : null,
    });
  }
  return { bars, missingBars };
}

function diffHits(a, b) {
  const [setA, setB] = [hitSet(a), hitSet(b)];
  return {
    added: hitList([...setB].filter(k => !setA.has(k))),
    removed: hitList([...setA].filter(k => !setB.has(k))),
  };
}

// ── C6 compare ────────────────────────────────────────────────────────────────

export function comparePassages(snap, barA, barB) {
  const [a, b] = [findBar(snap, barA), findBar(snap, barB)];
  const missing = [[barA, a], [barB, b]].find(([, bar]) => !bar);
  if (missing) return { error: `Bar ${missing[0]} is not in the part of the score that was shared.` };
  const [smallA, smallB] = [smallestEvent(a), smallestEvent(b)];
  const [labelA, labelB] = [smallA ? durationLabel(smallA) : null, smallB ? durationLabel(smallB) : null];
  const drumsOf = bar => new Set(hitsOf(bar).flatMap(e => e.drums));
  const [drumsA, drumsB] = [drumsOf(a), drumsOf(b)];
  return {
    bars: [barA, barB],
    similarity: round2(similarity(hitSet(a), hitSet(b))),
    ...diffHits(a, b),
    densityDelta: hitsOf(b).length - hitsOf(a).length,
    drumsAdded: [...drumsB].filter(d => !drumsA.has(d)).sort(),
    drumsRemoved: [...drumsA].filter(d => !drumsB.has(d)).sort(),
    subdivision: { a: labelA, b: labelB, changed: labelA !== labelB },
  };
}

// ── C3 patterns ───────────────────────────────────────────────────────────────

// Exact repeats: bars with identical hits (empty bars are not a pattern). Near repeats:
// Jaccard similarity of (onset, drum) hits ≥ threshold, compared between one bar from
// each group, so a groove repeated ten times does not produce forty-five pairs.
export function findPatterns(snap, { threshold = 0.75 } = {}) {
  const refused = unsupported(snap);
  if (refused) return refused;
  const groups = new Map();
  for (const bar of snap.bars) {
    const hits = hitSet(bar);
    if (hits.size === 0) continue;
    const key = [...hits].sort().join('|');
    groups.set(key, [...(groups.get(key) ?? []), bar.barNumber]);
  }
  const representatives = [...groups.values()].map(numbers => numbers[0]);
  const nearMatches = [];
  representatives.forEach((a, i) => representatives.slice(i + 1).forEach(b => {
    const comparison = comparePassages(snap, a, b);
    if (comparison.similarity >= threshold) nearMatches.push(comparison);
  }));
  return {
    threshold,
    method: 'Share of hits (beat position + drum) the two bars have in common',
    exactGroups: [...groups.values()].filter(numbers => numbers.length > 1)
      .map(barNumbers => ({ barNumbers, hits: hitSet(findBar(snap, barNumbers[0])).size })),
    nearMatches: nearMatches.sort((x, y) => y.similarity - x.similarity || x.bars[0] - y.bars[0] || x.bars[1] - y.bars[1]),
  };
}

// ── C4 possible fills ─────────────────────────────────────────────────────────

const median = values => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function fillSignals(snap, bar) {
  const neighbours = snap.bars.filter(b => b !== bar && Math.abs(b.barNumber - bar.barNumber) <= 2);
  const hits = hitsOf(bar);
  const drumHits = hits.flatMap(e => e.drums);
  const next = findBar(snap, bar.barNumber + 1);
  const nextCrash = Boolean(next?.events.some(e => e.onsetTicks === 0 && e.drums.includes('crash')));
  const hasHiHat = b => hitsOf(b).some(e => e.drums.some(d => HI_HATS.has(d) || CYMBALS.has(d)));
  const typicalHits = median(neighbours.map(b => hitsOf(b).length));
  return {
    novelty: neighbours.length ? 1 - Math.max(...neighbours.map(b => similarity(hitSet(bar), hitSet(b)))) : 0,
    tomShare: drumHits.length ? drumHits.filter(d => TOMS.has(d)).length / drumHits.length : 0,
    cymbalAfter: nextCrash,
    timekeepingDrop: !hasHiHat(bar) && neighbours.filter(hasHiHat).length > neighbours.length / 2,
    densityRise: typicalHits ? Math.max(0, Math.min(1, (hits.length - typicalHits) / typicalHits)) : 0,
    tomHits: drumHits.filter(d => TOMS.has(d)).length,
    hits: hits.length, typicalHits,
  };
}

export function findFillCandidates(snap, { threshold = 0.5 } = {}) {
  const refused = unsupported(snap);
  if (refused) return refused;
  const candidates = snap.bars.map(bar => {
    const s = fillSignals(snap, bar);
    const score = round2(0.35 * s.novelty + 0.25 * s.tomShare + 0.2 * (s.cymbalAfter ? 1 : 0) +
      0.1 * (s.timekeepingDrop ? 1 : 0) + 0.1 * s.densityRise);
    const reasons = [
      s.novelty >= 0.5 && `different from the bars around it (${Math.round(s.novelty * 100)}% new hits)`,
      s.tomHits > 0 && `${plural(s.tomHits, 'hit')} on the toms`,
      s.cymbalAfter && `crash on beat 1 of bar ${bar.barNumber + 1}`,
      s.timekeepingDrop && 'no hi-hat or ride while the bars around it keep time',
      s.densityRise > 0 && `${s.hits} hits against about ${s.typicalHits} nearby`,
    ].filter(Boolean);
    return { barNumber: bar.barNumber, score, label: 'Possible fill or transition', reasons,
      signals: { novelty: round2(s.novelty), tomShare: round2(s.tomShare), cymbalAfter: s.cymbalAfter,
        timekeepingDrop: s.timekeepingDrop, densityRise: round2(s.densityRise) } };
  }).filter(c => c.score >= threshold)
    .sort((a, b) => b.score - a.score || a.barNumber - b.barNumber);
  return { threshold, note: 'These are candidates found from the notes, not confirmed fills.', candidates };
}

// ── C5 notation complexity ────────────────────────────────────────────────────

const SUBDIVISION_LEVEL = { 6: 1, 8: 0.9, 9: 1, 12: 0.75, 16: 0.6, 18: 0.75, 24: 0.4, 32: 0.3, 36: 0.4 };

function complexitySignals(snap, bar) {
  const hits = hitsOf(bar);
  const small = smallestEvent(bar);
  const density = Math.min(1, hits.length / 16);
  const level = small ? (SUBDIVISION_LEVEL[small.durationTicks] ?? 0.2) : 0;
  // "Together" = a foot-pedal drum (kick, hi-hat pedal) sounding with any other drum.
  const together = hits.filter(e => e.drums.some(d => FOOT_DRUMS.has(d)) && e.drums.some(d => !FOOT_DRUMS.has(d)));
  const offBeat = hits.filter(e => ![0, 24].includes(e.onsetTicks % TICKS_PER_BEAT));
  const durations = new Set(bar.events.map(e => e.durationTicks));
  const drums = new Set(hits.flatMap(e => e.drums));
  let moves = 0;
  hits.forEach((e, i) => { if (i && e.drums.join() !== hits[i - 1].drums.join()) moves++; });
  return {
    values: {
      subdivisionDensity: hits.length ? (density + level) / 2 : 0,
      coordination: hits.length ? together.length / hits.length : 0,
      syncopation: hits.length ? offBeat.length / hits.length : 0,
      rhythmChanges: Math.min(1, (durations.size - 1) / 3 + (tripletGroupsIn(bar) ? 0.34 : 0)),
      drumMovement: hits.length > 1 ? (Math.min(1, (drums.size - 1) / 5) + moves / (hits.length - 1)) / 2 : 0,
      tempo: Math.max(0, Math.min(1, (snap.tempoBpm - 60) / 140)),
    },
    facts: { hits: hits.length, small, together: together.length, offBeat: offBeat.length, durations: durations.size,
      drums: drums.size, triplets: tripletGroupsIn(bar) > 0 },
  };
}

function complexityReasons({ values, facts }) {
  const reasons = [];
  if (facts.small && values.subdivisionDensity >= 0.5) reasons.push(`${plural(facts.hits, 'hit')}, down to ${durationLabel(facts.small)} notes`);
  if (facts.together) reasons.push(`kick or hi-hat pedal together with another drum on ${facts.together} of ${facts.hits} hits`);
  if (facts.offBeat) reasons.push(`${plural(facts.offBeat, 'hit')} on "e", "a" or triplet counts rather than the beat or "&"`);
  if (values.rhythmChanges >= 0.3) reasons.push(`${facts.durations} different note lengths${facts.triplets ? ', including triplets' : ''}`);
  if (facts.drums >= 4) reasons.push(`moves around ${facts.drums} different drums`);
  return reasons;
}

export function findComplexPassages(snap, { top = 3 } = {}) {
  const refused = unsupported(snap);
  if (refused) return refused;
  const ranked = snap.bars.map(bar => {
    const signals = complexitySignals(snap, bar);
    const score = Math.round(100 * Object.entries(COMPLEXITY_WEIGHTS)
      .reduce((sum, [name, weight]) => sum + weight * signals.values[name], 0));
    return {
      barNumber: bar.barNumber, score, reviewed: bar.reviewed,
      signals: Object.fromEntries(Object.entries(signals.values).map(([k, v]) => [k, round2(v)])),
      reasons: complexityReasons(signals),
    };
  }).sort((a, b) => b.score - a.score || a.barNumber - b.barNumber);

  const topBars = ranked.slice(0, top).map(b => b.barNumber).sort((a, b) => a - b);
  const passages = [];
  for (const n of topBars) {
    const last = passages.at(-1);
    if (last && last.toBar === n - 1) last.toBar = n;
    else passages.push({ fromBar: n, toBar: n });
  }
  const scoreOf = n => ranked.find(b => b.barNumber === n).score;
  return {
    note: 'Ranked by notation complexity (how busy and varied the notes are), not by how hard a particular student finds them.',
    weights: COMPLEXITY_WEIGHTS,
    ranked,
    passages: passages.map(p => {
      let best = 0;
      for (let n = p.fromBar; n <= p.toBar; n++) best = Math.max(best, scoreOf(n));
      return { ...p, score: best };
    }).sort((a, b) => b.score - a.score || a.fromBar - b.fromBar),
  };
}

// ── Practice plan ─────────────────────────────────────────────────────────────

export const MIN_PRACTICE_BPM = 40;

export function buildPracticePlan(snap, { fromBar, toBar = fromBar }) {
  const refused = unsupported(snap);
  if (refused) return refused;
  const [from, to] = [Number(fromBar), Number(toBar)].sort((a, b) => a - b);
  const { bars, missingBars } = inspectBars(snap, { fromBar: from, toBar: to });
  if (!bars?.length || missingBars.length) {
    return { error: `Bars ${from}–${to} are not in the part of the score that was shared.` };
  }
  const target = snap.tempoBpm;
  const bpm = factor => Math.max(MIN_PRACTICE_BPM, Math.min(target, Math.round(target * factor)));
  const label = from === to ? `bar ${from}` : `bars ${from}–${to}`;
  const complexity = findComplexPassages(snap, { top: snap.bars.length }).ranked
    .filter(b => b.barNumber >= from && b.barNumber <= to);
  const counting = bars.map(b => b.counting.replace(/(\d)(e|&|a|trip|let)\b/g, '$1 $2')).join(' | ');
  const clean = n => `Play it ${n} times in a row without stopping or missing a note.`;
  return {
    range: { fromBar: from, toBar: to },
    targetBpm: target,
    evidence: complexity.flatMap(b => b.reasons.map(reason => `Bar ${b.barNumber}: ${reason}`)),
    unreviewedBars: bars.filter(b => !b.reviewed).map(b => b.barNumber),
    steps: [
      { title: 'Count it', bpm: null, instruction: `Say the count for ${label} out loud: ${counting}`, successCondition: 'Count the whole passage twice without a pause.' },
      { title: 'Slow', bpm: bpm(0.6), instruction: `Play ${label} slowly with the metronome.`, successCondition: clean(3) },
      { title: 'Loop', bpm: bpm(0.8), instruction: `Loop ${label} at a medium tempo.`, successCondition: clean(4) },
      { title: 'Connect', bpm: bpm(0.8), instruction: `Add one bar before and one bar after ${label}.`, successCondition: clean(2) },
      { title: 'Full tempo', bpm: target, instruction: `Play ${label} at the score's tempo.`, successCondition: clean(3) },
    ],
  };
}
