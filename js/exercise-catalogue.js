// ── Original DrumHub exercise and fill catalogue ─────────────────────────────
// These short fragments are owned by DrumHub and are written as teaching
// material, not transcriptions. Notes deliberately contain no ids: score-document
// adds fresh ids when a fragment is placed in an editor.

const n = (duration, drums = [], options = {}) => ({
  duration, dotted: options.dotted ?? false,
  ...(options.triplet ? { triplet: true } : {}),
  drums: [...drums],
});

const rest = (duration, options = {}) => n(duration, [], options);
const bar = (...notes) => ({ notes });
const eighthBar = drums => bar(...drums.map(drumsAtBeat => n('8', drumsAtBeat)));
const sixteenthBar = drums => bar(...drums.map(drumsAtBeat => n('16', drumsAtBeat)));
const tripletEighthBar = drums => bar(...drums.map(drumsAtBeat => n('8', drumsAtBeat, { triplet: true })));
const dottedEighthBar = drums => bar(...drums.flatMap(drumsAtBeat => [
  n('8', drumsAtBeat, { dotted: true }), n('16', ['hi_hat_closed']),
]));
const dottedSixteenthBar = drums => bar(...drums.flatMap(drumsAtBeat => [
  n('16', drumsAtBeat, { dotted: true }), n('32', ['hi_hat_closed']),
]));

const H = 'hi_hat_closed';
const P = 'hi_hat_pedal';
const K = 'kick';
const S = 'snare';
const T1 = 'tom_hi';
const T2 = 'tom_mid';
const F1 = 'floor_tom_1';
const F2 = 'floor_tom_2';

const source = { owner: 'DrumHub', license: 'original', reviewedByTeacher: false };

const exercise = (id, title, level, styles, subdivision, limbs, goals, tempo, bars, description, prerequisites = []) => ({
  id, kind: 'exercise', title, level, styles: [...styles], subdivision,
  limbs: [...limbs], goals: [...goals], tempo: { ...tempo },
  prerequisites: [...prerequisites], bars, description, source: { ...source },
});

// ── Exercises ────────────────────────────────────────────────────────────────

const EXERCISE_DATA = [
  exercise('steady-rock-eighths', 'Steady Rock Eighths', 'beginner', ['rock', 'pop'], '8th', ['hands', 'feet'],
    ['hi-hat control', 'backbeat', 'kick independence'], { min: 60, target: 80, max: 120 },
    [eighthBar([[K, H], [H], [S, H], [H], [K, H], [H], [S, H], [H]])],
    'Keep the hi-hat even while the kick and snare take turns.'),
  exercise('rock-quarter-pulse', 'Four Beat Pulse', 'beginner', ['rock', 'pop'], 'quarter', ['hands', 'feet'],
    ['steady time', 'backbeat', 'kick independence'], { min: 55, target: 75, max: 110 },
    [bar(n('q', [K, H]), n('q', [S, H]), n('q', [K, H]), n('q', [S, H]))],
    'Play one strong sound on each beat and make beats 2 and 4 feel clear.', ['steady-rock-eighths']),
  exercise('pop-half-time-backbeat', 'Half-Time Pop Backbeat', 'beginner', ['pop', 'rock'], '8th', ['hands', 'feet'],
    ['hi-hat control', 'backbeat', 'steady time'], { min: 55, target: 75, max: 115 },
    [eighthBar([[K, H], [H], [H], [H], [S, H], [H], [H], [H]])],
    'Let the snare wait for beat 3 while your eighth-note hi-hat keeps moving.', ['steady-rock-eighths']),
  exercise('kick-on-the-and', 'Kick on the And', 'beginner', ['rock', 'pop'], '8th', ['hands', 'feet'],
    ['kick independence', 'syncopation', 'hi-hat control'], { min: 60, target: 85, max: 125 },
    [eighthBar([[K, H], [K, H], [S, H], [H], [K, H], [K, H], [S, H], [H]])],
    'Move one kick onto the “and” without letting the hi-hat wobble.', ['steady-rock-eighths']),
  exercise('open-hat-breaths', 'Open Hat Breaths', 'beginner', ['pop', 'rock'], '8th', ['hands', 'feet'],
    ['hi-hat control', 'transitions', 'open hi-hat'], { min: 60, target: 80, max: 120 },
    [eighthBar([[K, H], [H], [S, H], ['hi_hat_open_half'], [K, H], [H], [S, H], ['hi_hat_open_half']])],
    'Open the hi-hat for a tiny lift on the last “and” of each half.', ['steady-rock-eighths']),
  exercise('rests-in-the-groove', 'Rests in the Groove', 'beginner', ['pop', 'rock'], '8th', ['hands', 'feet'],
    ['reading rests', 'hi-hat control', 'space'], { min: 50, target: 70, max: 105 },
    [eighthBar([[K, H], [], [S, H], [], [K, H], [], [S, H], []])],
    'The empty spaces are part of the beat, so keep counting while you wait.', ['steady-rock-eighths']),
  exercise('pop-backbeat-eighths', 'Pop Backbeat Eighths', 'beginner', ['pop'], '8th', ['hands', 'feet'],
    ['backbeat', 'hi-hat control', 'transitions'], { min: 60, target: 82, max: 120 },
    [eighthBar([[K, H], [H], [S, H], [H], [K, H], [H], [S, H], [H]])],
    'Make the snare backbeat bright and let every quiet hi-hat note land evenly.', ['pop-half-time-backbeat']),
  exercise('dotted-eighth-pulse', 'Dotted Eighth Pulse', 'beginner', ['pop', 'rock'], 'dotted 8th', ['hands', 'feet'],
    ['dotted rhythms', 'reading rests', 'kick independence'], { min: 55, target: 72, max: 105 },
    [dottedEighthBar([[K, H], [S, H], [K, H], [S, H]])],
    'Hold the first note a little longer, then place the small note that follows it.', ['rests-in-the-groove']),
  exercise('sixteenth-hat-grid', 'Sixteenth Hat Grid', 'intermediate', ['rock', 'pop'], '16th', ['hands', 'feet'],
    ['hi-hat control', 'kick independence', 'sixteenth notes'], { min: 60, target: 82, max: 125 },
    [sixteenthBar([[K, H], [H], [H], [H], [S, H], [H], [K, H], [H], [K, H], [H], [H], [H], [S, H], [H], [K, H], [H]])],
    'Count “1 e and a” and keep all four hi-hat spaces the same size.', ['steady-rock-eighths']),
  exercise('sixteenth-kick-steps', 'Sixteenth Kick Steps', 'intermediate', ['rock', 'funk'], '16th', ['hands', 'feet'],
    ['kick independence', 'hi-hat control', 'sixteenth notes'], { min: 55, target: 78, max: 115 },
    [sixteenthBar([[K, H], [H], [K, H], [H], [S, H], [H], [H], [K, H], [K, H], [H], [K, H], [H], [S, H], [H], [K, H], [H]])],
    'The foot takes different steps while the hands keep a steady sixteenth fence.', ['sixteenth-hat-grid']),
  exercise('snare-on-e-and-a', 'Snare on E and A', 'intermediate', ['funk', 'rock'], '16th', ['hands', 'feet'],
    ['snare displacement', 'syncopation', 'sixteenth notes'], { min: 55, target: 76, max: 112 },
    [sixteenthBar([[K, H], [H], [H], [S, H], [K, H], [H], [H], [H], [K, H], [H], [H], [S, H], [K, H], [H], [H], [H]])],
    'Place a snare on a small counting syllable, then return to the steady pulse.', ['sixteenth-hat-grid']),
  exercise('rim-click-spaces', 'Rim Click Spaces', 'intermediate', ['pop', 'latin'], '8th', ['hands', 'feet'],
    ['reading rests', 'transitions', 'backbeat'], { min: 60, target: 80, max: 118 },
    [eighthBar([[K, H], [H], ['snare_rim', H], [] , [K, H], [H], ['snare_rim', H], []])],
    'Use a light rim sound for the backbeat and leave room after it.', ['rests-in-the-groove']),
  exercise('open-and-closed-sixteenths', 'Open and Closed Sixteenths', 'intermediate', ['funk', 'pop'], '16th', ['hands', 'feet'],
    ['hi-hat control', 'transitions', 'sixteenth notes'], { min: 55, target: 75, max: 110 },
    [sixteenthBar([[K, H], [H], [H], ['hi_hat_open_half'], [S, H], [H], [K, H], [H], [K, H], [H], [H], ['hi_hat_open_half'], [S, H], [H], [K, H], [H]])],
    'Open the hat at a planned spot and close it again without rushing.', ['sixteenth-hat-grid']),
  exercise('sixteenth-rest-grid', 'Sixteenth Rest Grid', 'intermediate', ['funk', 'rock'], '16th', ['hands', 'feet'],
    ['reading rests', 'kick independence', 'sixteenth notes'], { min: 50, target: 70, max: 105 },
    [sixteenthBar([[K, H], [], [H], [], [S, H], [H], [], [H], [K, H], [], [H], [], [S, H], [H], [], [H]])],
    'Say every small count, even when the note is silent.', ['sixteenth-hat-grid', 'rests-in-the-groove']),
  exercise('funk-pocket-sixteenths', 'Funk Pocket Sixteenths', 'intermediate', ['funk'], '16th', ['hands', 'feet'],
    ['syncopation', 'kick independence', 'hi-hat control'], { min: 55, target: 78, max: 115 },
    [sixteenthBar([[K, H], [H], [H], [K, H], [S, H], [H], [K, H], [H], [K, H], [H], [H], [K, H], [S, H], [H], [K, H], [H]])],
    'Keep the pocket relaxed while the kick visits a few unexpected counts.', ['sixteenth-kick-steps']),
  exercise('straight-triplet-rock', 'Straight Triplet Rock', 'beginner', ['rock', 'shuffle'], 'triplet 8th', ['hands', 'feet'],
    ['triplets', 'steady time', 'kick independence'], { min: 55, target: 72, max: 105 },
    [tripletEighthBar([[K, H], [H], [H], [S, H], [H], [H], [K, H], [H], [H], [S, H], [H], [H]])],
    'Count “1-trip-let” and let the three notes share each beat evenly.', ['steady-rock-eighths']),
  exercise('triplet-kick-conversation', 'Triplet Kick Conversation', 'intermediate', ['shuffle', 'rock'], 'triplet 8th', ['hands', 'feet'],
    ['triplets', 'kick independence', 'coordination'], { min: 50, target: 68, max: 100 },
    [tripletEighthBar([[K, H], [H], [K, H], [S, H], [H], [H], [K, H], [K, H], [H], [S, H], [H], [K, H]])],
    'Answer each snare phrase with a kick while the triplet hi-hat keeps talking.', ['straight-triplet-rock']),
  exercise('shuffle-rest-answers', 'Shuffle Rest Answers', 'intermediate', ['shuffle', 'blues'], 'triplet 8th', ['hands', 'feet'],
    ['triplets', 'reading rests', 'transitions'], { min: 50, target: 66, max: 98 },
    [tripletEighthBar([[K, H], [], [H], [S, H], [], [H], [K, H], [], [H], [S, H], [], [H]])],
    'Keep the three-part shuffle count going through each little silence.', ['straight-triplet-rock', 'rests-in-the-groove']),
  exercise('triplet-snare-shift', 'Triplet Snare Shift', 'intermediate', ['shuffle', 'funk'], 'triplet 8th', ['hands', 'feet'],
    ['triplets', 'snare displacement', 'syncopation'], { min: 50, target: 68, max: 100 },
    [tripletEighthBar([[K, H], [S, H], [H], [K, H], [H], [S, H], [K, H], [S, H], [H], [K, H], [H], [S, H]])],
    'Move the snare around the triplet without losing the beat underneath it.', ['triplet-kick-conversation']),
  exercise('latin-foot-and-hand', 'Latin Foot and Hand', 'intermediate', ['latin', 'pop'], '8th', ['hands', 'feet'],
    ['kick independence', 'hi-hat control', 'latin pulse'], { min: 55, target: 74, max: 110 },
    [eighthBar([[K, H], [H], [S, H], [H], [K, H], [H], [S, H], [H]])],
    'Make the foot pattern steady and let the backbeat sit lightly on top.', ['kick-on-the-and']),
  exercise('latin-bell-sixteenths', 'Latin Bell Sixteenths', 'advanced', ['latin', 'funk'], '16th', ['hands', 'feet'],
    ['hi-hat control', 'kick independence', 'sixteenth notes'], { min: 55, target: 76, max: 112 },
    [sixteenthBar([[K, 'ride_bell'], ['ride_bell'], [H], ['ride_bell'], [S, 'ride_bell'], ['ride_bell'], [K, 'ride_bell'], ['ride_bell'], [K, 'ride_bell'], ['ride_bell'], [H], ['ride_bell'], [S, 'ride_bell'], ['ride_bell'], [K, 'ride_bell'], ['ride_bell']])],
    'Keep the bell bright and regular while the kick moves underneath it.', ['latin-foot-and-hand', 'sixteenth-hat-grid']),
  exercise('metal-double-kick-grid', 'Metal Double Kick Grid', 'advanced', ['metal', 'rock'], '16th', ['hands', 'feet'],
    ['kick independence', 'sixteenth notes', 'stamina'], { min: 70, target: 105, max: 155 },
    [sixteenthBar([[K, H], [K, H], [K, H], [K, H], [S, H], [K, H], [K, H], [K, H], [K, H], [K, H], [K, H], [K, H], [S, H], [K, H], [K, H], [K, H]])],
    'Play a strong, even stream of kicks while the hands mark the shape.', ['sixteenth-kick-steps']),
  exercise('metal-stop-start', 'Metal Stop and Start', 'advanced', ['metal', 'rock'], '16th', ['hands', 'feet'],
    ['reading rests', 'kick independence', 'transitions'], { min: 65, target: 95, max: 145 },
    [sixteenthBar([[K, H], [K, H], [], [], [S, H], [], [K, H], [], [K, H], [K, H], [], [], [S, H], [], [K, H], []])],
    'Stop together, count the space, and start the next small burst together.', ['metal-double-kick-grid', 'sixteenth-rest-grid']),
  exercise('tom-groove-movement', 'Tom Groove Movement', 'advanced', ['rock', 'latin'], '8th', ['hands', 'feet'],
    ['tom movement', 'kick independence', 'transitions'], { min: 55, target: 78, max: 115 },
    [eighthBar([[K, T1], [T1], [S, T2], [T2], [K, F1], [F1], [S, F2], [F2]])],
    'Walk the hands from high tom to low tom while the feet keep the bar steady.', ['latin-foot-and-hand']),
  exercise('dotted-sixteenth-kicks', 'Dotted Sixteenth Kicks', 'advanced', ['funk', 'metal'], 'dotted 16th', ['hands', 'feet'],
    ['dotted rhythms', 'kick independence', 'sixteenth notes'], { min: 50, target: 70, max: 105 },
    [dottedSixteenthBar([[K, H], [K, H], [S, H], [K, H], [K, H], [K, H], [S, H], [K, H]])],
    'Hold each dotted kick just a little longer, then fit the tiny hi-hat note after it.', ['metal-stop-start', 'dotted-eighth-pulse']),
  exercise('crash-downbeat-transitions', 'Crash Downbeat Transitions', 'advanced', ['rock', 'pop'], '8th', ['hands', 'feet'],
    ['transitions', 'crash control', 'kick independence'], { min: 60, target: 86, max: 125 },
    [eighthBar([['crash', K], [H], [S, H], [H], [K, H], [H], [S, H], [H]])],
    'Land the crash with the kick on beat 1, then settle into the groove.', ['tom-groove-movement', 'triplet-snare-shift']),
];

// ── Fills ─────────────────────────────────────────────────────────────────────

const fill = (id, title, level, styles, subdivision, limbs, goals, tempo, notes, description) => ({
  id, kind: 'fill', title, level, styles: [...styles], subdivision,
  limbs: [...limbs], goals: [...goals], tempo: { ...tempo }, prerequisites: [],
  bars: [bar(...notes)], description, source: { ...source },
});

const FILLS_DATA = [
  fill('fill-quarter-snare-line', 'Four Snare Steps', 'beginner', ['rock', 'pop'], 'quarter', ['hands'],
    ['transitions', 'snare fill'], { min: 60, target: 82, max: 120 }, [n('q', [S]), n('q', [S]), n('q', [S]), n('q', [S])],
    'Four simple snare hits make a clear bridge to the next bar.'),
  fill('fill-eighth-snare-roll', 'Eighth Snare Roll', 'beginner', ['rock', 'pop'], '8th', ['hands'],
    ['transitions', 'snare fill'], { min: 55, target: 78, max: 115 }, Array(8).fill(null).map(() => n('8', [S])),
    'Eight even snare notes lead smoothly into the next downbeat.'),
  fill('fill-eighth-tom-descent', 'Eighth Tom Descent', 'beginner', ['rock', 'pop'], '8th', ['hands'],
    ['transitions', 'tom movement'], { min: 55, target: 76, max: 110 }, [T1, T1, T2, T2, F1, F1, F2, F2].map(d => n('8', [d])),
    'Move down the toms one pair at a time and land on the low drum.'),
  fill('fill-eighth-tom-ascent', 'Eighth Tom Ascent', 'beginner', ['pop', 'latin'], '8th', ['hands'],
    ['transitions', 'tom movement'], { min: 55, target: 74, max: 108 }, [F2, F2, F1, F1, T2, T2, T1, T1].map(d => n('8', [d])),
    'Start low and climb back up the toms before the next bar.'),
  fill('fill-sixteenth-snare-run', 'Sixteenth Snare Run', 'intermediate', ['rock', 'pop'], '16th', ['hands'],
    ['transitions', 'snare fill', 'sixteenth notes'], { min: 60, target: 88, max: 130 }, Array(16).fill(null).map(() => n('16', [S])),
    'Count all four small notes on every beat as one smooth snare run.'),
  fill('fill-sixteenth-tom-descent', 'Sixteenth Tom Descent', 'intermediate', ['rock', 'pop'], '16th', ['hands'],
    ['transitions', 'tom movement', 'sixteenth notes'], { min: 55, target: 82, max: 120 },
    [T1, T1, T1, T1, T2, T2, T2, T2, F1, F1, F1, F1, F2, F2, F2, F2].map(d => n('16', [d])),
    'Travel down the kit in four-note groups and make the last low note strong.'),
  fill('fill-sixteenth-tom-snare', 'Sixteenth Tom and Snare', 'intermediate', ['funk', 'rock'], '16th', ['hands'],
    ['transitions', 'tom movement', 'snare fill'], { min: 55, target: 80, max: 118 },
    [T1, S, T2, S, T1, S, T2, S, F1, S, F2, S, F1, S, F2, S].map(d => n('16', [d])),
    'Alternate tom and snare sounds so the fill feels like a friendly conversation.'),
  fill('fill-kick-snare-punctuation', 'Kick and Snare Punctuation', 'intermediate', ['rock', 'pop'], '8th', ['hands', 'feet'],
    ['transitions', 'kick independence'], { min: 60, target: 84, max: 125 },
    [n('8', [K, S]), n('8', [S]), n('8', [K, S]), n('8', [S]), n('8', [K, S]), n('8', [S]), n('8', [K, S]), n('8', ['crash', K])],
    'Put the feet and hands together for a short, easy-to-hear ending.'),
  fill('fill-triplet-snare', 'Triplet Snare Turn', 'intermediate', ['shuffle', 'rock'], 'triplet 8th', ['hands'],
    ['transitions', 'triplets', 'snare fill'], { min: 50, target: 70, max: 105 },
    Array(12).fill(null).map(() => n('8', [S], { triplet: true })),
    'Use four groups of three to turn a shuffle into the next downbeat.'),
  fill('fill-triplet-tom-turn', 'Triplet Tom Turn', 'intermediate', ['shuffle', 'blues'], 'triplet 8th', ['hands'],
    ['transitions', 'triplets', 'tom movement'], { min: 48, target: 68, max: 100 },
    [T1, T1, T1, T2, T2, T2, F1, F1, F1, F2, F2, F2].map(d => n('8', [d], { triplet: true })),
    'Play each tom three times before moving to the next lower drum.'),
  fill('fill-rest-then-snare', 'Rest Then Snare', 'beginner', ['pop', 'rock'], '8th', ['hands'],
    ['transitions', 'reading rests', 'snare fill'], { min: 55, target: 74, max: 110 },
    [rest('q'), n('8', [S]), n('8', [S]), n('8', [T1]), n('8', [T2]), n('q', ['crash'])],
    'Wait for one beat, then answer with four small notes and a crash.'),
  fill('fill-dotted-snare-pair', 'Dotted Snare Pairs', 'intermediate', ['pop', 'funk'], 'dotted 8th', ['hands'],
    ['transitions', 'dotted rhythms', 'snare fill'], { min: 50, target: 70, max: 105 },
    [n('8', [S], { dotted: true }), n('16', [S]), n('8', [S], { dotted: true }), n('16', [S]), n('8', [T1], { dotted: true }), n('16', [T1]), n('8', [T2], { dotted: true }), n('16', ['crash'])],
    'Hold the first note of each pair, then place the quick note that follows.'),
  fill('fill-dotted-kick-tom', 'Dotted Kick and Tom', 'advanced', ['funk', 'rock'], 'dotted 8th', ['hands', 'feet'],
    ['transitions', 'dotted rhythms', 'kick independence', 'tom movement'], { min: 55, target: 76, max: 112 },
    [n('8', [K, T1], { dotted: true }), n('16', [S]), n('8', [K, T2], { dotted: true }), n('16', [S]), n('8', [K, F1], { dotted: true }), n('16', [S]), n('8', [K, F2], { dotted: true }), n('16', ['crash', K])],
    'Hold each kick-and-tom sound, then snap in the small snare answer.'),
  fill('fill-crash-downbeat', 'Crash Into One', 'beginner', ['rock', 'pop'], '8th', ['hands', 'feet'],
    ['transitions', 'crash control'], { min: 60, target: 80, max: 120 },
    [n('q', []), n('q', [S]), n('q', [T1]), n('q', ['crash', K])],
    'Leave space, add two simple answers, and finish with crash and kick together.'),
  fill('fill-tom-cascade-crash', 'Tom Cascade to Crash', 'intermediate', ['rock', 'pop'], '16th', ['hands', 'feet'],
    ['transitions', 'tom movement', 'crash control'], { min: 55, target: 82, max: 120 },
    [T1, T1, T2, T2, T1, T1, T2, T2, F1, F1, F2, F2, F1, F1, 'crash', K].map(d => n('16', Array.isArray(d) ? d : [d])),
    'Cascade through the toms and make the final crash-and-kick landing together.'),
  fill('fill-floor-tom-landing', 'Floor Tom Landing', 'intermediate', ['rock', 'latin'], '8th', ['hands', 'feet'],
    ['transitions', 'tom movement'], { min: 50, target: 72, max: 105 },
    [n('8', [T1]), n('8', [T2]), n('8', [F1]), n('8', [F2]), n('8', [T1]), n('8', [T2]), n('8', [F1]), n('8', ['crash', K])],
    'Walk down twice, then finish with the low drum and a strong crash.'),
  fill('fill-rim-tom-dialogue', 'Rim and Tom Dialogue', 'intermediate', ['latin', 'pop'], '8th', ['hands'],
    ['transitions', 'tom movement', 'snare fill'], { min: 55, target: 75, max: 110 },
    ['snare_rim', T1, 'snare_rim', T2, 'snare_rim', F1, 'snare_rim', 'crash'].map(d => n('8', [d])),
    'Alternate a rim sound with a lower tom and finish with a clean crash.'),
  fill('fill-latin-bell-turn', 'Latin Bell Turn', 'advanced', ['latin', 'funk'], '16th', ['hands', 'feet'],
    ['transitions', 'kick independence', 'sixteenth notes'], { min: 55, target: 78, max: 115 },
    ['ride_bell', 'ride_bell', K, 'ride_bell', 'ride_bell', S, 'ride_bell', K, 'ride_bell', 'ride_bell', K, 'ride_bell', S, 'ride_bell', K, ['crash', K]]
      .map(d => n('16', Array.isArray(d) ? d : [d])),
    'Keep a small bell pattern moving while the kick and snare answer it.'),
  fill('fill-metal-double-kick', 'Metal Double Kick Finish', 'advanced', ['metal', 'rock'], '16th', ['hands', 'feet'],
    ['transitions', 'kick independence', 'sixteenth notes'], { min: 70, target: 108, max: 160 },
    [K, K, K, K, S, K, K, K, K, K, K, K, S, K, K, ['crash', K]].map(d => n('16', Array.isArray(d) ? d : [d])),
    'Keep the fast kicks even and use the snare as a signpost before the crash.'),
  fill('fill-stop-start', 'Stop Start Crash', 'advanced', ['metal', 'rock'], '16th', ['hands', 'feet'],
    ['transitions', 'reading rests', 'crash control'], { min: 65, target: 95, max: 145 },
    [n('16', [K, S]), rest('16'), rest('16'), rest('16'), n('16', [T1]), n('16', [T2]), rest('16'), rest('16'), n('16', [F1]), n('16', [F2]), rest('16'), rest('16'), n('16', [T1]), n('16', [T2]), n('16', [F2]), n('16', ['crash', K])],
    'Play short bursts, count the stops, and land the final crash with the kick.'),
  fill('fill-dotted-sixteenth-snap', 'Dotted Sixteenth Snap', 'advanced', ['funk', 'metal'], 'dotted 16th', ['hands', 'feet'],
    ['transitions', 'dotted rhythms', 'kick independence'], { min: 50, target: 72, max: 108 },
    [n('16', [K, S], { dotted: true }), n('32', [H]), n('16', [T1], { dotted: true }), n('32', [H]), n('16', [K, T2], { dotted: true }), n('32', [H]), n('16', [F1], { dotted: true }), n('32', ['crash'])]
      .map(note => ({ ...note, drums: note.drums[0] === H ? [H] : note.drums })),
    'Hold each tiny dotted note, then snap the short note into place.'),
];

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

export const EXERCISES = freezeDeep(EXERCISE_DATA);
export const FILLS = freezeDeep(FILLS_DATA);
