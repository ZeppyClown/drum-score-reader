const test = require('node:test');
const assert = require('node:assert/strict');
const { PracticeStore } = require('../desktop/practice-store.cjs');
const { progressFacts, checkSummary, TeacherSummaries } = require('../desktop/teacher-summary.cjs');

function ids() {
  let number = 0;
  return () => `00000000-0000-4000-8000-${String(++number).padStart(12, '0')}`;
}

function makeStore() {
  return new PracticeStore({ file: ':memory:', now: () => '2025-01-10T00:00:00.000Z', idFactory: ids() });
}

function addSession(store, studentId, options = {}) {
  const startedAt = options.startedAt || '2025-01-05T00:00:00.000Z';
  const session = store.startSession({ studentId, scoreId: options.scoreId || 'score-1', fromBar: options.fromBar || 1,
    toBar: options.toBar || 2, targetBpm: options.targetBpm || 100, startedAt });
  for (const attempt of options.attempts || []) store.logAttempt(session.id, { ...attempt, at: attempt.at || startedAt });
  store.endSession(session.id, { minutes: options.minutes ?? 10, selfRating: 3, completed: Boolean(options.completed),
    endedAt: options.endedAt || '2025-01-05T00:10:00.000Z' });
  return session;
}

function message(draft) {
  return [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(draft) }] }];
}

function scripted(...outputs) {
  const requests = [];
  return {
    requests,
    async createResponse(body) {
      requests.push(JSON.parse(JSON.stringify(body)));
      const output = outputs.shift();
      if (output instanceof Error) throw output;
      return { status: 'completed', output };
    },
  };
}

function validDraft(overrides = {}) {
  return {
    summary: 'The student practised 10 minutes across 1 session.',
    highlights: [{ text: 'The student made 2 attempts.', factIds: ['f2'] }],
    nextSteps: [{ text: 'Practise for 10 minutes again.', factIds: ['f3'] }],
    caveats: [],
    ...overrides,
  };
}

test('progressFacts reconciles deterministic facts with PracticeStore rows', () => {
  const store = makeStore();
  const student = store.addStudent({ displayName: 'Avery', level: 'beginner' });
  addSession(store, student.id, { minutes: 10, attempts: [{ bpm: 90, loops: 1, clean: true }, { bpm: 95, loops: 1, clean: false }] });
  addSession(store, student.id, { fromBar: 3, toBar: 3, minutes: 5, completed: true, attempts: [{ bpm: 100, loops: 1, clean: true }] });
  const assignment = store.addAssignment({ studentId: student.id, scoreId: 'score-1', title: 'Rock Beat', fromBar: 1, toBar: 2,
    targetBpm: 100, goal: 'Play cleanly', dueDate: '2025-02-01' });
  store.completeAssignment(assignment.id);
  store.addAssignment({ studentId: student.id, scoreId: 'score-1', title: 'Fill', fromBar: 3, toBar: 4,
    targetBpm: 110, goal: 'Keep time' });

  const facts = progressFacts(store, student.id, { since: '2025-01-01T00:00:00.000Z' });
  assert.deepEqual({ sessions: facts.sessions, minutes: facts.minutes, attempts: facts.attempts, completedAssignments: facts.completedAssignments },
    { sessions: 2, minutes: 15, attempts: 3, completedAssignments: 1 });
  assert.deepEqual(facts.openAssignments, [{ title: 'Fill', fromBar: 3, toBar: 4, targetBpm: 110, dueDate: null }]);
  assert.deepEqual(facts.ranges, [
    { scoreId: 'score-1', fromBar: 1, toBar: 2, bestCleanBpm: 90, attempts: 2, enoughData: false },
    { scoreId: 'score-1', fromBar: 3, toBar: 3, bestCleanBpm: 100, attempts: 1, enoughData: false },
  ]);
  assert.deepEqual(facts.facts.slice(0, 4), [
    { id: 'f1', text: 'Sessions practised', value: 2 },
    { id: 'f2', text: 'Attempts recorded', value: 3 },
    { id: 'f3', text: 'Minutes practised', value: 15 },
    { id: 'f4', text: 'Assignments completed', value: 1 },
  ]);
  store.close();
});

test('missing consent keeps the summary offline and makes no request', async () => {
  const store = makeStore();
  const student = store.addStudent({ displayName: 'Avery', level: 'beginner' });
  const client = scripted();
  const result = await new TeacherSummaries({ client, cloudAllowed: () => true }).draft(store, student.id, {});
  assert.equal(result.mode, 'offline');
  assert.match(result.text, /Avery/);
  assert.equal(client.requests.length, 0);
  store.close();
});

test('cloud request contains facts only, no display name, chat, or score contents', async () => {
  const store = makeStore();
  const student = store.addStudent({ displayName: 'Avery', level: 'beginner', consent: { guardianConsent: true, cloudHelp: true } });
  addSession(store, student.id, { attempts: [{ bpm: 90, loops: 1, clean: true }, { bpm: 95, loops: 1, clean: true }] });
  store.addAssignment({ studentId: student.id, scoreId: 'score-1', title: 'Rock Beat', fromBar: 1, toBar: 2,
    targetBpm: 100, goal: 'Play cleanly' });
  const client = scripted(message(validDraft({ summary: 'The student practised 10 minutes.' })));
  const result = await new TeacherSummaries({ client, model: 'gpt-test', cloudAllowed: () => true }).draft(store, student.id, {});
  const bodyText = JSON.stringify(client.requests[0]);
  assert.equal(result.mode, 'cloud');
  assert.equal(bodyText.includes('Avery'), false);
  assert.equal(bodyText.includes('chat message'), false);
  assert.equal(bodyText.includes('kick'), false);
  assert.equal(client.requests[0].store, false);
  assert.equal(client.requests[0].text.format.strict, true);
  store.close();
});

test('a wrong number is rejected and a corrected draft gets one repair round', async () => {
  const store = makeStore();
  const student = store.addStudent({ displayName: 'Avery', level: 'beginner', consent: { guardianConsent: true, cloudHelp: true } });
  addSession(store, student.id, { attempts: [{ bpm: 90, loops: 1, clean: true }, { bpm: 95, loops: 1, clean: true }] });
  const client = scripted(message(validDraft({ summary: 'The student practised 42 minutes.' })), message(validDraft()));
  const result = await new TeacherSummaries({ client, cloudAllowed: () => true }).draft(store, student.id, {});
  assert.equal(result.mode, 'cloud');
  assert.equal(result.repaired, true);
  assert.equal(client.requests.length, 2);
  assert.match(client.requests[1].instructions, /not a value of a permitted fact/);
  store.close();
});

test('judgment words and missing fact ids are rejected', () => {
  const facts = { student: { displayName: 'Avery' }, facts: [{ id: 'f1', text: 'Minutes practised', value: 10 }] };
  const judgment = checkSummary(validDraft({ summary: 'The student is gifted.' }), facts);
  assert.ok(judgment.problems.some(problem => /talent|personality|diagnosis|comparisons/.test(problem)));
  const missing = checkSummary(validDraft({ highlights: [{ text: 'The student made 2 attempts.', factIds: ['missing'] }] }), facts);
  assert.ok(missing.problems.some(problem => /fact id/.test(problem)));
});

test('the student name is restored only after a checked cloud draft', async () => {
  const store = makeStore();
  const student = store.addStudent({ displayName: 'Avery', level: 'beginner', consent: { guardianConsent: true, cloudHelp: true } });
  addSession(store, student.id, { attempts: [{ bpm: 90, loops: 1, clean: true }] });
  const client = scripted(message(validDraft({ summary: 'The student practised 10 minutes.' })));
  const result = await new TeacherSummaries({ client, cloudAllowed: () => true }).draft(store, student.id, {});
  assert.match(result.text, /Avery practised 10 minutes/);
  assert.doesNotMatch(result.text, /the student/i);
  store.close();
});

test('API errors fall back to the offline template with a caveat', async () => {
  const store = makeStore();
  const student = store.addStudent({ displayName: 'Avery', level: 'beginner', consent: { guardianConsent: true, cloudHelp: true } });
  const client = scripted(new Error('API unavailable'));
  const result = await new TeacherSummaries({ client, cloudAllowed: () => true }).draft(store, student.id, {});
  assert.equal(result.mode, 'offline');
  assert.ok(result.caveats?.some(caveat => /unavailable/.test(caveat)));
  assert.match(result.text, /Caveat:/);
  store.close();
});

test('ordinary sentence capitals pass; a name mid-sentence is caught; no student id is sent', async () => {
  const { checkSummary, progressFacts, TeacherSummaries } = require('../desktop/teacher-summary.cjs');
  const { PracticeStore } = require('../desktop/practice-store.cjs');
  const store = new PracticeStore({ file: ':memory:' });
  const student = store.addStudent({ displayName: 'Kai Tan', level: 'beginner', consent: { guardianConsent: true, cloudHelp: true } });
  const facts = progressFacts(store, student.id);
  const good = { summary: 'Great start. Consistent practice will help.', highlights: [], nextSteps: [], caveats: [] };
  assert.deepEqual(checkSummary(good, facts).problems, []);
  const named = { ...good, summary: 'Great work this week, Sam.' };
  assert.match(checkSummary(named, facts).problems.join(' '), /Do not mention the name Sam/);
  let sent = '';
  const client = { configured: true, createResponse: async body => { sent = JSON.stringify(body); throw new Error('offline for test'); } };
  await new TeacherSummaries({ client, cloudAllowed: () => true }).draft(store, student.id);
  assert.ok(sent.length > 0);
  assert.equal(sent.includes(student.id), false);
  assert.equal(sent.includes('Kai'), false);
  store.close();
});
