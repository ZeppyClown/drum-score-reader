// Teacher-facing progress summaries. Facts are assembled locally from the practice
// store; Luna only drafts prose around those facts and never receives score contents,
// chat, or a student's display name.
const { OpenAiClient, modelSettings, outputText } = require('./openai-client.cjs');
const { hasHiddenCharacters } = require('../js/safe-text.js');

const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'highlights', 'nextSteps', 'caveats'],
  properties: {
    summary: { type: 'string', description: 'At most 900 characters.' },
    highlights: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'factIds'],
        properties: {
          text: { type: 'string' },
          factIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
        },
      },
    },
    nextSteps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'factIds'],
        properties: {
          text: { type: 'string' },
          factIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
        },
      },
    },
    caveats: { type: 'array', items: { type: 'string' } },
  },
};

const SUMMARY_INSTRUCTIONS = `You draft a short progress summary for a teacher of a young drummer.
Use only the supplied facts. Be friendly, factual, and useful. Do not make judgments about talent,
personality, diagnosis, motivation, or the student compared with anyone else. Cite fact IDs in every
highlight and next step. Every number in a highlight or next step must be the value of one of its
cited facts; numbers in the summary must be values of supplied facts. Do not invent a target BPM
when it is absent. Refer to the learner only as "the student". Return only the requested JSON.`;

const numberPattern = /\b\d+(?:\.\d+)?\b/g;
const judgmentPattern = /\b(?:lazy|gifted|talented|genius|stupid|idiot|adhd|autis(?:m|tic)|diagnos(?:is|ed|e)|personality|talent|behind\s+(?:other\s+)?students?|ahead\s+of\s+(?:other\s+)?students?|better\s+than|worse\s+than|compared\s+with\s+(?:other\s+)?students?|comparison\s+with\s+(?:other\s+)?students?)\b/i;

const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Every string anywhere inside a value (JSON.stringify would escape control characters).
const stringsIn = value => (typeof value === 'string' ? [value]
  : value && typeof value === 'object' ? Object.values(value).flatMap(stringsIn) : []);
const asText = value => typeof value === 'string' && value.trim().length > 0;
const numberTokens = text => String(text).match(numberPattern)?.map(Number) || [];

function studentFor(store, studentId) {
  const student = store.listStudents().find(row => row.id === studentId);
  if (!student) throw new Error('That student does not exist.');
  return student;
}

function addFact(facts, text, value) {
  facts.push({ id: `f${facts.length + 1}`, text, value });
}

function progressFacts(store, studentId, { since = null } = {}) {
  const student = studentFor(store, studentId);
  const summary = store.sessionSummary(studentId, { since });
  const assignments = store.listAssignments(studentId);
  const openAssignments = assignments.filter(assignment => assignment.status === 'assigned').map(assignment => ({
    title: assignment.title,
    fromBar: assignment.fromBar,
    toBar: assignment.toBar,
    targetBpm: assignment.targetBpm,
    dueDate: assignment.dueDate,
  }));

  const difficultyByRange = new Map();
  for (const scoreId of new Set(summary.bestCleanBpmByRange.map(range => range.scoreId))) {
    for (const range of store.personalDifficulty(studentId, scoreId)) {
      difficultyByRange.set(JSON.stringify([range.scoreId, range.fromBar, range.toBar]), range);
    }
  }

  const ranges = summary.bestCleanBpmByRange.map(range => {
    const difficulty = difficultyByRange.get(JSON.stringify([range.scoreId, range.fromBar, range.toBar]));
    const targetBpm = difficulty?.targetBpm ?? range.targetBpm;
    return {
      scoreId: range.scoreId,
      fromBar: range.fromBar,
      toBar: range.toBar,
      bestCleanBpm: range.bestCleanBpm,
      attempts: range.attempts,
      ...(targetBpm == null ? {} : { targetBpm }),
      ...(difficulty?.difficulty == null ? {} : { difficulty: difficulty.difficulty }),
      enoughData: difficulty?.enoughData ?? false,
    };
  });

  const facts = [];
  addFact(facts, 'Sessions practised', summary.sessions);
  addFact(facts, 'Attempts recorded', summary.attempts);
  addFact(facts, 'Minutes practised', summary.minutes);
  addFact(facts, 'Assignments completed', summary.completedAssignments);
  for (const assignment of openAssignments) {
    addFact(facts, `Open assignment "${assignment.title}" starts at bar`, assignment.fromBar);
    addFact(facts, `Open assignment "${assignment.title}" ends at bar`, assignment.toBar);
    addFact(facts, `Open assignment "${assignment.title}" target BPM`, assignment.targetBpm);
  }
  for (const range of ranges) {
    addFact(facts, `Score ${range.scoreId} range starts at bar`, range.fromBar);
    addFact(facts, `Score ${range.scoreId} range ends at bar`, range.toBar);
    addFact(facts, `Score ${range.scoreId} range attempts`, range.attempts);
    if (range.bestCleanBpm != null) addFact(facts, `Score ${range.scoreId} best clean BPM`, range.bestCleanBpm);
    if (range.difficulty != null) addFact(facts, `Score ${range.scoreId} difficulty`, range.difficulty);
  }

  return {
    student: { id: student.id, displayName: student.displayName, level: student.level },
    period: { since },
    sessions: summary.sessions,
    minutes: summary.minutes,
    attempts: summary.attempts,
    completedAssignments: summary.completedAssignments,
    openAssignments,
    ranges,
    facts,
  };
}

function knownSentenceWords() {
  return new Set([
    'A', 'Across', 'Aim', 'Assignments', 'Best', 'Continue', 'During', 'Each', 'Focus', 'For',
    'In', 'Keep', 'Minutes', 'Next', 'No', 'On', 'Open', 'Practice', 'Range', 'Review', 'Score',
    'Sessions', 'Start', 'The', 'This', 'Try', 'Use', 'With', 'Work', 'Practise', 'Play', 'Repeat',
  ]);
}

// The model is not given a name, but this also catches a hallucinated name in a draft:
// a capitalised word in the middle of a sentence ("Great work, Sam") that is not the
// student's own name. Capitals at the start of a sentence ("Great work") are normal.
function unexpectedName(text, displayName) {
  const allowed = new Set([...displayName.split(/\s+/).filter(Boolean), ...knownSentenceWords(), 'BPM', 'DrumHub']);
  const source = String(text);
  for (const match of source.matchAll(/\b[A-Z][a-z]{2,}\b/g)) {
    const word = match[0];
    const before = source.slice(0, match.index);
    const sentenceStart = !before.trim() || /[.!?:]\s*$|\n\s*$/.test(before);
    if (!sentenceStart && !allowed.has(word)) return word;
  }
  return null;
}

// A number followed by a unit ("90 minutes", "3 attempts", "80 BPM") or after "bar" must be
// the value of a fact about that unit, so "practised 90 minutes" can't borrow a 90 BPM target.
const UNITS = [
  { after: /^\s*(?:minutes?|mins?)\b/i, fact: /minute/i },
  { after: /^\s*sessions?\b/i, fact: /session/i },
  { after: /^\s*(?:attempts?|tries|try)\b/i, fact: /attempt/i },
  { after: /^\s*bpm\b/i, fact: /bpm/i },
  { after: /^\s*assignments?\b/i, fact: /assignment/i },
  { before: /\bbars?\s*$|\bbars?\s+\d+\s*[–-]\s*$/i, fact: /\bbar\b/i },
];

function checkTextNumbers(text, factRows, label) {
  const problems = [];
  const numeric = factRows.filter(fact => typeof fact?.value === 'number' && Number.isFinite(fact.value));
  const source = String(text);
  for (const match of source.matchAll(numberPattern)) {
    const number = Number(match[0]);
    const before = source.slice(0, match.index);
    const after = source.slice(match.index + match[0].length);
    if (/\bassignment\s*$/i.test(before)) continue;   // the "assignment 2" label from cloudFacts, not a count
    const unit = UNITS.find(u => (u.after && u.after.test(after)) || (u.before && u.before.test(before)));
    const candidates = unit ? numeric.filter(fact => unit.fact.test(String(fact.text))) : numeric;
    if (!candidates.some(fact => Object.is(Number(fact.value), number))) {
      problems.push(unit
        ? `${label} says "${(match[0] + (after.match(/^\s*\w+/)?.[0] ?? '')).trim()}", but ${number} is not a value of a permitted fact about that.`
        : `${label} contains ${number}, which is not a value of a permitted fact.`);
    }
  }
  return problems;
}

function checkSummary(draft, facts) {
  const problems = [];
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    return { summary: null, problems: ['Reply with the summary JSON object.'] };
  }
  if (!asText(draft.summary) || draft.summary.length > 900) problems.push('summary must be non-empty text of at most 900 characters.');
  if (!Array.isArray(draft.highlights)) problems.push('highlights must be a list.');
  if (!Array.isArray(draft.nextSteps)) problems.push('nextSteps must be a list.');
  if (!Array.isArray(draft.caveats) || draft.caveats.some(caveat => !asText(caveat))) problems.push('caveats must be a list of non-empty strings.');
  if (stringsIn(draft).some(hasHiddenCharacters)) {
    problems.push('Use plain text only: remove invisible characters and text-direction marks.');
  }

  const factRows = Array.isArray(facts?.facts) ? facts.facts : [];
  const factIds = new Set(factRows.map(fact => fact?.id));
  const displayName = facts?.student?.displayName || '';
  const allText = [draft.summary,
    ...(Array.isArray(draft.highlights) ? draft.highlights.map(item => item?.text) : []),
    ...(Array.isArray(draft.nextSteps) ? draft.nextSteps.map(item => item?.text) : []),
    ...(Array.isArray(draft.caveats) ? draft.caveats : [])]
    .filter(value => typeof value === 'string').join('\n');
  if (judgmentPattern.test(allText)) problems.push('Remove claims about talent, personality, diagnosis, motivation, or comparisons with other students.');
  const name = unexpectedName(allText, displayName);
  if (name) problems.push(`Do not mention the name ${name}; refer to the learner as "the student".`);

  if (typeof draft.summary === 'string') problems.push(...checkTextNumbers(draft.summary, factRows, 'summary'));

  const checkCited = (items, label) => {
    if (!Array.isArray(items)) return;
    for (const [index, item] of items.entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || !asText(item.text)) {
        problems.push(`${label} ${index + 1} must have non-empty text.`);
        continue;
      }
      const unsupported = Object.keys(item).filter(key => !['text', 'factIds'].includes(key));
      if (unsupported.length) problems.push(`${label} ${index + 1} has unsupported fields: ${unsupported.join(', ')}.`);
      if (!Array.isArray(item.factIds) || item.factIds.length < 1) {
        problems.push(`${label} ${index + 1} must cite at least one fact id.`);
        continue;
      }
      const cited = item.factIds.filter(id => factIds.has(id));
      if (cited.length !== item.factIds.length) problems.push(`${label} ${index + 1} cites a fact id that was not supplied.`);
      if (!cited.length) continue;
      problems.push(...checkTextNumbers(item.text, factRows.filter(fact => cited.includes(fact.id)), `${label} ${index + 1}`));
    }
  };
  checkCited(draft.highlights, 'highlight');
  checkCited(draft.nextSteps, 'next step');
  if (Array.isArray(draft.caveats)) {
    problems.push(...draft.caveats.flatMap((caveat, index) => checkTextNumbers(caveat, factRows, `caveat ${index + 1}`)));
  }

  const unknownTopLevel = Object.keys(draft).filter(key => !['summary', 'highlights', 'nextSteps', 'caveats'].includes(key));
  if (unknownTopLevel.length) problems.push(`Remove unsupported fields: ${unknownTopLevel.join(', ')}.`);
  return { summary: problems.length ? null : draft, problems };
}

// What the model receives: no display name, student id, assignment titles or score ids.
// Free text a teacher typed (a title like "Avery's recital piece") could hold a name, so
// assignments become "assignment 1", "assignment 2" and scores "score A", "score B".
// `labels` maps those back to the real titles for the text shown to the teacher.
function cloudFacts(facts) {
  const name = facts.student.displayName;
  const nameAnywhere = new RegExp(escapeRegExp(name), 'gi');
  const assignmentLabel = new Map(facts.openAssignments.map((a, i) => [a.title, `assignment ${i + 1}`]));
  const scoreIds = [...new Set(facts.ranges.map(r => r.scoreId))];
  const scoreLabel = new Map(scoreIds.map((id, i) => [id, `score ${String.fromCharCode(65 + (i % 26))}`]));
  const relabel = text => {
    let out = String(text);
    for (const [title, label] of assignmentLabel) out = out.split(`"${title}"`).join(label);
    for (const [id, label] of scoreLabel) out = out.split(`Score ${id}`).join(label);
    return out.replace(nameAnywhere, 'the student');
  };
  const safe = {
    student: { level: facts.student.level, displayName: 'the student' },
    period: facts.period,
    sessions: facts.sessions, minutes: facts.minutes, attempts: facts.attempts, completedAssignments: facts.completedAssignments,
    openAssignments: facts.openAssignments.map(({ title, ...rest }) => ({ label: assignmentLabel.get(title), ...rest })),
    ranges: facts.ranges.map(({ scoreId, ...rest }) => ({ score: scoreLabel.get(scoreId), ...rest })),
    facts: facts.facts.map(fact => ({ ...fact, text: relabel(fact.text) })),
  };
  const labels = [
    ...[...assignmentLabel].map(([title, label]) => [label, `"${title}"`]),
    ...[...scoreLabel].map(([, label]) => [label, 'this score']),
  ];
  return { safe, labels };
}

function offlineText(facts) {
  const name = facts.student.displayName;
  const lines = [`${name} practised ${facts.minutes} minutes across ${facts.sessions} sessions and made ${facts.attempts} attempts.`,
    `${facts.completedAssignments} assignments were completed in this period.`];
  for (const range of facts.ranges) {
    const best = range.bestCleanBpm == null ? 'no clean BPM recorded' : `${range.bestCleanBpm} BPM best clean tempo`;
    lines.push(`${range.scoreId}, bars ${range.fromBar}–${range.toBar}: ${best} across ${range.attempts} attempts.`);
  }
  for (const assignment of facts.openAssignments) {
    const due = assignment.dueDate ? `, due ${assignment.dueDate}` : '';
    lines.push(`Next assignment: ${assignment.title}, bars ${assignment.fromBar}–${assignment.toBar} at ${assignment.targetBpm} BPM${due}.`);
  }
  return lines.join(' ');
}

function renderDraft(draft, displayName, labels = []) {
  const restore = text => labels.reduce((out, [label, real]) => out.replace(new RegExp(`\\b${escapeRegExp(label)}\\b`, 'gi'), real),
    String(text)).replace(/\bthe student\b/gi, displayName);
  const sections = [restore(draft.summary)];
  if (draft.highlights.length) sections.push(`Highlights: ${draft.highlights.map(item => restore(item.text)).join(' ')}`);
  if (draft.nextSteps.length) sections.push(`Next steps: ${draft.nextSteps.map(item => restore(item.text)).join(' ')}`);
  return sections.join('\n\n');
}

class TeacherSummaries {
  constructor({ client = new OpenAiClient(), model = modelSettings().agent, cloudAllowed = () => false } = {}) {
    Object.assign(this, { client, model, cloudAllowed });
  }

  offline(facts, caveat = null) {
    const text = offlineText(facts) + (caveat ? ` Caveat: ${caveat}` : '');
    return { mode: 'offline', text, facts, ...(caveat ? { caveats: [caveat] } : {}) };
  }

  async draft(store, studentId, { since = null } = {}) {
    const facts = progressFacts(store, studentId, { since });
    const student = store.listStudents().find(row => row.id === studentId);
    const consented = Boolean(student?.consent?.guardianConsent && student?.consent?.cloudHelp);
    let allowed = false;
    try { allowed = consented && Boolean(this.cloudAllowed(student)); } catch { allowed = false; }
    if (!allowed) return this.offline(facts);

    const { safe: safeFacts, labels } = cloudFacts(facts);
    const call = async (repair = null) => this.client.createResponse({
      model: this.model,
      instructions: repair ? `${SUMMARY_INSTRUCTIONS}\nRepair the previous draft using these checks:\n- ${repair.map(problem => problem.replace(new RegExp(escapeRegExp(student.displayName), 'gi'), 'the student')).join('\n- ')}` : SUMMARY_INSTRUCTIONS,
      input: JSON.stringify(safeFacts),
      store: false,
      text: { format: { type: 'json_schema', name: 'teacher_summary', strict: true, schema: SUMMARY_SCHEMA } },
    }, { task: 'the teacher summary', setting: 'OPENAI_AGENT_MODEL' });

    try {
      let response = await call();
      let parsed;
      try { parsed = JSON.parse(outputText(response, 'the teacher summary')); }
      catch { parsed = undefined; }
      let checked = checkSummary(parsed, facts);
      let repaired = false;
      if (!checked.summary) {
        repaired = true;
        response = await call(checked.problems);
        try { parsed = JSON.parse(outputText(response, 'the teacher summary')); }
        catch { parsed = undefined; }
        checked = checkSummary(parsed, facts);
      }
      if (!checked.summary) {
        return this.offline(facts, `The cloud draft did not pass the saved-facts checks after one repair round.`);
      }
      return { mode: 'cloud', text: renderDraft(checked.summary, student.displayName, labels), facts, draft: checked.summary, repaired };
    } catch (error) {
      return this.offline(facts, `Cloud help was unavailable (${error.message}), so this summary uses saved practice facts.`);
    }
  }
}

module.exports = { SUMMARY_SCHEMA, progressFacts, checkSummary, cloudFacts, TeacherSummaries };
