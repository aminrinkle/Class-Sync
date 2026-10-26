document.addEventListener('DOMContentLoaded', async () => {

  const userNameEl = document.getElementById('userName');
  const logoutBtn = document.getElementById('logoutBtn');

  try {
    const meRes = await fetch('/api/me');
    if (!meRes.ok) { window.location.href = 'index.html'; return; }
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

  const THRESHOLD = 75;

  const childNameEl = document.getElementById('childName');
  const childNameCardEl = document.getElementById('childNameCard');
  const childPctEl = document.getElementById('childPct');
  const notifListEl = document.getElementById('notifList');
  const childSubjectBarsEl = document.getElementById('childSubjectBars');
  const childMarksListEl = document.getElementById('childMarksList');

  // ---------------------------------------------------------------
  // Notifications tab — real absence alerts from the backend
  // ---------------------------------------------------------------

  async function loadNotifications() {
    const res = await fetch('/api/parent/notifications');
    const data = await res.json();

    if (childNameEl) childNameEl.textContent = data.child_name || 'Your child';

    const fmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

    notifListEl.innerHTML = '';
    if (!data.notifications || data.notifications.length === 0) {
      notifListEl.innerHTML = '<li class="empty-note">No absence alerts yet — good news!</li>';
      return;
    }

    data.notifications.forEach(n => {
      const li = document.createElement('li');
      li.className = 'notif-row';
      if (n.type === 'complaint') {
        li.innerHTML = `
          <span class="notif-icon complaint-icon">✉</span>
          <div class="notif-body">
            <span class="notif-title">Note from ${n.faculty_name || 'faculty'}</span>
            <span class="notif-msg">${n.message}</span>
          </div>
          <span class="notif-time">${fmt.format(new Date(n.date))}</span>
        `;
      } else {
        li.innerHTML = `
          <span class="notif-icon">!</span>
          <div class="notif-body">
            <span class="notif-title">Absent — ${n.subject}</span>
            <span class="notif-msg">${data.child_name} was marked absent. Topic covered: ${n.topic || '(no topic)'}.</span>
          </div>
          <span class="notif-time">${fmt.format(new Date(n.date))}</span>
        `;
      }
      notifListEl.appendChild(li);
    });
  }

  // ---------------------------------------------------------------
  // Attendance Summary tab — real overall % + subject bars
  // ---------------------------------------------------------------

  let attendanceLoaded = false;

  async function loadAttendanceSummary() {
    if (attendanceLoaded) return;
    attendanceLoaded = true;

    const res = await fetch('/api/parent/attendance');
    const data = await res.json();

    if (childNameCardEl) childNameCardEl.textContent = data.child_name || 'Your child';

    const totals = (data.subjects || []).reduce((acc, s) => {
      acc.attended += s.attended;
      acc.total += s.total;
      return acc;
    }, { attended: 0, total: 0 });

    const pct = totals.total ? Math.round((totals.attended / totals.total) * 100) : 0;
    if (childPctEl) {
      childPctEl.textContent = `${pct}%`;
      childPctEl.classList.add(pct < THRESHOLD ? 'is-low' : 'is-ok');
    }

    childSubjectBarsEl.innerHTML = '';
    (data.subjects || []).forEach(s => {
      const spct = s.total ? Math.round((s.attended / s.total) * 100) : 0;
      const row = document.createElement('div');
      row.className = 'subject-bar-row';
      row.innerHTML = `
        <div class="subject-bar-top">
          <span class="subject-name">${s.subject}</span>
          <span class="subject-pct">${spct}% (${s.attended}/${s.total})</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill ${spct < THRESHOLD ? 'is-low' : ''}" style="width:${spct}%"></div>
        </div>
      `;
      childSubjectBarsEl.appendChild(row);
    });
  }

  // ---------------------------------------------------------------
  // Child's Marks tab — real data from the backend
  // ---------------------------------------------------------------

  let marksRendered = false;

  async function renderChildMarks() {
    if (marksRendered || !childMarksListEl) return;
    marksRendered = true;

    const res = await fetch('/api/parent/marks');
    const data = await res.json();

    if (!data.marks || data.marks.length === 0) {
      childMarksListEl.innerHTML = '<li class="empty-note">No marks entered yet.</li>';
      return;
    }

    data.marks.forEach(m => {
      const mpct = Math.round((m.score / m.max) * 100);
      const li = document.createElement('li');
      li.className = 'marks-view-row';
      li.innerHTML = `
        <div class="marks-view-info">
          <span class="marks-view-subject">${m.subject}</span>
          <span class="marks-view-exam">${examLabel(m.exam)}</span>
        </div>
        <span class="marks-view-score${mpct < 60 ? ' is-low' : ''}">${m.score}<span class="out-of"> / ${m.max}</span></span>
      `;
      childMarksListEl.appendChild(li);
    });
  }

  function examLabel(exam) {
    return { mpd1: 'MPd 1', mpd2: 'MPd 2', classtest: 'Class Test' }[exam] || exam;
  }

  // ---------------------------------------------------------------
  // Tab switching
  // ---------------------------------------------------------------

  const portalTabs = document.querySelectorAll('.portal-tab');
  const tabPanels = document.querySelectorAll('.tab-panel');

  portalTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      portalTabs.forEach(t => { t.classList.remove('is-active'); t.setAttribute('aria-selected', 'false'); });
      tab.classList.add('is-active');
      tab.setAttribute('aria-selected', 'true');

      const target = tab.dataset.tab;
      tabPanels.forEach(panel => { panel.hidden = panel.dataset.panel !== target; });

      if (target === 'attendance') loadAttendanceSummary();
      if (target === 'marks') renderChildMarks();
    });
  });

  // ---------------------------------------------------------------
  // Boot sequence
  // ---------------------------------------------------------------

  await loadNotifications();
});