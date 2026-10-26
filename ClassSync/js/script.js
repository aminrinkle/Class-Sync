/*
 * Shared script — loaded on every page.
 *  - index.html (login form present)  -> login logic
 *  - portal pages (topbar present)    -> "Change password" button + dialog
 */

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('loginForm')) {
    initLogin();
 /* } else if (document.querySelector('.topbar-right')) {
   */ initChangePassword();
  }
});

/* ---------------------------------------------------------------
 * Login page
 * ------------------------------------------------------------- */
function initLogin() {
  const roleTabs   = document.querySelectorAll('.role-tab');
  const roleLabel  = document.getElementById('roleLabel');
  const form       = document.getElementById('loginForm');
  const emailInput = document.getElementById('email');
  const emailLabel = document.querySelector('label[for="email"]');
  const passInput  = document.getElementById('password');
  const formError  = document.getElementById('formError');
  const submitBtn  = form.querySelector('.submit-btn');

  let selectedRole = 'faculty';
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function updateIdentifierField(role) {
    if (role === 'student') {
      emailInput.type = 'text';
      emailInput.placeholder = 'Roll No or email';
      if (emailLabel) emailLabel.textContent = 'Roll No or Email';
    } else {
      emailInput.type = 'email';
      emailInput.placeholder = 'you@krishnaschool.edu.in';
      if (emailLabel) emailLabel.textContent = 'Email';
    }
  }

  roleTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      roleTabs.forEach(t => {
        t.classList.remove('is-active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('is-active');
      tab.setAttribute('aria-selected', 'true');

      selectedRole = tab.dataset.role;
      roleLabel.textContent = cap(selectedRole);
      updateIdentifierField(selectedRole);
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const identifier = emailInput.value.trim();
    const password = passInput.value;

    if (!identifier || !password) {
      formError.hidden = false;
      formError.textContent = 'Enter both your ID and password to continue.';
      return;
    }
    formError.hidden = true;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';

    const resetButton = () => {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `Continue as <span id="roleLabel">${cap(selectedRole)}</span>`;
    };

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: identifier, password, role: selectedRole }),
      });
      const data = await res.json();

      if (!res.ok) {
        formError.hidden = false;
        formError.textContent = data.error || 'Login failed. Check your details.';
        resetButton();
        return;
      }

      sessionStorage.setItem('classsync_role', data.role);
      sessionStorage.setItem('classsync_name', data.name);
      window.location.href = `${data.role}.html`;
    } catch (err) {
      formError.hidden = false;
      formError.textContent = 'Could not reach the server. Is the Flask app running?';
      resetButton();
    }
  });
}

/* ---------------------------------------------------------------
 * Portal pages: Change password
 * ------------------------------------------------------------- */
function initChangePassword() {
  const topbarRight = document.querySelector('.topbar-right');
  const logoutBtn = document.getElementById('logoutBtn');

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'logout-btn';
  openBtn.id = 'changePasswordBtn';
  openBtn.textContent = 'Change password';
  topbarRight.insertBefore(openBtn, logoutBtn);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="cpTitle">
      <h2 id="cpTitle">Change password</h2>
      <div class="field">
        <label for="cpCurrent">Current password</label>
        <input type="password" id="cpCurrent" autocomplete="current-password">
      </div>
      <div class="field">
        <label for="cpNew">New password <span class="hint">(min 6 characters)</span></label>
        <input type="password" id="cpNew" autocomplete="new-password">
      </div>
      <div class="field">
        <label for="cpConfirm">Confirm new password</label>
        <input type="password" id="cpConfirm" autocomplete="new-password">
      </div>
      <p class="save-note" id="cpNote" hidden></p>
      <div class="modal-actions">
        <button type="button" class="logout-btn" id="cpCancel">Cancel</button>
        <button type="button" class="add-topic-btn" id="cpSave">Save password</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const cur = overlay.querySelector('#cpCurrent');
  const neu = overlay.querySelector('#cpNew');
  const con = overlay.querySelector('#cpConfirm');
  const note = overlay.querySelector('#cpNote');
  const saveBtn = overlay.querySelector('#cpSave');

  function showNote(text, ok) {
    note.hidden = false;
    note.textContent = text;
    note.style.background = ok ? '' : '#FFDADA';
  }

  function open() {
    cur.value = neu.value = con.value = '';
    note.hidden = true;
    overlay.hidden = false;
    cur.focus();
  }
  function close() { overlay.hidden = true; }

  openBtn.addEventListener('click', open);
  overlay.querySelector('#cpCancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) close(); });

  saveBtn.addEventListener('click', async () => {
    if (!cur.value || !neu.value || !con.value) {
      showNote('Fill in all three fields.', false);
      return;
    }
    if (neu.value !== con.value) {
      showNote('New password and confirmation do not match.', false);
      return;
    }

    saveBtn.disabled = true;
    try {
      const res = await fetch('/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: cur.value, new_password: neu.value }),
      });
      const data = await res.json();

      if (res.ok) {
        showNote('Password changed. Use the new password next time you log in.', true);
        cur.value = neu.value = con.value = '';
        setTimeout(close, 1800);
      } else {
        showNote(data.error || 'Could not change the password.', false);
      }
    } catch (err) {
      showNote('Could not reach the server.', false);
    } finally {
      saveBtn.disabled = false;
    }
  });
}