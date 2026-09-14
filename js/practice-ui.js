// Practice and teacher view. The page gives this module a small container; all of
// the controls and styles below belong to this module.

const MODULE = 'practice-ui';
let nextId = 0;

export function formatDuration(seconds) {
  const total = Number.isFinite(Number(seconds)) ? Math.max(0, Math.floor(Number(seconds))) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${Math.floor(total / 60)}:${String(secs).padStart(2, '0')}`;
}

function rangeLabel(fromBar, toBar) {
  return fromBar === toBar ? `bar ${fromBar}` : `bars ${fromBar}–${toBar}`;
}

export function sessionRangeFor(editor) {
  const bars = Array.isArray(editor?.bars) ? editor.bars : [];
  const selection = editor?.selection;
  if (selection && bars.length) {
    const from = bars.findIndex(bar => bar?.barId === selection.fromBarId);
    const to = bars.findIndex(bar => bar?.barId === selection.toBarId);
    if (from >= 0 && to >= 0) {
      return { fromBar: Math.min(from, to) + 1, toBar: Math.max(from, to) + 1 };
    }
  }
  const cursorBar = Number.isInteger(editor?.cursor?.barIndex) ? editor.cursor.barIndex : 0;
  const bar = Math.min(Math.max(cursorBar, 0), Math.max(0, bars.length - 1)) + 1;
  return { fromBar: bar, toBar: bar };
}

// currentScoreId: rows for the open score say "This score"; others "Another score" (score ids mean nothing to a teacher).
export function dashboardRows(summary = {}, difficulty = [], currentScoreId = null) {
  const byRange = new Map();
  const add = range => {
    if (!range || typeof range !== 'object') return;
    const key = JSON.stringify([range.scoreId, range.fromBar, range.toBar]);
    byRange.set(key, { ...(byRange.get(key) || {}), ...range });
  };
  for (const range of summary?.bestCleanBpmByRange || []) add(range);
  for (const range of difficulty || []) add(range);
  return [...byRange.values()]
    .sort((a, b) => String(a.scoreId).localeCompare(String(b.scoreId)) || a.fromBar - b.fromBar || a.toBar - b.toBar)
    .map(range => ({
      scoreId: range.scoreId,
      fromBar: range.fromBar,
      toBar: range.toBar,
      label: `${range.scoreId === currentScoreId ? 'This score' : 'Another score'}, ${rangeLabel(range.fromBar, range.toBar)}`,
      bestCleanBpm: range.bestCleanBpm ?? null,
      attempts: range.attempts ?? 0,
      difficulty: range.difficulty ?? null,
      enoughData: range.enoughData === true,
      reasons: Array.isArray(range.reasons) ? [...range.reasons] : [],
    }));
}

// Returns null for a good name, or a short message for the form to show.
export function validateStudentName(name) {
  if (typeof name !== 'string') return 'Use a name from 1–60 characters.';
  const value = name.trim();
  if (value.length < 1 || Array.from(value).length > 60) return 'Use a name from 1–60 characters.';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Please do not use an email address.';
  const digits = (value.match(/\d/g) || []).length;
  if (digits >= 7 && /^[\d\s().+\-]+$/.test(value)) return 'Please do not use a phone number.';
  return null;
}

function addStyle(doc) {
  if (doc.querySelector(`style[data-module="${MODULE}"]`)) return;
  const style = doc.createElement('style');
  style.dataset.module = MODULE;
  style.textContent = `
    .practice-ui-root { box-sizing: border-box; max-width: 980px; margin: 1rem auto; padding: 1rem; color: #172033; background: #fff; font: 15px/1.45 system-ui, sans-serif; }
    .practice-ui-root *, .practice-ui-root *::before, .practice-ui-root *::after { box-sizing: border-box; }
    .practice-ui-heading { margin: 0 0 .5rem; }
    .practice-ui-status { min-height: 1.5em; margin: .35rem 0 1rem; color: #164e63; }
    .practice-ui-section { margin: 1rem 0; padding: 1rem; border: 1px solid #cbd5e1; border-radius: .6rem; background: #f8fafc; }
    .practice-ui-section h3 { margin: 0 0 .75rem; font-size: 1.1rem; }
    .practice-ui-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: .7rem; align-items: end; }
    .practice-ui-field { display: flex; flex-direction: column; gap: .25rem; }
    .practice-ui-field label, .practice-ui-label { font-weight: 650; }
    .practice-ui-field input, .practice-ui-field select { width: 100%; min-height: 2.25rem; padding: .35rem .45rem; border: 1px solid #94a3b8; border-radius: .35rem; background: #fff; color: inherit; }
    .practice-ui-field input:focus, .practice-ui-field select:focus, .practice-ui-root button:focus-visible { outline: 3px solid #7dd3fc; outline-offset: 2px; }
    .practice-ui-root button { min-height: 2.25rem; padding: .35rem .7rem; border: 1px solid #0f4c5c; border-radius: .35rem; background: #0f4c5c; color: #fff; cursor: pointer; font: inherit; }
    .practice-ui-root button:hover { background: #0b3d4a; }
    .practice-ui-root button:disabled { cursor: not-allowed; opacity: .55; }
    .practice-ui-secondary { background: #fff !important; color: #0f4c5c !important; }
    .practice-ui-danger { border-color: #991b1b !important; background: #991b1b !important; }
    .practice-ui-help { margin: .25rem 0 .7rem; color: #475569; }
    .practice-ui-check { display: flex; gap: .45rem; align-items: center; margin: .4rem 0; }
    .practice-ui-check input { width: 1.1rem; height: 1.1rem; }
    .practice-ui-actions { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-top: .7rem; }
    .practice-ui-range, .practice-ui-timer { font-size: 1.1rem; font-weight: 700; }
    .practice-ui-timer { font-variant-numeric: tabular-nums; }
    .practice-ui-list { margin: .6rem 0 0; padding-left: 1.25rem; }
    .practice-ui-list li { margin: .35rem 0; }
    .practice-ui-list button { min-height: 1.9rem; margin-left: .45rem; padding: .15rem .45rem; font-size: .9rem; }
    .practice-ui-table { width: 100%; border-collapse: collapse; margin-top: .7rem; }
    .practice-ui-table th, .practice-ui-table td { padding: .45rem; border-bottom: 1px solid #cbd5e1; text-align: left; vertical-align: top; }
    .practice-ui-table th { font-weight: 700; }
    .practice-ui-muted { color: #64748b; }
    .practice-ui-error { color: #991b1b; }
    .practice-ui-summary { white-space: pre-wrap; margin: .6rem 0 0; padding: .7rem; border: 1px solid #cbd5e1; border-radius: .35rem; background: #fff; }
    .practice-ui-export pre { max-height: 18rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: .7rem; background: #fff; border: 1px solid #cbd5e1; }
    .practice-ui-metrics { display: flex; flex-wrap: wrap; gap: .75rem 1.2rem; margin: .5rem 0; }
    .practice-ui-metric { font-weight: 650; }
    @media (max-width: 600px) { .practice-ui-root { margin: 0; padding: .7rem; } .practice-ui-table { font-size: .9rem; } }
  `;
  (doc.head || doc.documentElement).append(style);
}

function node(doc, tag, text = null, className = null) {
  const item = doc.createElement(tag);
  if (text !== null) item.textContent = text;
  if (className) item.className = className;
  return item;
}

function idFor(label) {
  nextId += 1;
  return `${MODULE}-${label}-${nextId}`;
}

function field(doc, labelText, { type = 'text', value = '', min, max, step, className = '' } = {}) {
  const wrap = node(doc, 'div', null, `practice-ui-field ${className}`.trim());
  const id = idFor(labelText.replace(/[^a-z0-9]+/gi, '-').toLowerCase());
  const label = node(doc, 'label', labelText);
  label.htmlFor = id;
  const input = doc.createElement('input');
  input.id = id;
  input.type = type;
  input.value = value;
  if (min != null) input.min = min;
  if (max != null) input.max = max;
  if (step != null) input.step = step;
  wrap.append(label, input);
  return { wrap, input };
}

function selectField(doc, labelText, options) {
  const wrap = node(doc, 'div', null, 'practice-ui-field');
  const id = idFor(labelText.replace(/[^a-z0-9]+/gi, '-').toLowerCase());
  const label = node(doc, 'label', labelText);
  label.htmlFor = id;
  const select = doc.createElement('select');
  select.id = id;
  for (const option of options) {
    const item = node(doc, 'option', option.label ?? option, 'practice-ui-option');
    if (option && typeof option === 'object' && option.value != null) item.value = option.value;
    select.append(item);
  }
  wrap.append(label, select);
  return { wrap, select };
}

function apiError(result) {
  return result && typeof result.error === 'string' ? result.error : null;
}

export function mountPractice(container, { getEditor, practice = window.practice, getPlaybackTempo = () => null }) {
  if (!container || typeof container.append !== 'function') throw new TypeError('mountPractice needs a container.');
  if (typeof getEditor !== 'function') throw new TypeError('mountPractice needs getEditor.');
  const doc = container.ownerDocument || document;
  addStyle(doc);
  const api = practice || {};
  const root = node(doc, 'section', null, 'practice-ui-root');
  const heading = node(doc, 'h2', 'Practice and teacher view', 'practice-ui-heading');
  const status = node(doc, 'p', '', 'practice-ui-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  root.append(heading, status);
  container.replaceChildren(root);

  let students = [];
  let selectedStudent = null;
  let assignments = [];
  let session = null;
  let timer = null;
  let minutesEdited = false;
  let refreshNumber = 0;

  const report = message => { status.textContent = message || ''; };
  const invoke = async (method, argument) => {
    try {
      if (typeof api[method] !== 'function') return { error: `Practice is not connected yet (${method}).` };
      return await api[method](argument);
    } catch (error) {
      return { error: error?.message || String(error) };
    }
  };

  // Student picker and the local-only profile form.
  const studentSection = node(doc, 'section', null, 'practice-ui-section');
  studentSection.append(node(doc, 'h3', 'Student'));
  const studentGrid = node(doc, 'div', null, 'practice-ui-grid');
  const studentSelectWrap = node(doc, 'div', null, 'practice-ui-field');
  const studentSelectId = idFor('student');
  const studentLabel = node(doc, 'label', 'Choose a student');
  studentLabel.htmlFor = studentSelectId;
  const studentSelect = doc.createElement('select');
  studentSelect.id = studentSelectId;
  studentSelectWrap.append(studentLabel, studentSelect);
  const addStudentButton = node(doc, 'button', 'Add student', 'practice-ui-secondary');
  addStudentButton.type = 'button';
  studentGrid.append(studentSelectWrap, addStudentButton);
  studentSection.append(studentGrid);
  const addStudentForm = node(doc, 'form', null, 'practice-ui-section');
  addStudentForm.hidden = true;
  addStudentForm.append(node(doc, 'h3', 'Add a student'));
  addStudentForm.append(node(doc, 'p', "Use a first name, nickname, or initials. Don't use full names or personal details.", 'practice-ui-help'));
  const addName = field(doc, 'Display name');
  const addLevel = selectField(doc, 'Level', [
    { label: 'Beginner' }, { label: 'Intermediate' }, { label: 'Advanced' },
  ]);
  addLevel.select.value = 'Beginner';
  const addStudentError = node(doc, 'p', '', 'practice-ui-error');
  addStudentError.setAttribute('aria-live', 'polite');
  const addActions = node(doc, 'div', null, 'practice-ui-actions');
  const addSave = node(doc, 'button', 'Save student'); addSave.type = 'submit';
  const addCancel = node(doc, 'button', 'Cancel', 'practice-ui-secondary'); addCancel.type = 'button';
  addActions.append(addSave, addCancel);
  addStudentForm.append(node(doc, 'div', null, 'practice-ui-grid'));
  addStudentForm.lastChild.append(addName.wrap, addLevel.wrap);
  addStudentForm.append(addStudentError, addActions);
  studentSection.append(addStudentForm);
  root.append(studentSection);

  // Consent panel.
  const consentSection = node(doc, 'section', null, 'practice-ui-section');
  consentSection.append(node(doc, 'h3', 'Permission for this student'));
  consentSection.append(node(doc, 'p', 'Practice notes stay on this computer. Cloud help is off unless a parent or guardian says yes. Cloud help sends small practice facts to the cloud, not the score or chat.', 'practice-ui-help'));
  const guardianLabel = node(doc, 'label', null, 'practice-ui-check');
  const guardian = doc.createElement('input'); guardian.type = 'checkbox'; guardian.id = idFor('guardian-consent');
  guardianLabel.append(guardian, node(doc, 'span', 'A parent or guardian has given permission.'));
  const cloudLabel = node(doc, 'label', null, 'practice-ui-check');
  const cloud = doc.createElement('input'); cloud.type = 'checkbox'; cloud.id = idFor('cloud-help');
  cloudLabel.append(cloud, node(doc, 'span', 'Allow cloud help for teacher summaries.'));
  const recordedBy = field(doc, 'Recorded by (teacher name)');
  const consentSave = node(doc, 'button', 'Save permission'); consentSave.type = 'button';
  consentSection.append(guardianLabel, cloudLabel, recordedBy.wrap, consentSave);
  root.append(consentSection);

  // Practice session panel.
  const sessionSection = node(doc, 'section', null, 'practice-ui-section');
  sessionSection.append(node(doc, 'h3', 'Practice session'));
  const sessionHelp = node(doc, 'p', 'Start a timer for the selected bars. If no bars are selected, the cursor bar is used.', 'practice-ui-help');
  const sessionGrid = node(doc, 'div', null, 'practice-ui-grid');
  const tempo = field(doc, 'Practice tempo (BPM)', { type: 'number', min: 1, max: 400, step: 1 });
  const sessionRange = node(doc, 'p', 'Range: not started', 'practice-ui-range');
  sessionGrid.append(tempo.wrap, sessionRange);
  const startSession = node(doc, 'button', 'Start'); startSession.type = 'button';
  const timerText = node(doc, 'p', 'Time: 0:00', 'practice-ui-timer');
  timerText.setAttribute('aria-live', 'off');
  sessionSection.append(sessionHelp, sessionGrid, startSession, timerText);
  const attemptPanel = node(doc, 'div', null, 'practice-ui-section');
  attemptPanel.hidden = true;
  attemptPanel.append(node(doc, 'h3', 'Record a try'));
  const attemptGrid = node(doc, 'div', null, 'practice-ui-grid');
  const attemptBpm = field(doc, 'BPM', { type: 'number', min: 1, max: 400, step: 1, value: 80 });
  const attemptLoops = field(doc, 'Loops', { type: 'number', min: 1, step: 1, value: 1 });
  const cleanLabel = node(doc, 'label', null, 'practice-ui-check');
  const clean = doc.createElement('input'); clean.type = 'checkbox'; clean.id = idFor('clean');
  cleanLabel.append(clean, node(doc, 'span', 'Played without mistakes?'));
  attemptGrid.append(attemptBpm.wrap, attemptLoops.wrap, cleanLabel);
  const logTry = node(doc, 'button', 'Log a try'); logTry.type = 'button';
  attemptPanel.append(attemptGrid, logTry);
  const endPanel = node(doc, 'div', null, 'practice-ui-section');
  endPanel.hidden = true;
  endPanel.append(node(doc, 'h3', 'End session'));
  const endGrid = node(doc, 'div', null, 'practice-ui-grid');
  const minutes = field(doc, 'Minutes', { type: 'number', min: 0, max: 1440, step: 0.1, value: 0 });
  const rating = selectField(doc, 'How did it feel?', [
    { label: '1 — very hard', value: '1' }, { label: '2 — hard', value: '2' }, { label: '3 — okay', value: '3' },
    { label: '4 — good', value: '4' }, { label: '5 — easy', value: '5' },
  ]);
  rating.select.value = '3';
  const completedLabel = node(doc, 'label', null, 'practice-ui-check');
  const completed = doc.createElement('input'); completed.type = 'checkbox'; completed.id = idFor('completed');
  completedLabel.append(completed, node(doc, 'span', 'Completed'));
  endGrid.append(minutes.wrap, rating.wrap, completedLabel);
  const endSession = node(doc, 'button', 'End session'); endSession.type = 'button';
  endPanel.append(endGrid, endSession);
  sessionSection.append(attemptPanel, endPanel);
  root.append(sessionSection);

  // Assignments.
  const assignmentSection = node(doc, 'section', null, 'practice-ui-section');
  assignmentSection.append(node(doc, 'h3', 'Assignments'));
  const assignmentList = node(doc, 'ul', null, 'practice-ui-list');
  assignmentSection.append(assignmentList);
  const assignmentForm = node(doc, 'form', null, 'practice-ui-section');
  assignmentForm.append(node(doc, 'h3', 'Add assignment'));
  const assignmentGrid = node(doc, 'div', null, 'practice-ui-grid');
  const assignmentTitle = field(doc, 'Title');
  const assignmentFrom = field(doc, 'First bar', { type: 'number', min: 1, step: 1, value: 1 });
  const assignmentTo = field(doc, 'Last bar', { type: 'number', min: 1, step: 1, value: 1 });
  const assignmentBpm = field(doc, 'Target BPM', { type: 'number', min: 1, max: 400, step: 1, value: 80 });
  const assignmentDue = field(doc, 'Due date', { type: 'date' });
  const assignmentGoal = field(doc, 'Practice goal');
  assignmentGrid.append(assignmentTitle.wrap, assignmentFrom.wrap, assignmentTo.wrap, assignmentBpm.wrap, assignmentDue.wrap, assignmentGoal.wrap);
  const assignmentSave = node(doc, 'button', 'Add assignment'); assignmentSave.type = 'submit';
  assignmentForm.append(assignmentGrid, assignmentSave);
  assignmentSection.append(assignmentForm);
  root.append(assignmentSection);

  // Dashboard, teacher summary, export, and deletion.
  const dashboardSection = node(doc, 'section', null, 'practice-ui-section');
  dashboardSection.append(node(doc, 'h3', 'Progress dashboard'));
  const since = field(doc, 'From date (optional)', { type: 'date' });
  dashboardSection.append(since.wrap);
  const metrics = node(doc, 'div', null, 'practice-ui-metrics');
  const dashboardTable = node(doc, 'table', null, 'practice-ui-table');
  const dashboardHead = node(doc, 'thead');
  const headRow = node(doc, 'tr');
  for (const title of ['Passage', 'Attempts', 'Best clean BPM', 'Personal difficulty']) headRow.append(node(doc, 'th', title));
  dashboardHead.append(headRow);
  const dashboardBody = node(doc, 'tbody');
  dashboardTable.append(dashboardHead, dashboardBody);
  const resetDifficulty = node(doc, 'button', 'Reset personal difficulty', 'practice-ui-secondary'); resetDifficulty.type = 'button';
  const teacherSummary = node(doc, 'button', 'Teacher summary'); teacherSummary.type = 'button';
  const summaryMode = node(doc, 'p', '', 'practice-ui-help');
  const summaryText = node(doc, 'div', '', 'practice-ui-summary');
  summaryText.hidden = true;
  const summaryCaveats = node(doc, 'ul', null, 'practice-ui-list');
  dashboardSection.append(metrics, dashboardTable, resetDifficulty, teacherSummary, summaryMode, summaryText, summaryCaveats);
  root.append(dashboardSection);

  const dataSection = node(doc, 'section', null, 'practice-ui-section');
  dataSection.append(node(doc, 'h3', 'Student data'));
  const exportStudent = node(doc, 'button', 'Show export JSON', 'practice-ui-secondary'); exportStudent.type = 'button';
  const exportDetails = node(doc, 'details', null, 'practice-ui-export');
  exportDetails.append(node(doc, 'summary', 'Exported data (nothing is downloaded)'));
  const exportPre = node(doc, 'pre');
  const copyExport = node(doc, 'button', 'Copy'); copyExport.type = 'button';
  exportDetails.append(exportPre, copyExport);
  const deleteStudent = node(doc, 'button', 'Delete student', 'practice-ui-danger'); deleteStudent.type = 'button';
  dataSection.append(exportStudent, exportDetails, deleteStudent);
  root.append(dataSection);

  function currentScoreId() {
    try { return getEditor()?.meta?.scoreId || null; } catch { return null; }
  }

  function updateStudentControls() {
    studentSelect.replaceChildren();
    if (!students.length) {
      studentSelect.append(node(doc, 'option', 'No students yet'));
      studentSelect.disabled = true;
      selectedStudent = null;
    } else {
      studentSelect.disabled = false;
      for (const student of students) {
        const option = node(doc, 'option', `${student.displayName} (${student.level})`);
        option.value = student.id;
        option.selected = student.id === selectedStudent?.id;
        studentSelect.append(option);
      }
    }
    const enabled = Boolean(selectedStudent);
    for (const control of [guardian, cloud, recordedBy.input, consentSave, startSession, assignmentSave,
      teacherSummary, exportStudent, deleteStudent, resetDifficulty]) control.disabled = !enabled;
    if (!enabled) {
      guardian.checked = false; cloud.checked = false; recordedBy.input.value = '';
      assignmentList.replaceChildren(node(doc, 'li', 'Choose a student to see assignments.', 'practice-ui-muted'));
    }
  }

  function updateConsent() {
    const consent = selectedStudent?.consent || {};
    guardian.checked = consent.guardianConsent === true;
    cloud.checked = consent.cloudHelp === true;
    recordedBy.input.value = consent.recordedBy === 'local' ? '' : (consent.recordedBy || '');
    cloud.disabled = !guardian.checked;
  }

  function updateTimer() {
    if (!session) { timerText.textContent = 'Time: 0:00'; return; }
    const elapsed = (Date.now() - session.startedMs) / 1000;
    timerText.textContent = `Time: ${formatDuration(elapsed)}`;
    if (!minutesEdited) minutes.input.value = (elapsed / 60).toFixed(1);
  }

  function updateSessionControls() {
    startSession.disabled = !selectedStudent || Boolean(session);
    attemptPanel.hidden = !session;
    endPanel.hidden = !session;
    tempo.input.disabled = Boolean(session);
    if (session) {
      sessionRange.textContent = `Working on ${rangeLabel(session.fromBar, session.toBar)}.`;
      startSession.textContent = 'Session running';
    } else {
      sessionRange.textContent = 'Range: not started';
      startSession.textContent = 'Start';
    }
  }

  function renderAssignments() {
    assignmentList.replaceChildren();
    if (!selectedStudent) {
      assignmentList.append(node(doc, 'li', 'Choose a student to see assignments.', 'practice-ui-muted'));
      return;
    }
    if (!assignments.length) {
      assignmentList.append(node(doc, 'li', 'No assignments yet.', 'practice-ui-muted'));
      return;
    }
    for (const assignment of assignments) {
      const item = node(doc, 'li');
      const due = assignment.dueDate ? `, due ${assignment.dueDate}` : '';
      item.append(node(doc, 'span', `${assignment.title}: ${rangeLabel(assignment.fromBar, assignment.toBar)} at ${assignment.targetBpm} BPM${due} — ${assignment.status === 'done' ? 'done' : 'not done'}`));
      if (assignment.status !== 'done') {
        const done = node(doc, 'button', 'Mark done', 'practice-ui-secondary'); done.type = 'button';
        done.addEventListener('click', async () => {
          const result = await invoke('completeAssignment', assignment.id);
          if (apiError(result)) { report(`Could not mark it done: ${result.error}`); return; }
          report('Assignment marked done.');
          await refreshStudent();
        });
        item.append(done);
      }
      assignmentList.append(item);
    }
  }

  function renderDashboard(summary, difficulty) {
    metrics.replaceChildren();
    const values = [
      ['Sessions', summary?.sessions ?? 0],
      ['Minutes', Number(summary?.minutes ?? 0).toFixed(1).replace(/\.0$/, '')],
      ['Attempts', summary?.attempts ?? 0],
      ['Assignments done', summary?.completedAssignments ?? 0],
    ];
    for (const [label, value] of values) {
      const metric = node(doc, 'span', null, 'practice-ui-metric');
      metric.append(node(doc, 'span', `${label}: `), node(doc, 'strong', String(value)));
      metrics.append(metric);
    }
    dashboardBody.replaceChildren();
    const rows = dashboardRows(summary, difficulty, getEditor()?.meta?.scoreId ?? null);
    if (!rows.length) {
      const row = node(doc, 'tr');
      const cell = node(doc, 'td', 'No practice data for this period.'); cell.colSpan = 4;
      row.append(cell); dashboardBody.append(row);
    }
    for (const rowData of rows) {
      const row = node(doc, 'tr');
      row.append(node(doc, 'td', rowData.label), node(doc, 'td', String(rowData.attempts)),
        node(doc, 'td', rowData.bestCleanBpm == null ? '—' : `${rowData.bestCleanBpm} BPM`));
      const difficultyCell = node(doc, 'td');
      if (!rowData.enoughData) difficultyCell.append(node(doc, 'span', 'not enough practice yet', 'practice-ui-muted'));
      else difficultyCell.append(node(doc, 'span', `${Math.round(rowData.difficulty * 100)}%`));
      row.append(difficultyCell); dashboardBody.append(row);
    }
  }

  async function refreshStudent() {
    const mine = ++refreshNumber;
    if (!selectedStudent) { assignments = []; renderAssignments(); renderDashboard({}, []); return; }
    const id = selectedStudent.id;
    const sinceValue = since.input.value || null;
    const [assignmentResult, summaryResult, difficultyResult] = await Promise.all([
      invoke('assignments', id),
      invoke('summary', { studentId: id, since: sinceValue }),
      invoke('difficulty', { studentId: id, scoreId: currentScoreId() || 'current-score' }),
    ]);
    if (mine !== refreshNumber) return;
    if (!apiError(assignmentResult)) assignments = Array.isArray(assignmentResult) ? assignmentResult : [];
    renderAssignments();
    // Show every failed request, not just the first, and still draw whatever loaded.
    const failures = [
      apiError(assignmentResult) && `Could not load assignments: ${apiError(assignmentResult)}`,
      apiError(summaryResult) && `Could not load practice history: ${apiError(summaryResult)}`,
      apiError(difficultyResult) && `Could not load the hardest bars: ${apiError(difficultyResult)}`,
    ].filter(Boolean);
    if (failures.length) report(failures.join(' '));
    renderDashboard(apiError(summaryResult) ? {} : summaryResult, apiError(difficultyResult) ? [] : difficultyResult);
  }

  async function selectStudent(id) {
    selectedStudent = students.find(student => student.id === id) || null;
    updateStudentControls(); updateConsent(); updateSessionControls();
    await refreshStudent();
  }

  async function loadStudents(preferredId = null) {
    const result = await invoke('students');
    if (apiError(result)) { report(`Could not load students: ${result.error}`); return; }
    students = Array.isArray(result) ? result : [];
    const id = preferredId || selectedStudent?.id || students[0]?.id;
    updateStudentControls();
    await selectStudent(id);
  }

  guardian.addEventListener('change', () => { if (!guardian.checked) cloud.checked = false; cloud.disabled = !guardian.checked; });
  cloud.addEventListener('change', () => { if (cloud.checked) guardian.checked = true; });
  consentSave.addEventListener('click', async () => {
    if (!selectedStudent) return;
    const result = await invoke('consent', {
      studentId: selectedStudent.id, guardianConsent: guardian.checked, cloudHelp: cloud.checked,
      recordedBy: recordedBy.input.value.trim() || 'local',
    });
    if (apiError(result)) { report(`Could not save permission: ${result.error}`); return; }
    selectedStudent = result; students = students.map(student => student.id === result.id ? result : student);
    updateConsent(); report('Permission saved.');
  });
  addStudentButton.addEventListener('click', () => { addStudentForm.hidden = !addStudentForm.hidden; if (!addStudentForm.hidden) addName.input.focus(); });
  addCancel.addEventListener('click', () => { addStudentForm.hidden = true; addStudentError.textContent = ''; });
  addStudentForm.addEventListener('submit', async event => {
    event.preventDefault();
    const problem = validateStudentName(addName.input.value);
    if (problem) { addStudentError.textContent = problem; return; }
    const result = await invoke('addStudent', { displayName: addName.input.value.trim(), level: addLevel.select.value.toLowerCase() });
    if (apiError(result)) { addStudentError.textContent = result.error; return; }
    addStudentForm.hidden = true; addName.input.value = ''; addStudentError.textContent = '';
    report('Student added.'); await loadStudents(result.id);
  });
  studentSelect.addEventListener('change', () => selectStudent(studentSelect.value));
  since.input.addEventListener('change', refreshStudent);

  startSession.addEventListener('click', async () => {
    if (!selectedStudent || session) return;
    let editor;
    try { editor = getEditor(); } catch (error) { report(`Could not read the score: ${error.message}`); return; }
    const scoreId = editor?.meta?.scoreId;
    if (!scoreId) { report('Save the score first, then start a practice session.'); return; }
    const range = sessionRangeFor(editor);
    const fallbackTempo = Number(getPlaybackTempo()) || Number(editor?.meta?.tempoBpm) || 90;
    const targetBpm = Number(tempo.input.value) || fallbackTempo;
    const result = await invoke('startSession', { studentId: selectedStudent.id, scoreId, ...range, targetBpm });
    if (apiError(result)) { report(`Could not start the session: ${result.error}`); return; }
    session = { ...result, startedMs: Date.now() };
    minutesEdited = false; minutes.input.value = '0.0';
    updateSessionControls(); updateTimer();
    clearInterval(timer); timer = setInterval(updateTimer, 1000);
    report(`Session started for ${rangeLabel(range.fromBar, range.toBar)}.`);
  });
  minutes.input.addEventListener('input', () => { minutesEdited = true; });
  logTry.addEventListener('click', async () => {
    if (!session) return;
    const result = await invoke('logAttempt', { sessionId: session.id, bpm: Number(attemptBpm.input.value), loops: Number(attemptLoops.input.value), clean: clean.checked });
    if (apiError(result)) { report(`Could not log that try: ${result.error}`); return; }
    report('Try saved.');
  });
  endSession.addEventListener('click', async () => {
    if (!session) return;
    const result = await invoke('endSession', {
      sessionId: session.id, minutes: Number(minutes.input.value), selfRating: Number(rating.select.value), completed: completed.checked,
    });
    if (apiError(result)) { report(`Could not end the session: ${result.error}`); return; }
    clearInterval(timer); timer = null; session = null; updateSessionControls(); updateTimer();
    report('Session saved.'); await refreshStudent();
  });

  assignmentForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!selectedStudent) return;
    const scoreId = currentScoreId();
    if (!scoreId) { report('Save the score first, then add an assignment.'); return; }
    const result = await invoke('addAssignment', {
      studentId: selectedStudent.id, scoreId, title: assignmentTitle.input.value.trim(),
      fromBar: Number(assignmentFrom.input.value), toBar: Number(assignmentTo.input.value), targetBpm: Number(assignmentBpm.input.value),
      goal: assignmentGoal.input.value.trim(), dueDate: assignmentDue.input.value || null,
    });
    if (apiError(result)) { report(`Could not add the assignment: ${result.error}`); return; }
    assignmentForm.reset(); report('Assignment added.'); await refreshStudent();
  });
  resetDifficulty.addEventListener('click', async () => {
    if (!selectedStudent || !currentScoreId()) return;
    const result = await invoke('resetDifficulty', { studentId: selectedStudent.id, scoreId: currentScoreId() });
    if (apiError(result)) { report(`Could not reset difficulty: ${result.error}`); return; }
    report('Personal difficulty was reset.'); await refreshStudent();
  });
  teacherSummary.addEventListener('click', async () => {
    if (!selectedStudent) return;
    summaryMode.textContent = 'Making the teacher summary…'; summaryText.hidden = true; summaryCaveats.replaceChildren();
    const result = await invoke('teacherSummary', { studentId: selectedStudent.id, since: since.input.value || null });
    if (apiError(result)) { summaryMode.textContent = `Could not make the summary: ${result.error}`; return; }
    summaryMode.textContent = result.mode === 'cloud' ? 'Cloud summary (using approved practice facts).' : 'Offline summary (using practice facts saved on this computer).';
    summaryText.textContent = result.text || 'No summary text was returned.'; summaryText.hidden = false;
    for (const caveat of result.caveats || []) summaryCaveats.append(node(doc, 'li', `Caveat: ${caveat}`));
  });
  exportStudent.addEventListener('click', async () => {
    if (!selectedStudent) return;
    const result = await invoke('exportStudent', selectedStudent.id);
    if (apiError(result)) { report(`Could not export student data: ${result.error}`); return; }
    exportPre.textContent = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    exportDetails.open = true; report('Student data is shown below. Nothing was downloaded.');
  });
  copyExport.addEventListener('click', async () => {
    try { await doc.defaultView?.navigator?.clipboard?.writeText(exportPre.textContent); report('Export JSON copied.'); }
    catch { report('Copy is not available here. Select the text and copy it.'); }
  });
  deleteStudent.addEventListener('click', async () => {
    if (!selectedStudent) return;
    const id = selectedStudent.id;
    const result = await invoke('deleteStudent', id);
    if (apiError(result)) { report(`Could not delete the student: ${result.error}`); return; }
    if (result.canceled) { report('Delete canceled.'); return; }
    selectedStudent = null; report('Student data deleted from this computer.'); await loadStudents();
  });

  updateStudentControls(); updateConsent(); updateSessionControls(); renderAssignments(); renderDashboard({}, []);
  loadStudents();
  return {
    refresh: loadStudents,
    destroy() { clearInterval(timer); container.replaceChildren(); },
  };
}
