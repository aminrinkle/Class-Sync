document.addEventListener('DOMContentLoaded', async () => {

  const userNameEl = document.getElementById('userName');
  const logoutBtn = document.getElementById('logoutBtn');

  // ---- Confirm session, get display name ----
  try {
    const meRes = await fetch('/api/me');
    if (!meRes.ok) {
      window.location.href = 'index.html';
      return;
    }
    const me = await meRes.json();
    if (userNameEl) userNameEl.textContent = me.name;
  } catch (err) {
    window.location.href = 'index.html';
    return;
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST' });
      sessionStorage.clear();
      window.location.href = 'index.html';
    });
  }

  const ADD_NEW_VALUE = '__add_new__';

  const subjectSelect = document.getElementById('subject');
  const topicSelect = document.getElementById('topic');
  const addTopicRow = document.getElementById('addTopicRow');
  const newTopicInput = document.getElementById('newTopicInput');
  const addTopicBtn = document.getElementById('addTopicBtn');
  const marksSubjectSelect = document.getElementById('marksSubject');
  const syllabusSubjectSelect = document.getElementById('syllabusSubject');
  const dateInput = document.getElementById('lectureDate');

  if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

  // ---------------------------------------------------------------
  // Load subjects (shared across Mark Attendance / Marks / Syllabus tabs)
  // ---------------------------------------------------------------

  let subjects = [];

  async function loadSubjects() {
    const res = await fetch('/api/subjects');
    subjects = await res.json();

    [subjectSelect, marksSubjectSelect, syllabusSubjectSelect].forEach(select => {
      if (!select) return;
      select.innerHTML = '';
      subjects.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        select.appendChild(opt);
      });
    });
  }

  // ---------------------------------------------------------------
  // Load roster (real students from the database)
  // ---------------------------------------------------------------

  let students = []; // [{ student_id, roll_no, name }]

  async function loadRoster() {
    const res = await fetch('/api/roster');
    students = await res.json();
  }

  // ---------------------------------------------------------------
  // Mark Attendance tab
  // ---------------------------------------------------------------

  async function populateTopics(subjectId, selectValue) {
    if (!subjectId) return;
    const res = await fetch(`/api/topics?subject_id=${subjectId}`);
    const topics = await res.json();

    topicSelect.innerHTML = '';
    topics.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.topic_name;
      topicSelect.appendChild(opt);
    });
    const addOpt = document.createElement('option');
    addOpt.value = ADD_NEW_VALUE;
    addOpt.textContent = '+ Add new topic…';
    topicSelect.appendChild(addOpt);

    if (selectValue) topicSelect.value = selectValue;
  }

  if (subjectSelect) {
    subjectSelect.addEventListener('change', () => {
      populateTopics(subjectSelect.value);
      if (addTopicRow) addTopicRow.hidden = true;
    });
  }

  if (topicSelect && addTopicRow && newTopicInput && addTopicBtn) {
    topicSelect.addEventListener('change', () => {
      addTopicRow.hidden = topicSelect.value !== ADD_NEW_VALUE;
      if (!addTopicRow.hidden) newTopicInput.focus();
    });

    addTopicBtn.addEventListener('click', async () => {
      const value = newTopicInput.value.trim();
      if (!value) return;

      const res = await fetch('/api/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject_id: subjectSelect.value, topic_name: value }),
      });
      const created = await res.json();

      await populateTopics(subjectSelect.value, String(created.id));
      addTopicRow.hidden = true;
      newTopicInput.value = '';
    });
  }

  const listEl = document.getElementById('studentList');
  const presentCountEl = document.getElementById('presentCount');
  const absentCountEl = document.getElementById('absentCount');
  const submitBtn = document.getElementById('submitAttendance');
  const saveNote = document.getElementById('saveNote');

  const state = {}; // { [student_id]: 'present' | 'absent' }

  function renderList() {
    listEl.innerHTML = '';
    students.forEach(s => {
      state[s.student_id] = 'present'; // default everyone present
      const li = document.createElement('li');
      li.className = 'student-row';
      li.innerHTML = `
        <div class="student-info">
          <span class="student-name">${s.name}</span>
          <span class="student-roll">${s.roll_no}</span>
        </div>
        <div class="attendance-toggle">
          <button type="button" class="toggle-btn state-present" data-id="${s.student_id}" data-state="present">Present</button>
          <button type="button" class="toggle-btn state-absent" data-id="${s.student_id}" data-state="absent">Absent</button>
        </div>
      `;
      listEl.appendChild(li);
    });
    syncButtons();
  }

  function syncButtons() {
    let present = 0, absent = 0;
    students.forEach(s => {
      const val = state[s.student_id];
      if (val === 'present') present++; else absent++;
      const presentBtn = listEl.querySelector(`.toggle-btn.state-present[data-id="${s.student_id}"]`);
      const absentBtn = listEl.querySelector(`.toggle-btn.state-absent[data-id="${s.student_id}"]`);
      if (presentBtn && absentBtn) {
        presentBtn.classList.toggle('is-on', val === 'present');
        absentBtn.classList.toggle('is-on', val === 'absent');
      }
    });
    presentCountEl.textContent = present;
    absentCountEl.textContent = absent;
  }

  if (listEl) {
    listEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.toggle-btn');
      if (!btn) return;
      state[btn.dataset.id] = btn.dataset.state;
      syncButtons();
      saveNote.hidden = true;
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      if (topicSelect.value === ADD_NEW_VALUE) {
        saveNote.hidden = false;
        saveNote.textContent = 'Pick a real topic (or add one) before saving.';
        return;
      }

      const records = students.map(s => ({ student_id: s.student_id, status: state[s.student_id] }));

      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_id: subjectSelect.value,
          topic_id: topicSelect.value,
          date: dateInput.value,
          records,
        }),
      });
      const data = await res.json();

      saveNote.hidden = false;
      saveNote.textContent = data.absentees_notified
        ? `Attendance saved. Parent alerts queued for ${data.absentees_notified} absent student(s).`
        : 'Attendance saved. Nobody was absent today — no alerts to send.';
    });
  }

  // ---------------------------------------------------------------
  // Tab switching (Mark Attendance | Attendance Log | Manage Syllabus | Marks | Send Complaint)
  // ---------------------------------------------------------------

  const portalTabs = document.querySelectorAll('.portal-tab');
  const tabPanels = document.querySelectorAll('.tab-panel');

  portalTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      portalTabs.forEach(t => {
        t.classList.remove('is-active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('is-active');
      tab.setAttribute('aria-selected', 'true');

      const target = tab.dataset.tab;
      tabPanels.forEach(panel => { panel.hidden = panel.dataset.panel !== target; });

      if (target === 'log') renderLog();
      if (target === 'syllabus') renderSyllabus();
      if (target === 'marks') renderMarks();
      if (target === 'complaint') renderComplaintOptions();
    });
  });

  // ---------------------------------------------------------------
  // Attendance Log tab — real past sessions from the backend
  // ---------------------------------------------------------------

  const logListEl = document.getElementById('logList');
  let logRendered = false;

  async function renderLog() {
    if (logRendered) return;
    logRendered = true;

    const res = await fetch('/api/faculty/sessions');
    const sessions = await res.json();

    const fmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    if (sessions.length === 0) {
      logListEl.innerHTML = '<li class="empty-note">No sessions marked yet — mark attendance first.</li>';
      return;
    }

    sessions.forEach(s => {
      const li = document.createElement('li');
      li.className = 'log-row';
      li.innerHTML = `
        <div class="log-info">
          <span class="log-topic">${s.topic || '(no topic)'}</span>
          <span class="log-meta">${s.subject} · ${fmt.format(new Date(s.date))}</span>
        </div>
        <div class="log-counts">
          <span class="pill pill-present">${s.present} present</span>
          <span class="pill pill-absent">${s.absent} absent</span>
        </div>
      `;
      logListEl.appendChild(li);
    });
  }

  // ---------------------------------------------------------------
  // Manage Syllabus tab — real topics, add + delete via API
  // ---------------------------------------------------------------

  const syllabusListEl = document.getElementById('syllabusList');
  const syllabusNewTopicInput = document.getElementById('syllabusNewTopic');
  const syllabusAddBtn = document.getElementById('syllabusAddBtn');

  async function renderSyllabus() {
    if (!syllabusSubjectSelect.value) return;
    const res = await fetch(`/api/topics?subject_id=${syllabusSubjectSelect.value}`);
    const topics = await res.json();

    syllabusListEl.innerHTML = '';
    if (topics.length === 0) {
      syllabusListEl.innerHTML = '<li class="empty-note">No topics yet — add the first one below.</li>';
      return;
    }

    topics.forEach(t => {
      const li = document.createElement('li');
      li.className = 'syllabus-row';
      li.innerHTML = `
        <span>${t.topic_name}</span>
        <button type="button" class="syllabus-delete" data-id="${t.id}" aria-label="Delete topic">&times;</button>
      `;
      syllabusListEl.appendChild(li);
    });
  }

  if (syllabusSubjectSelect) syllabusSubjectSelect.addEventListener('change', renderSyllabus);

  if (syllabusListEl) {
    syllabusListEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('.syllabus-delete');
      if (!btn) return;
      await fetch(`/api/topics/${btn.dataset.id}`, { method: 'DELETE' });
      renderSyllabus();
      if (syllabusSubjectSelect.value === subjectSelect.value) populateTopics(subjectSelect.value);
    });
  }

  if (syllabusAddBtn) {
    syllabusAddBtn.addEventListener('click', async () => {
      const value = syllabusNewTopicInput.value.trim();
      if (!value) return;
      await fetch('/api/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject_id: syllabusSubjectSelect.value, topic_name: value }),
      });
      syllabusNewTopicInput.value = '';
      renderSyllabus();
      if (syllabusSubjectSelect.value === subjectSelect.value) populateTopics(subjectSelect.value);
    });
  }

  // ---------------------------------------------------------------
  // Marks tab — still local-only (no backend table yet)
  // ---------------------------------------------------------------

  const marksListEl = document.getElementById('marksList');
  const examTypeSelect = document.getElementById('examType');
  const maxMarksInput = document.getElementById('maxMarks');
  const saveMarksBtn = document.getElementById('saveMarksBtn');
  const marksSaveNote = document.getElementById('marksSaveNote');
  const marksFileInput = document.getElementById('marksFileInput');
  const parseFileBtn = document.getElementById('parseFileBtn');
  const uploadStatus = document.getElementById('uploadStatus');

  const marksState = {};
  let lockedMarks = {}; // { student_id: { score, max_marks } } — already saved, cannot be edited

  async function renderMarks() {
    if (!marksListEl) return;

    // Fetch which students already have a locked mark for this subject+exam
    const res = await fetch(`/api/marks/existing?subject_id=${marksSubjectSelect.value}&exam_type=${examTypeSelect.value}`);
    const existing = await res.json();
    lockedMarks = {};
    existing.forEach(row => { lockedMarks[row.student_id] = row; });

    marksListEl.innerHTML = '';
    students.forEach(s => {
      const li = document.createElement('li');
      li.className = 'student-row';
      const locked = lockedMarks[s.student_id];

      if (locked) {
        li.innerHTML = `
          <div class="student-info">
            <span class="student-name">${s.name}</span>
            <span class="student-roll">${s.roll_no}</span>
          </div>
          <input type="number" class="marks-input" value="${locked.score}" disabled title="Already submitted — locked">
        `;
      } else {
        const currentVal = marksState[s.roll_no] ?? '';
        li.innerHTML = `
          <div class="student-info">
            <span class="student-name">${s.name}</span>
            <span class="student-roll">${s.roll_no}</span>
          </div>
          <input type="number" class="marks-input" data-roll="${s.roll_no}" min="0" value="${currentVal}" placeholder="—">
        `;
      }
      marksListEl.appendChild(li);
    });
  }

  if (marksSubjectSelect) marksSubjectSelect.addEventListener('change', renderMarks);
  if (examTypeSelect) examTypeSelect.addEventListener('change', renderMarks);

  if (marksListEl) {
    marksListEl.addEventListener('input', (e) => {
      const input = e.target.closest('.marks-input');
      if (!input || input.disabled) return;
      marksState[input.dataset.roll] = input.value;
    });
  }

  if (saveMarksBtn) {
    saveMarksBtn.addEventListener('click', async () => {
      const records = students
        .filter(s => !lockedMarks[s.student_id] && marksState[s.roll_no] !== undefined && marksState[s.roll_no] !== '')
        .map(s => ({ student_id: s.student_id, score: marksState[s.roll_no] }));

      if (records.length === 0) {
        marksSaveNote.hidden = false;
        marksSaveNote.textContent = 'Enter at least one new mark before saving (locked students are skipped automatically).';
        return;
      }

      const res = await fetch('/api/marks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_id: marksSubjectSelect.value,
          exam_type: examTypeSelect.value,
          max_marks: maxMarksInput.value,
          records,
        }),
      });
      const data = await res.json();

      marksSaveNote.hidden = false;
      marksSaveNote.textContent = `Marks saved for ${data.saved} student(s). Marks are locked once saved and cannot be changed.`;

      await renderMarks(); // refresh so newly-saved ones now show as locked
    });
  }

  if (parseFileBtn) {
    parseFileBtn.addEventListener('click', () => {
      const file = marksFileInput.files[0];
      if (!file) { showUploadStatus('Choose a file first.', false); return; }
      if (!window.XLSX) { showUploadStatus('Excel parser did not load — check your internet connection.', false); return; }

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet);

          let matched = 0;
          rows.forEach(row => {
            const roll = String(row['Roll No'] ?? '').trim();
            const marks = row['Marks'];
            if (roll && marks !== undefined && students.some(s => s.roll_no === roll)) {
              marksState[roll] = marks;
              matched++;
            }
          });

          if (matched === 0) {
            showUploadStatus('No matching rows found. Check the column headers are exactly "Roll No" and "Marks".', false);
          } else {
            renderMarks();
            showUploadStatus(`Filled marks for ${matched} student(s) from the file.`, true);
          }
        } catch (err) {
          showUploadStatus('Could not read that file. Make sure it is a valid .xlsx/.xls/.csv file.', false);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function showUploadStatus(text, ok) {
    uploadStatus.hidden = false;
    uploadStatus.textContent = text;
    uploadStatus.classList.remove('ok', 'err');
    uploadStatus.classList.add(ok ? 'ok' : 'err');
  }

  // ---------------------------------------------------------------
  // Send Complaint tab — still local-only (no backend table yet)
  // ---------------------------------------------------------------

  const complaintStudentSelect = document.getElementById('complaintStudent');
  const complaintText = document.getElementById('complaintText');
  const sendComplaintBtn = document.getElementById('sendComplaintBtn');
  const complaintSaveNote = document.getElementById('complaintSaveNote');
  let complaintOptionsRendered = false;

  function renderComplaintOptions() {
    if (complaintOptionsRendered || !complaintStudentSelect) return;
    complaintOptionsRendered = true;
    students.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.student_id;
      opt.textContent = `${s.name} (${s.roll_no})`;
      complaintStudentSelect.appendChild(opt);
    });
  }

  if (sendComplaintBtn) {
    sendComplaintBtn.addEventListener('click', async () => {
      const message = complaintText.value.trim();
      if (!message) {
        complaintSaveNote.hidden = false;
        complaintSaveNote.textContent = 'Write a message before sending.';
        return;
      }
      const studentName = complaintStudentSelect.selectedOptions[0]?.textContent || 'the student';

      const res = await fetch('/api/complaint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: complaintStudentSelect.value, message }),
      });

      complaintSaveNote.hidden = false;
      if (res.ok) {
        complaintSaveNote.textContent = `Complaint sent to the parent of ${studentName}.`;
        complaintText.value = '';
      } else {
        complaintSaveNote.textContent = 'Could not send the complaint. Try again.';
      }
    });
  }

  // ---------------------------------------------------------------
  // Boot sequence
  // ---------------------------------------------------------------

  // ---------------------------------------------------------------
  // Enroll Student tab
  // ---------------------------------------------------------------

  const enrollNameInput = document.getElementById('enrollName');
  const enrollRollInput = document.getElementById('enrollRoll');
  const enrollParentEmailInput = document.getElementById('enrollParentEmail');
  const enrollBtn = document.getElementById('enrollBtn');
  const enrollSaveNote = document.getElementById('enrollSaveNote');

  if (enrollBtn) {
    enrollBtn.addEventListener('click', async () => {
      const name = enrollNameInput.value.trim();
      const roll_no = enrollRollInput.value.trim();
      const parent_email = enrollParentEmailInput.value.trim();

      enrollSaveNote.hidden = false;

      if (!name || !roll_no || !parent_email) {
        enrollSaveNote.textContent = 'Fill in all fields before enrolling.';
        return;
      }

      const res = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, roll_no, parent_email }),
      });
      const data = await res.json();

      if (!res.ok) {
        enrollSaveNote.textContent = data.error || 'Could not enroll this student.';
        return;
      }

      const parentPart = data.parent_created
        ? `Parent login: ${data.parent_email} / ${data.default_password}.`
        : `Parent (${data.parent_email}) is already registered, so their existing login works.`;

      enrollSaveNote.textContent =
        `Enrolled ${name}. Student login: ${data.roll_no} (or ${data.student_email}) / ${data.default_password}. ${parentPart} ` +
        `Ask them to change the password after first login.`;

      enrollNameInput.value = '';
      enrollRollInput.value = '';
      enrollParentEmailInput.value = '';

      // Refresh the roster so the new student shows up in Mark Attendance right away
      await loadRoster();
      renderList();
    });
  }

  await loadSubjects();
  await loadRoster();
  renderList();
  if (subjectSelect.value) await populateTopics(subjectSelect.value);
});