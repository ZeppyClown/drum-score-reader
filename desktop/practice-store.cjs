// Local practice history and teacher data. This module runs only in Electron main;
// the renderer never receives the database or a filesystem path.
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_VERSION = 1;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const LEVELS = new Set(['beginner', 'intermediate', 'advanced']);
const ASSIGNMENT_STATUS = new Set(['assigned', 'done']);

// Initial weights are deliberately exported so the teacher-facing explanation and
// later evaluation can name the exact deterministic policy being used. Recency is not a
// weight of its own: newer attempts and ratings count more (30-day decay), so old data
// fades instead of making a passage look harder.
const DIFFICULTY_WEIGHTS = Object.freeze({
  uncleanAttempts: 0.40,
  tempoGap: 0.35,
  selfRating: 0.25,
});

class StoreError extends Error {
  constructor(message, code = 'invalid_input') {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

const fail = message => { throw new StoreError(message); };

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(value, label) {
  if (!isObject(value)) fail(`${label} must be an object.`);
  return value;
}

function requireId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    fail(`${label} must be a non-empty text id.`);
  }
  return value;
}

function requireText(value, label, maxLength, { empty = false } = {}) {
  if (typeof value !== 'string' || (!empty && value.trim().length === 0) || Array.from(value).length > maxLength) {
    fail(`${label} must be ${empty ? `at most ${maxLength}` : `1–${maxLength}`} characters.`);
  }
  return value;
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') fail(`${label} must be true or false.`);
  return value;
}

function requireInteger(value, label, min, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

function requireNumber(value, label, min, max = Number.MAX_VALUE) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${label} must be a number from ${min} to ${max}.`);
  }
  return value;
}

function requireTimestamp(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    fail(`${label} must be an ISO timestamp.`);
  }
  return value;
}

function optionalTimestamp(value, label) {
  return value == null ? null : requireTimestamp(value, label);
}

function requireDate(value, label) {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) || Number.isNaN(Date.parse(value))) {
    fail(`${label} must be an ISO date.`);
  }
  return value;
}

function requireLevel(value) {
  if (typeof value !== 'string' || !LEVELS.has(value)) {
    fail('level must be beginner, intermediate, or advanced.');
  }
  return value;
}

function timestampFrom(now, label = 'timestamp') {
  const value = now();
  return requireTimestamp(value, label);
}

function parseConsent(value, now, current = null) {
  if (value != null) requireObject(value, 'consent');
  const source = value || {};
  const guardianConsent = source.guardianConsent ?? current?.guardianConsent ?? false;
  let cloudHelp = source.cloudHelp ?? current?.cloudHelp ?? false;
  requireBoolean(guardianConsent, 'guardianConsent');
  requireBoolean(cloudHelp, 'cloudHelp');
  if (cloudHelp && !guardianConsent) {
    fail('cloudHelp requires guardianConsent.');
  }
  if (!guardianConsent) cloudHelp = false;
  const recordedAt = source.recordedAt == null
    ? timestampFrom(now, 'consent recordedAt')
    : requireTimestamp(source.recordedAt, 'consent recordedAt');
  const recordedBy = source.recordedBy == null
    ? 'local'
    : requireText(source.recordedBy, 'consent recordedBy', 120);
  return { guardianConsent, cloudHelp, recordedAt, recordedBy };
}

function readConsent(json) {
  try { return JSON.parse(json); }
  catch { throw new StoreError('The stored consent record is not valid JSON.', 'corrupt_data'); }
}

function bool(value) { return value === 1 || value === true; }

function studentRow(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    level: row.level,
    createdAt: row.created_at,
    consent: readConsent(row.consent_json),
  };
}

function sessionRow(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    scoreId: row.score_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    minutes: row.minutes,
    fromBar: row.from_bar,
    toBar: row.to_bar,
    targetBpm: row.target_bpm,
    selfRating: row.self_rating,
    completed: bool(row.completed),
  };
}

function attemptRow(row) {
  return { id: row.id, sessionId: row.session_id, at: row.at, bpm: row.bpm, loops: row.loops, clean: bool(row.clean) };
}

function assignmentRow(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    scoreId: row.score_id,
    title: row.title,
    fromBar: row.from_bar,
    toBar: row.to_bar,
    targetBpm: row.target_bpm,
    goal: row.goal,
    dueDate: row.due_date,
    createdAt: row.created_at,
    status: row.status,
    completedAt: row.completed_at ?? null,
  };
}

function resetRow(row) {
  return { studentId: row.student_id, scoreId: row.score_id, resetAt: row.reset_at };
}

function getKnownVersion(db) {
  const table = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  ).get();
  if (!table) return 0;
  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get();
  const version = Number(row.version);
  if (!Number.isInteger(version) || version < 0) {
    throw new StoreError('The practice database has an invalid schema version.', 'invalid_schema');
  }
  return version;
}

const MIGRATIONS = Object.freeze([
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS students (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 60),
        level TEXT NOT NULL CHECK(level IN ('beginner', 'intermediate', 'advanced')),
        created_at TEXT NOT NULL,
        consent_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        score_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        minutes REAL,
        from_bar INTEGER NOT NULL CHECK(from_bar >= 1),
        to_bar INTEGER NOT NULL CHECK(to_bar >= from_bar),
        target_bpm INTEGER NOT NULL CHECK(target_bpm BETWEEN 1 AND 400),
        self_rating INTEGER CHECK(self_rating IS NULL OR self_rating BETWEEN 1 AND 5),
        completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1))
      );
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        at TEXT NOT NULL,
        bpm INTEGER NOT NULL CHECK(bpm BETWEEN 1 AND 400),
        loops INTEGER NOT NULL CHECK(loops >= 1),
        clean INTEGER NOT NULL CHECK(clean IN (0, 1))
      );
      CREATE TABLE IF NOT EXISTS assignments (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        score_id TEXT NOT NULL,
        title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
        from_bar INTEGER NOT NULL CHECK(from_bar >= 1),
        to_bar INTEGER NOT NULL CHECK(to_bar >= from_bar),
        target_bpm INTEGER NOT NULL CHECK(target_bpm BETWEEN 1 AND 400),
        goal TEXT NOT NULL CHECK(length(goal) BETWEEN 1 AND 300),
        due_date TEXT,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('assigned', 'done')),
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS difficulty_resets (
        student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        score_id TEXT NOT NULL,
        reset_at TEXT NOT NULL,
        PRIMARY KEY(student_id, score_id)
      );
      CREATE INDEX IF NOT EXISTS sessions_student_started ON sessions(student_id, started_at);
      CREATE INDEX IF NOT EXISTS attempts_session_at ON attempts(session_id, at);
      CREATE INDEX IF NOT EXISTS assignments_student_created ON assignments(student_id, created_at);
    `,
  },
]);

// Check the migration table before changing journal mode or creating anything. This
// is important for a future database: opening it must be a read-only refusal.
function migrate(db, { now = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.exec !== 'function') {
    throw new StoreError('migrate requires a DatabaseSync database.');
  }
  const known = getKnownVersion(db);
  if (known > SCHEMA_VERSION) {
    throw new StoreError(
      `This practice database uses schema version ${known}, which this version of DrumHub does not know. Update DrumHub before opening it.`,
      'future_version',
    );
  }
  if (typeof now !== 'function') throw new StoreError('Migration clock must be a function.');

  db.exec('PRAGMA foreign_keys = ON');
  if (typeof db.location === 'function' ? db.location() !== null : true) {
    db.exec('PRAGMA journal_mode = WAL');
  }
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z')");

  const applied = new Set(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(row => Number(row.version)));
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(migration.version, requireTimestamp(now(), 'migration timestamp'));
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* preserve the migration error */ }
      throw error;
    }
  }
  return SCHEMA_VERSION;
}

function argsForEndSession(first, second) {
  if (typeof first === 'string') return { sessionId: first, ...requireObject(second, 'endSession details') };
  return requireObject(first, 'endSession details');
}

function argsForAttempt(first, second) {
  if (typeof first === 'string') return { sessionId: first, ...requireObject(second, 'attempt') };
  return requireObject(first, 'attempt');
}

function clamp(value) { return Math.max(0, Math.min(1, value)); }

class PracticeStore {
  constructor(options = {}) {
    requireObject(options, 'PracticeStore options');
    const { file = ':memory:', now = () => new Date().toISOString(), idFactory = crypto.randomUUID } = options;
    if (typeof file !== 'string' || file.length === 0) fail('file must be a database path or :memory:.');
    if (typeof now !== 'function') fail('now must be a function.');
    if (typeof idFactory !== 'function') fail('idFactory must be a function.');
    this.now = now;
    this.idFactory = idFactory;
    this.file = file;
    this.db = new DatabaseSync(file);
    try {
      migrate(this.db, { now });
    } catch (error) {
      this.db.close();
      throw error;
    }
    this.closed = false;
  }

  _open() {
    if (this.closed) throw new StoreError('The practice store is closed.', 'closed');
  }

  _id(label) {
    const value = this.idFactory();
    return requireId(value, `${label} id`);
  }

  _student(studentId) {
    const id = requireId(studentId, 'studentId');
    const row = this.db.prepare('SELECT * FROM students WHERE id = ?').get(id);
    if (!row) fail('That student does not exist.');
    return row;
  }

  addStudent(input) {
    this._open();
    const data = requireObject(input, 'student');
    const displayName = requireText(data.displayName ?? data.display_name, 'displayName', 60);
    const level = requireLevel(data.level);
    const createdAt = data.createdAt == null
      ? timestampFrom(this.now, 'createdAt')
      : requireTimestamp(data.createdAt, 'createdAt');
    const consent = parseConsent(data.consent, this.now);
    const id = this._id('student');
    this.db.prepare(
      'INSERT INTO students (id, display_name, level, created_at, consent_json) VALUES (?, ?, ?, ?, ?)',
    ).run(id, displayName, level, createdAt, JSON.stringify(consent));
    return studentRow(this.db.prepare('SELECT * FROM students WHERE id = ?').get(id));
  }

  updateStudentConsent(first, second) {
    this._open();
    let studentId;
    let consentInput;
    if (typeof first === 'string') {
      studentId = first;
      consentInput = second;
    } else {
      const data = requireObject(first, 'consent update');
      studentId = data.studentId;
      consentInput = data.consent ?? data;
    }
    const row = this._student(studentId);
    const consent = parseConsent(consentInput, this.now, readConsent(row.consent_json));
    this.db.prepare('UPDATE students SET consent_json = ? WHERE id = ?').run(JSON.stringify(consent), row.id);
    return studentRow(this.db.prepare('SELECT * FROM students WHERE id = ?').get(row.id));
  }

  listStudents() {
    this._open();
    return this.db.prepare('SELECT * FROM students ORDER BY created_at, id').all().map(studentRow);
  }

  deleteStudent(studentId) {
    this._open();
    const id = typeof studentId === 'string' ? studentId : requireObject(studentId, 'student').studentId;
    const row = this._student(id);
    this.db.prepare('DELETE FROM students WHERE id = ?').run(row.id);
    return true;
  }

  startSession(input) {
    this._open();
    const data = requireObject(input, 'session');
    const studentId = requireId(data.studentId ?? data.student_id, 'studentId');
    this._student(studentId);
    const scoreId = requireId(data.scoreId ?? data.score_id, 'scoreId');
    const fromBar = requireInteger(data.fromBar ?? data.from_bar, 'fromBar', 1);
    const toBar = requireInteger(data.toBar ?? data.to_bar, 'toBar', fromBar);
    const targetBpm = requireInteger(data.targetBpm ?? data.target_bpm, 'targetBpm', 1, 400);
    const startedAt = data.startedAt == null
      ? timestampFrom(this.now, 'startedAt')
      : requireTimestamp(data.startedAt, 'startedAt');
    const id = this._id('session');
    this.db.prepare(`
      INSERT INTO sessions (id, student_id, score_id, started_at, from_bar, to_bar, target_bpm)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, studentId, scoreId, startedAt, fromBar, toBar, targetBpm);
    return sessionRow(this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id));
  }

  logAttempt(first, second) {
    this._open();
    const data = argsForAttempt(first, second);
    const sessionId = requireId(data.sessionId ?? data.session_id, 'sessionId');
    const session = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) fail('That session does not exist.');
    if (session.ended_at != null) fail('That session has already ended.');
    const at = data.at == null ? timestampFrom(this.now, 'attempt at') : requireTimestamp(data.at, 'attempt at');
    if (Date.parse(at) < Date.parse(session.started_at)) fail('attempt at cannot be before startedAt.');
    const bpm = requireInteger(data.bpm, 'bpm', 1, 400);
    const loops = requireInteger(data.loops, 'loops', 1);
    const clean = requireBoolean(data.clean, 'clean');
    const id = this._id('attempt');
    this.db.prepare('INSERT INTO attempts (id, session_id, at, bpm, loops, clean) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, sessionId, at, bpm, loops, clean ? 1 : 0);
    return attemptRow(this.db.prepare('SELECT * FROM attempts WHERE id = ?').get(id));
  }

  endSession(first, second) {
    this._open();
    const data = argsForEndSession(first, second);
    let sessionId = data.sessionId ?? data.session_id;
    if (sessionId == null) {
      const open = this.db.prepare('SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC').all();
      if (open.length !== 1) fail('Provide sessionId when there is not exactly one open session.');
      sessionId = open[0].id;
    }
    sessionId = requireId(sessionId, 'sessionId');
    const session = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) fail('That session does not exist.');
    if (session.ended_at != null) fail('That session has already ended.');
    const minutes = requireNumber(data.minutes, 'minutes', 0, 24 * 60);
    const selfRating = data.selfRating == null ? null : requireInteger(data.selfRating, 'selfRating', 1, 5);
    const completed = requireBoolean(data.completed, 'completed');
    const endedAt = data.endedAt == null
      ? timestampFrom(this.now, 'endedAt')
      : requireTimestamp(data.endedAt, 'endedAt');
    if (Date.parse(endedAt) < Date.parse(session.started_at)) fail('endedAt cannot be before startedAt.');
    this.db.prepare(`
      UPDATE sessions
      SET ended_at = ?, minutes = ?, self_rating = ?, completed = ?
      WHERE id = ?
    `).run(endedAt, minutes, selfRating, completed ? 1 : 0, sessionId);
    return sessionRow(this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId));
  }

  addAssignment(input) {
    this._open();
    const data = requireObject(input, 'assignment');
    const studentId = requireId(data.studentId ?? data.student_id, 'studentId');
    this._student(studentId);
    const scoreId = requireId(data.scoreId ?? data.score_id, 'scoreId');
    const title = requireText(data.title, 'title', 120);
    const fromBar = requireInteger(data.fromBar ?? data.from_bar, 'fromBar', 1);
    const toBar = requireInteger(data.toBar ?? data.to_bar, 'toBar', fromBar);
    const targetBpm = requireInteger(data.targetBpm ?? data.target_bpm, 'targetBpm', 1, 400);
    const goal = requireText(data.goal, 'goal', 300);
    const dueDate = requireDate(data.dueDate ?? data.due_date, 'dueDate');
    const createdAt = data.createdAt == null
      ? timestampFrom(this.now, 'createdAt')
      : requireTimestamp(data.createdAt, 'createdAt');
    const status = data.status ?? 'assigned';
    if (typeof status !== 'string' || !ASSIGNMENT_STATUS.has(status)) fail('status must be assigned or done.');
    const id = this._id('assignment');
    this.db.prepare(`
      INSERT INTO assignments
        (id, student_id, score_id, title, from_bar, to_bar, target_bpm, goal, due_date, created_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, studentId, scoreId, title, fromBar, toBar, targetBpm, goal, dueDate, createdAt, status);
    return assignmentRow(this.db.prepare('SELECT * FROM assignments WHERE id = ?').get(id));
  }

  completeAssignment(first) {
    this._open();
    const assignmentId = typeof first === 'string' ? first : requireObject(first, 'assignment').assignmentId;
    const id = requireId(assignmentId, 'assignmentId');
    const row = this.db.prepare('SELECT * FROM assignments WHERE id = ?').get(id);
    if (!row) fail('That assignment does not exist.');
    if (row.status !== 'done') {
      this.db.prepare("UPDATE assignments SET status = 'done', completed_at = ? WHERE id = ?").run(timestampFrom(this.now, 'completedAt'), id);
    }
    return assignmentRow(this.db.prepare('SELECT * FROM assignments WHERE id = ?').get(id));
  }

  listAssignments(studentId) {
    this._open();
    const id = typeof studentId === 'string' ? studentId : requireObject(studentId, 'student').studentId;
    this._student(id);
    return this.db.prepare(`
      SELECT * FROM assignments
      WHERE student_id = ?
      ORDER BY due_date IS NULL, due_date, created_at, id
    `).all(id).map(assignmentRow);
  }

  sessionSummary(studentId, options = {}) {
    this._open();
    const { since = null } = requireObject(options, 'sessionSummary options');
    const id = requireId(studentId, 'studentId');
    this._student(id);
    const sinceValue = since == null ? null : requireTimestamp(since, 'since');
    const sessions = this.db.prepare(`
      SELECT * FROM sessions
      WHERE student_id = ? AND (? IS NULL OR started_at >= ?)
      ORDER BY started_at, id
    `).all(id, sinceValue, sinceValue);
    const attempts = this.db.prepare(`
      SELECT a.*, s.score_id, s.from_bar, s.to_bar
      FROM attempts a JOIN sessions s ON s.id = a.session_id
      WHERE s.student_id = ? AND (? IS NULL OR s.started_at >= ?)
      ORDER BY a.at, a.id
    `).all(id, sinceValue, sinceValue);
    const ranges = new Map();
    for (const session of sessions) {
      const key = JSON.stringify([session.score_id, session.from_bar, session.to_bar]);
      if (!ranges.has(key)) ranges.set(key, {
        scoreId: session.score_id, fromBar: session.from_bar, toBar: session.to_bar,
        bestCleanBpm: null, attempts: 0,
      });
    }
    for (const attempt of attempts) {
      const key = JSON.stringify([attempt.score_id, attempt.from_bar, attempt.to_bar]);
      const range = ranges.get(key);
      range.attempts++;
      if (bool(attempt.clean) && (range.bestCleanBpm == null || attempt.bpm > range.bestCleanBpm)) {
        range.bestCleanBpm = attempt.bpm;
      }
    }
    const completedAssignments = this.db.prepare(
      "SELECT COUNT(*) AS count FROM assignments WHERE student_id = ? AND status = 'done' AND (? IS NULL OR completed_at >= ?)",
    ).get(id, sinceValue, sinceValue).count;
    return {
      sessions: sessions.length,
      minutes: sessions.reduce((sum, row) => sum + (row.minutes == null ? 0 : row.minutes), 0),
      attempts: attempts.length,
      bestCleanBpmByRange: [...ranges.values()].sort((a, b) =>
        a.scoreId.localeCompare(b.scoreId) || a.fromBar - b.fromBar || a.toBar - b.toBar),
      completedAssignments: Number(completedAssignments),
    };
  }

  personalDifficulty(studentId, scoreId) {
    this._open();
    const id = requireId(studentId, 'studentId');
    this._student(id);
    const score = requireId(scoreId, 'scoreId');
    const reset = this.db.prepare(
      'SELECT reset_at FROM difficulty_resets WHERE student_id = ? AND score_id = ?',
    ).get(id, score);
    const resetAt = reset?.reset_at ?? null;
    const sessions = this.db.prepare(`
      SELECT * FROM sessions
      WHERE student_id = ? AND score_id = ? AND (? IS NULL OR started_at >= ?)
      ORDER BY started_at, id
    `).all(id, score, resetAt, resetAt);
    const attempts = this.db.prepare(`
      SELECT a.*, s.from_bar, s.to_bar, s.target_bpm, s.self_rating, s.started_at
      FROM attempts a JOIN sessions s ON s.id = a.session_id
      WHERE s.student_id = ? AND s.score_id = ?
        AND (? IS NULL OR s.started_at >= ?) AND (? IS NULL OR a.at >= ?)
      ORDER BY a.at, a.id
    `).all(id, score, resetAt, resetAt, resetAt, resetAt);
    const groups = new Map();
    const getGroup = (fromBar, toBar) => {
      const key = `${fromBar}:${toBar}`;
      if (!groups.has(key)) groups.set(key, { scoreId: score, fromBar, toBar, sessions: [], attempts: [] });
      return groups.get(key);
    };
    for (const session of sessions) getGroup(session.from_bar, session.to_bar).sessions.push(session);
    for (const attempt of attempts) getGroup(attempt.from_bar, attempt.to_bar).attempts.push(attempt);
    const nowMs = Date.parse(timestampFrom(this.now, 'difficulty timestamp'));
    return [...groups.values()].sort((a, b) => a.fromBar - b.fromBar || a.toBar - b.toBar).map(group => {
      const result = {
        scoreId: group.scoreId,
        fromBar: group.fromBar,
        toBar: group.toBar,
        sessions: group.sessions.length,
        attempts: group.attempts.length,
        enoughData: group.sessions.length >= 3 && group.attempts.length >= 6,
        reasons: [],
      };
      if (!result.enoughData) {
        result.reasons.push('Need at least 3 sessions and 6 attempts for this bar range.');
        return result;
      }
      const recency = value => clamp(Math.exp(-(Math.max(0, nowMs - Date.parse(value)) / 86_400_000) / 30));
      const weights = group.attempts.map(attempt => recency(attempt.at));
      const weightTotal = weights.reduce((sum, value) => sum + value, 0) || 1;
      const uncleanShare = group.attempts.reduce((sum, attempt, index) =>
        sum + (bool(attempt.clean) ? 0 : weights[index]), 0) / weightTotal;
      const cleanRatios = group.attempts.filter(attempt => bool(attempt.clean))
        .map(attempt => clamp(attempt.bpm / attempt.target_bpm));
      const bestCleanShare = cleanRatios.length ? Math.max(...cleanRatios) : 0;
      const rated = group.sessions.filter(session => session.self_rating != null);
      const ratingWeights = rated.map(session => recency(session.started_at));
      const ratingTotal = ratingWeights.reduce((sum, value) => sum + value, 0) || 1;
      const ratingDifficulty = rated.length
        ? clamp(rated.reduce((sum, session, index) => sum + ((5 - session.self_rating) / 4) * ratingWeights[index], 0) / ratingTotal)
        : 0.5;
      const recencyScore = clamp(weights.reduce((sum, value) => sum + value, 0) / weights.length);
      const tempoGap = 1 - bestCleanShare;
      const difficulty = clamp(
        DIFFICULTY_WEIGHTS.uncleanAttempts * uncleanShare
          + DIFFICULTY_WEIGHTS.tempoGap * tempoGap
          + DIFFICULTY_WEIGHTS.selfRating * ratingDifficulty,
      );
      result.difficulty = Number(difficulty.toFixed(3));
      if (uncleanShare >= 0.5) result.reasons.push('At least half of the recent attempts were unclean.');
      else if (uncleanShare > 0) result.reasons.push('Some recorded attempts were unclean.');
      if (bestCleanShare < 0.8) result.reasons.push('The best clean BPM is below the target.');
      if (rated.length && ratingDifficulty >= 0.5) result.reasons.push('Self-ratings indicate that this range often feels difficult.');
      if (recencyScore < 0.5) result.reasons.push('Most of this practice is over a month old, so it may not match how it feels now.');
      if (result.reasons.length === 0) result.reasons.push('Recent attempts were clean and close to the target.');
      return result;
    });
  }

  resetDifficulty(studentId, scoreId) {
    this._open();
    const id = requireId(studentId, 'studentId');
    this._student(id);
    const score = requireId(scoreId, 'scoreId');
    const resetAt = timestampFrom(this.now, 'resetAt');
    this.db.prepare(`
      INSERT INTO difficulty_resets (student_id, score_id, reset_at) VALUES (?, ?, ?)
      ON CONFLICT(student_id, score_id) DO UPDATE SET reset_at = excluded.reset_at
    `).run(id, score, resetAt);
    return resetRow(this.db.prepare(
      'SELECT student_id, score_id, reset_at FROM difficulty_resets WHERE student_id = ? AND score_id = ?',
    ).get(id, score));
  }

  exportStudent(studentId) {
    this._open();
    const id = requireId(
      typeof studentId === 'string' ? studentId : requireObject(studentId, 'student').studentId,
      'studentId',
    );
    const student = this._student(id);
    const sessions = this.db.prepare('SELECT * FROM sessions WHERE student_id = ? ORDER BY started_at, id').all(id);
    const attempts = this.db.prepare(`
      SELECT a.* FROM attempts a JOIN sessions s ON s.id = a.session_id
      WHERE s.student_id = ? ORDER BY a.at, a.id
    `).all(id);
    const assignments = this.db.prepare('SELECT * FROM assignments WHERE student_id = ? ORDER BY created_at, id').all(id);
    const difficultyResets = this.db.prepare(
      'SELECT student_id, score_id, reset_at FROM difficulty_resets WHERE student_id = ? ORDER BY score_id',
    ).all(id);
    return {
      student: studentRow(student),
      sessions: sessions.map(sessionRow),
      attempts: attempts.map(attemptRow),
      assignments: assignments.map(assignmentRow),
      difficultyResets: difficultyResets.map(resetRow),
    };
  }

  close() {
    if (!this.closed) {
      this.db.close();
      this.closed = true;
    }
  }
}

module.exports = {
  PracticeStore,
  StoreError,
  SCHEMA_VERSION,
  DIFFICULTY_WEIGHTS,
  migrate,
};
