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

  const overallPctEl = document.getElementById('overallPct');
  const thresholdNoteEl = document.getElementById('thresholdNote');
  const subjectBarsEl = document.getElementById('subjectBars');
  const historyListEl = document.getElementById('historyList');

  // ---------------------------------------------------------------
  // Overview tab — real attendance % + subject bars
  // ---------------------------------------------------------------

  let attendanceData = { subjects: [], history: [] };

  async function loadAttendance() {
    const res = await fetch('/api/student/attendance');
    attendanceData = await res.json();

    const totals = attendanceData.subjects.reduce((acc, s) => {
      acc.attended += s.attended;
      acc.total += s.total;
      return acc;
    }, { attended: 0, total: 0 });

    const overallPct = totals.total ? Math.round((totals.attended / totals.total) * 100) : 0;
    overallPctEl.textContent = `${overallPct}%`;
    overallPctEl.classList.add(overallPct < THRESHOLD ? 'is-low' : 'is-ok');

    if (thresholdNoteEl) {
      if (totals.total === 0) {
        thresholdNoteEl.textContent = 'No attendance marked yet';
      } else if (overallPct < THRESHOLD) {
        thresholdNoteEl.textContent = `Below ${THRESHOLD}% — you may be detained`;
        thresholdNoteEl.classList.add('warn');
      } else {
        thresholdNoteEl.textContent = `Above ${THRESHOLD}% requirement`;
        thresholdNoteEl.classList.add('safe');
      }
    }

    subjectBarsEl.innerHTML = '';
    attendanceData.subjects.forEach(s => {
      const pct = s.total ? Math.round((s.attended / s.total) * 100) : 0;
      const row = document.createElement('div');
      row.className = 'subject-bar-row';
      row.innerHTML = `
        <div class="subject-bar-top">
          <span class="subject-name">${s.subject}</span>
          <span class="subject-pct">${pct}% (${s.attended}/${s.total})</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill ${pct < THRESHOLD ? 'is-low' : ''}" style="width:${pct}%"></div>
        </div>
      `;
      subjectBarsEl.appendChild(row);
    });

    historyListEl.innerHTML = '';
    const dateFormatter = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
    if (attendanceData.history.length === 0) {
      historyListEl.innerHTML = '<li class="empty-note">No lectures recorded yet.</li>';
    }
    attendanceData.history.forEach(item => {
      const li = document.createElement('li');
      li.className = 'history-row';
      const prettyDate = dateFormatter.format(new Date(item.date));
      li.innerHTML = `
        <div class="history-info">
          <span class="history-topic">${item.topic || '(no topic)'}</span>
          <span class="history-meta">${item.subject} · ${prettyDate}</span>
        </div>
        <span class="status-tag ${item.status}">${item.status === 'present' ? 'Present' : 'Absent'}</span>
      `;
      historyListEl.appendChild(li);
    });
  }

  // ---------------------------------------------------------------
  // Trend chart — real weekly data from the backend
  // ---------------------------------------------------------------

  async function loadTrendChart() {
    const trendCanvas = document.getElementById('trendChart');
    if (!trendCanvas || !window.Chart) return;

    const res = await fetch('/api/student/trend');
    const weeklyTrend = await res.json();

    if (weeklyTrend.length === 0) return; // nothing to chart yet

    new Chart(trendCanvas, {
      type: 'line',
      data: {
        labels: weeklyTrend.map(w => w.week.split('-')[1] ? `Wk ${w.week.split('-')[1]}` : w.week),
        datasets: [{
          label: 'Attendance %',
          data: weeklyTrend.map(w => w.pct),
          borderColor: '#23283B',
          borderWidth: 2.5,
          backgroundColor: 'rgba(47, 199, 176, 0.18)',
          fill: true,
          tension: 0.3,
          pointBackgroundColor: weeklyTrend.map(w => w.pct < THRESHOLD ? '#FF6B6B' : '#2FC7B0'),
          pointBorderColor: '#23283B',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { min: 0, max: 100, ticks: { callback: v => v + '%', font: { family: 'Inter' } }, grid: { color: '#E7ECF9' } },
          x: { ticks: { font: { family: 'Inter' } }, grid: { display: false } },
        },
      },
    });
  }

  // ---------------------------------------------------------------
  // My Marks tab — real data from the backend
  // ---------------------------------------------------------------

  const marksViewListEl = document.getElementById('marksViewList');
  let marksRendered = false;

  function examLabel(exam) {
    return { mpd1: 'MPd 1', mpd2: 'MPd 2', classtest: 'Class Test' }[exam] || exam;
  }

  async function renderMarks() {
    if (marksRendered || !marksViewListEl) return;
    marksRendered = true;

    const res = await fetch('/api/student/marks');
    const marks = await res.json();

    if (marks.length === 0) {
      marksViewListEl.innerHTML = '<li class="empty-note">No marks entered yet.</li>';
      return;
    }

    marks.forEach(m => {
      const pct = Math.round((m.score / m.max) * 100);
      const li = document.createElement('li');
      li.className = 'marks-view-row';
      li.innerHTML = `
        <div class="marks-view-info">
          <span class="marks-view-subject">${m.subject}</span>
          <span class="marks-view-exam">${examLabel(m.exam)}</span>
        </div>
        <span class="marks-view-score${pct < 60 ? ' is-low' : ''}">${m.score}<span class="out-of"> / ${m.max}</span></span>
      `;
      marksViewListEl.appendChild(li);
    });
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

      if (target === 'marks') renderMarks();
    });
  });

  // ---------------------------------------------------------------
  // Boot sequence
  // ---------------------------------------------------------------

  await loadAttendance();
  await loadTrendChart();
});