// Electron wiring for local practice history and teacher summaries.
// The renderer only sees the small practice API exposed by preload; the SQLite
// store and the summary service stay in the main process.
const path = require('node:path');
const fs = require('node:fs');
const { PracticeStore } = require('./practice-store.cjs');
const { TeacherSummaries } = require('./teacher-summary.cjs');

const CHANNEL_ERROR = 'Practice data is only available in the score editor.';

function errorResult(error) {
  return { error: error instanceof Error ? error.message : String(error) };
}

// These functions deliberately take plain values and return plain values. This keeps
// the practice contract testable without Electron and makes it harder for an IPC
// handler to accidentally expose the database object.
function makeHandlers({ store, summaries, settings, confirmDelete }) {
  if (!store || typeof store.listStudents !== 'function') throw new TypeError('makeHandlers needs a practice store.');
  if (!summaries || typeof summaries.draft !== 'function') throw new TypeError('makeHandlers needs teacher summaries.');
  if (!settings || typeof settings.cloudEnabled !== 'boolean') throw new TypeError('makeHandlers needs app settings.');
  if (typeof confirmDelete !== 'function') throw new TypeError('makeHandlers needs a delete confirmation function.');

  const safe = operation => async (...args) => {
    try {
      return await operation(...args);
    } catch (error) {
      return errorResult(error);
    }
  };

  const studentId = value => (value && typeof value === 'object' ? value.studentId : value);
  const withStudentId = value => ({ ...(value || {}), studentId: studentId(value) });

  return {
    'practice:students': safe(() => store.listStudents()),
    'practice:add-student': safe(input => store.addStudent(input)),
    'practice:consent': safe(input => {
      const data = withStudentId(input);
      const { studentId: id, guardianConsent, cloudHelp, recordedBy } = data;
      return store.updateStudentConsent(id, { guardianConsent, cloudHelp, recordedBy });
    }),
    'practice:delete-student': safe(async input => {
      const id = studentId(input);
      const student = store.listStudents().find(row => row.id === id);
      if (!student) {
        // Let the store produce its normal, plain validation/not-found message.
        return store.deleteStudent(id);
      }
      const confirmation = await confirmDelete(id, student);
      const confirmed = confirmation === true || confirmation?.response === 0;
      if (!confirmed) return { canceled: true };
      store.deleteStudent(id);
      return { ok: true };
    }),
    'practice:export-student': safe(input => JSON.stringify(store.exportStudent(studentId(input)), null, 2)),
    'practice:start-session': safe(input => store.startSession(input)),
    'practice:log-attempt': safe(input => store.logAttempt(input)),
    'practice:end-session': safe(input => store.endSession(input)),
    'practice:assignments': safe(input => store.listAssignments(studentId(input))),
    'practice:add-assignment': safe(input => store.addAssignment(input)),
    'practice:complete-assignment': safe(input => store.completeAssignment(
      input && typeof input === 'object' ? input.assignmentId : input,
    )),
    'practice:summary': safe(input => {
      const data = input || {};
      return store.sessionSummary(data.studentId, { since: data.since ?? null });
    }),
    'practice:difficulty': safe(input => store.personalDifficulty(input?.studentId, input?.scoreId)),
    'practice:reset-difficulty': safe(input => store.resetDifficulty(input?.studentId, input?.scoreId)),
    'practice:teacher-summary': safe(input => {
      const data = input || {};
      return summaries.draft(store, data.studentId, { since: data.since ?? null });
    }),
  };
}

function initPractice({ trustedSender, dataDir, settings, summaries = null }) {
  if (typeof trustedSender !== 'function') throw new TypeError('initPractice needs trustedSender.');
  if (typeof dataDir !== 'string' || dataDir.length === 0) throw new TypeError('initPractice needs dataDir.');
  if (!settings || typeof settings.cloudEnabled !== 'boolean') throw new TypeError('initPractice needs app settings.');

  // Electron is loaded lazily so makeHandlers can be required by ordinary Node tests.
  const { dialog, ipcMain } = require('electron');
  fs.mkdirSync(dataDir, { recursive: true });
  const store = new PracticeStore({ file: path.join(dataDir, 'practice.sqlite') });
  const teacherSummaries = summaries || new TeacherSummaries({
    cloudAllowed: () => settings.cloudEnabled,
  });
  const confirmDelete = async (studentId, student) => {
    const result = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Delete student', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `Delete ${student?.displayName || studentId}?`,
      detail: 'This removes the student, practice sessions, attempts, assignments, and difficulty data from this computer.',
    });
    return result.response === 0;
  };
  const handlers = makeHandlers({
    store,
    summaries: teacherSummaries,
    settings,
    confirmDelete,
  });

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (event, input) => {
      if (!trustedSender(event)) return { error: CHANNEL_ERROR };
      try {
        return await handler(input);
      } catch (error) {
        return errorResult(error);
      }
    });
  }

  return { store, summaries: teacherSummaries, handlers };
}

module.exports = { initPractice, makeHandlers };
