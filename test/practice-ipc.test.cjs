const test = require('node:test');
const assert = require('node:assert/strict');
const { PracticeStore } = require('../desktop/practice-store.cjs');
const { TeacherSummaries } = require('../desktop/teacher-summary.cjs');
const { makeHandlers } = require('../desktop/practice-ipc.cjs');

function ids() {
  let number = 0;
  return () => `00000000-0000-4000-8000-${String(++number).padStart(12, '0')}`;
}

function setup(confirmDelete = async () => true) {
  const store = new PracticeStore({ file: ':memory:', now: () => '2025-01-01T00:00:00.000Z', idFactory: ids() });
  const handlers = makeHandlers({
    store,
    summaries: new TeacherSummaries({ client: { createResponse: async () => { throw new Error('should not call cloud'); } } }),
    settings: { cloudEnabled: false },
    confirmDelete,
  });
  return { store, handlers };
}

test('practice IPC handlers turn store validation errors into error results', async () => {
  const { store, handlers } = setup();
  const result = await handlers['practice:add-student']({ displayName: '', level: 'beginner' });
  assert.match(result.error, /displayName/);
  store.close();
});

test('delete student needs confirmation and returns JSON export', async () => {
  let confirmations = 0;
  const { store, handlers } = setup(async () => { confirmations += 1; return false; });
  const student = await handlers['practice:add-student']({ displayName: 'Avery', level: 'beginner' });
  const canceled = await handlers['practice:delete-student'](student.id);
  assert.deepEqual(canceled, { canceled: true });
  assert.equal(confirmations, 1);
  assert.equal((await handlers['practice:students']()).length, 1);
  const exported = await handlers['practice:export-student'](student.id);
  assert.equal(typeof exported, 'string');
  assert.equal(JSON.parse(exported).student.displayName, 'Avery');
  store.close();
});

test('teacher summary stays offline without guardian and cloud consent', async () => {
  let confirmations = 0;
  const { store, handlers } = setup(async () => { confirmations += 1; return true; });
  const student = await handlers['practice:add-student']({ displayName: 'Avery', level: 'beginner' });
  const summary = await handlers['practice:teacher-summary']({ studentId: student.id, since: null });
  assert.equal(summary.mode, 'offline');
  assert.equal(confirmations, 0);
  store.close();
});
