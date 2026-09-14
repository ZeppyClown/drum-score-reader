const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const {
  PracticeStore,
  StoreError,
  SCHEMA_VERSION,
  migrate,
} = require('../desktop/practice-store.cjs');

function ids() {
  let number = 0;
  return () => `00000000-0000-4000-8000-${String(++number).padStart(12, '0')}`;
}

function makeStore(now = () => '2025-01-01T00:00:00.000Z') {
  const store = new PracticeStore({ file: ':memory:', now, idFactory: ids() });
  return store;
}

function addSession(store, studentId, options = {}) {
  const session = store.startSession({
    studentId,
    scoreId: options.scoreId ?? 'score-1',
    fromBar: options.fromBar ?? 1,
    toBar: options.toBar ?? 2,
    targetBpm: options.targetBpm ?? 100,
    startedAt: options.startedAt ?? '2025-01-01T00:00:00.000Z',
  });
  for (const attempt of options.attempts ?? []) {
    store.logAttempt(session.id, { ...attempt, at: attempt.at ?? session.startedAt });
  }
  store.endSession(session.id, {
    minutes: options.minutes ?? 5,
    selfRating: options.selfRating ?? 3,
    completed: options.completed ?? false,
    endedAt: options.endedAt ?? '2025-01-01T00:05:00.000Z',
  });
  return session;
}

test('migrations are idempotent and refuse a newer version before changing the database', () => {
  const db = new DatabaseSync(':memory:');
  assert.equal(migrate(db, { now: () => '2025-01-01T00:00:00.000Z' }), SCHEMA_VERSION);
  assert.equal(migrate(db, { now: () => '2025-01-01T00:00:00.000Z' }), SCHEMA_VERSION);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 1);
  db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(SCHEMA_VERSION + 1);
  assert.throws(() => migrate(db), error => {
    assert.ok(error instanceof StoreError);
    assert.equal(error.code, 'future_version');
    assert.match(error.message, /newer|does not know|Update DrumHub/);
    return true;
  });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM students').get().count, 0);
  db.close();
});

test('validation errors are StoreErrors and consent defaults to no cloud', () => {
  const store = makeStore();
  assert.throws(() => store.addStudent({ displayName: 'A'.repeat(61), level: 'beginner' }), StoreError);
  assert.throws(() => store.addStudent({ displayName: 'A', level: 'expert' }), StoreError);
  assert.throws(() => store.addStudent({ displayName: 'A', level: 'beginner', consent: { cloudHelp: true } }), /guardianConsent/);
  const student = store.addStudent({ displayName: 'A', level: 'beginner' });
  assert.deepEqual(student.consent, {
    guardianConsent: false,
    cloudHelp: false,
    recordedAt: '2025-01-01T00:00:00.000Z',
    recordedBy: 'local',
  });
  assert.throws(() => store.startSession({ studentId: student.id, scoreId: 's', fromBar: 2, toBar: 1, targetBpm: 90 }), StoreError);
  assert.throws(() => store.endSession({ sessionId: 'missing', minutes: 1, completed: false }), StoreError);
  store.close();
});

test('foreign keys cascade every linked row when a student is deleted', () => {
  const store = makeStore();
  const student = store.addStudent({ displayName: 'Delete me', level: 'intermediate' });
  const session = store.startSession({ studentId: student.id, scoreId: 'score-1', fromBar: 1, toBar: 4, targetBpm: 120 });
  store.logAttempt(session.id, { bpm: 100, loops: 2, clean: false });
  store.endSession(session.id, { minutes: 10, selfRating: 2, completed: false });
  store.addAssignment({ studentId: student.id, scoreId: 'score-1', title: 'Practice', fromBar: 1, toBar: 4, targetBpm: 120, goal: 'Play it cleanly' });
  store.resetDifficulty(student.id, 'score-1');
  store.deleteStudent(student.id);
  for (const table of ['students', 'sessions', 'attempts', 'assignments', 'difficulty_resets']) {
    assert.equal(store.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
  }
  assert.deepEqual(store.listStudents(), []);
  store.close();
});

test('names are bound parameters and SQL-looking text is stored literally', () => {
  const store = makeStore();
  const name = "Robert'); DROP TABLE students; --";
  const student = store.addStudent({ displayName: name, level: 'beginner' });
  assert.equal(store.listStudents()[0].displayName, name);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM students').get().count, 1);
  assert.equal(store.exportStudent(student.id).student.displayName, name);
  store.close();
});

test('session summaries reconcile with rows and exclude another student', () => {
  const store = makeStore();
  const student = store.addStudent({ displayName: 'One', level: 'beginner' });
  const other = store.addStudent({ displayName: 'Other', level: 'beginner' });
  addSession(store, student.id, {
    minutes: 5,
    attempts: [{ bpm: 80, loops: 2, clean: true }, { bpm: 90, loops: 1, clean: false }],
  });
  addSession(store, student.id, {
    fromBar: 3,
    toBar: 4,
    minutes: 7,
    completed: true,
    attempts: [{ bpm: 70, loops: 3, clean: true }],
  });
  const assignment = store.addAssignment({
    studentId: student.id, scoreId: 'score-1', title: 'Range', fromBar: 1, toBar: 4,
    targetBpm: 100, goal: 'Steady and clean', dueDate: '2025-02-01',
  });
  store.completeAssignment(assignment.id);
  addSession(store, other.id, { attempts: [{ bpm: 200, loops: 1, clean: true }] });
  assert.deepEqual(store.sessionSummary(student.id, {}), {
    sessions: 2,
    minutes: 12,
    attempts: 3,
    bestCleanBpmByRange: [
      { scoreId: 'score-1', fromBar: 1, toBar: 2, bestCleanBpm: 80, attempts: 2 },
      { scoreId: 'score-1', fromBar: 3, toBar: 4, bestCleanBpm: 70, attempts: 1 },
    ],
    completedAssignments: 1,
  });
  assert.deepEqual(store.sessionSummary(student.id, { since: '2025-01-01T00:01:00.000Z' }).bestCleanBpmByRange, []);
  store.close();
});

test('personal difficulty waits for enough data and reset ignores older observations', () => {
  let now = '2025-01-01T00:00:00.000Z';
  const store = makeStore(() => now);
  const student = store.addStudent({ displayName: 'Learner', level: 'intermediate' });
  for (let i = 0; i < 2; i++) addSession(store, student.id, {
    attempts: [{ bpm: 60, loops: 2, clean: false }, { bpm: 70, loops: 2, clean: true }],
    selfRating: 2,
  });
  let difficulty = store.personalDifficulty(student.id, 'score-1');
  assert.equal(difficulty[0].enoughData, false);
  assert.equal(difficulty[0].difficulty, undefined);
  addSession(store, student.id, {
    attempts: [{ bpm: 65, loops: 2, clean: false }, { bpm: 75, loops: 2, clean: true }],
    selfRating: 2,
  });
  difficulty = store.personalDifficulty(student.id, 'score-1');
  assert.equal(difficulty[0].enoughData, true);
  assert.ok(difficulty[0].difficulty >= 0 && difficulty[0].difficulty <= 1);
  assert.ok(difficulty[0].reasons.length > 0);

  now = '2025-02-01T00:00:00.000Z';
  const reset = store.resetDifficulty(student.id, 'score-1');
  assert.equal(reset.resetAt, now);
  difficulty = store.personalDifficulty(student.id, 'score-1');
  assert.deepEqual(difficulty, []);
  for (let i = 0; i < 3; i++) addSession(store, student.id, {
    startedAt: `2025-02-02T00:0${i}:00.000Z`,
    endedAt: `2025-02-02T00:0${i}:05.000Z`,
    attempts: [{ bpm: 90, loops: 2, clean: true }, { bpm: 95, loops: 2, clean: true }],
    selfRating: 4,
  });
  difficulty = store.personalDifficulty(student.id, 'score-1');
  assert.equal(difficulty.length, 1);
  assert.equal(difficulty[0].sessions, 3);
  assert.equal(difficulty[0].attempts, 6);
  assert.equal(difficulty[0].enoughData, true);
  store.close();
});

test('exportStudent contains all and only that student’s rows', () => {
  const store = makeStore();
  const student = store.addStudent({ displayName: 'Export me', level: 'advanced' });
  const other = store.addStudent({ displayName: 'Do not export', level: 'beginner' });
  addSession(store, student.id, { attempts: [{ bpm: 100, loops: 1, clean: true }] });
  addSession(store, other.id, { attempts: [{ bpm: 200, loops: 1, clean: true }] });
  store.addAssignment({ studentId: student.id, scoreId: 'score-1', title: 'A', fromBar: 1, toBar: 1, targetBpm: 100, goal: 'A goal' });
  store.addAssignment({ studentId: other.id, scoreId: 'score-2', title: 'B', fromBar: 1, toBar: 1, targetBpm: 100, goal: 'B goal' });
  store.resetDifficulty(student.id, 'score-1');
  const exported = store.exportStudent(student.id);
  assert.equal(exported.student.id, student.id);
  assert.equal(exported.sessions.length, 1);
  assert.equal(exported.attempts.length, 1);
  assert.equal(exported.assignments.length, 1);
  assert.equal(exported.difficultyResets.length, 1);
  const text = JSON.stringify(exported);
  assert.doesNotMatch(text, /Do not export|score-2|B goal/);
  store.close();
});

test('blank names are refused; completed assignments respect "since"; old practice fades instead of looking harder', () => {
  let clock = '2025-01-01T00:00:00.000Z';
  const store = new PracticeStore({ file: ':memory:', now: () => clock, idFactory: ids() });
  assert.throws(() => store.addStudent({ displayName: '   ', level: 'beginner' }), StoreError);
  const student = store.addStudent({ displayName: 'Kai', level: 'beginner' });
  const early = store.addAssignment({ studentId: student.id, scoreId: 'score-1', title: 'Groove', fromBar: 1, toBar: 2, targetBpm: 90, goal: 'Clean at 90' });
  store.completeAssignment(early.id);
  clock = '2025-03-01T00:00:00.000Z';
  const late = store.addAssignment({ studentId: student.id, scoreId: 'score-1', title: 'Fill', fromBar: 3, toBar: 3, targetBpm: 90, goal: 'Clean at 90' });
  assert.equal(store.completeAssignment(late.id).completedAt, '2025-03-01T00:00:00.000Z');
  assert.equal(store.sessionSummary(student.id, { since: '2025-02-01T00:00:00.000Z' }).completedAssignments, 1);
  assert.equal(store.sessionSummary(student.id).completedAssignments, 2);

  const practise = startedAt => addSession(store, student.id, { startedAt, endedAt: startedAt, selfRating: 3,
    attempts: [{ bpm: 90, loops: 2, clean: true, at: startedAt }, { bpm: 95, loops: 2, clean: false, at: startedAt }] });
  ['2025-01-02T00:00:00.000Z', '2025-01-03T00:00:00.000Z', '2025-01-04T00:00:00.000Z'].forEach(practise);
  clock = '2025-01-05T00:00:00.000Z';
  const fresh = store.personalDifficulty(student.id, 'score-1')[0].difficulty;
  clock = '2025-09-01T00:00:00.000Z';
  const [aged] = store.personalDifficulty(student.id, 'score-1');
  assert.equal(aged.difficulty, fresh, 'the same attempts give the same difficulty, however old');
  assert.ok(aged.reasons.some(reason => /over a month old/.test(reason)));
  store.close();
});
