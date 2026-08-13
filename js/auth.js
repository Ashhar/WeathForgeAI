/* ============================================================
   WealthForge AI — auth: session handling, login / signup /
   forgot / reset pages, account page, demo mode chrome.
   Two modes:
     · cloud (Supa.enabled): Supabase email+password auth, data in
       Postgres behind RLS; "Try the demo" signs into the shared
       read-only demo account.
     · local (no env vars): everything works offline from
       localStorage; auth pages explain how to enable the backend.
   ============================================================ */

const Auth = (() => {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const view = () => document.getElementById('view');

  let session = null;
  let profile = null;
  let nextPath = null; // where to land after login

  const enabled = () => typeof Supa !== 'undefined' && Supa.enabled;
  const sb = () => Supa.client;

  function isAuthed() { return !!session; }
  function isDemo() { return !!(profile && profile.is_demo); }
  function setNext(p) { nextPath = p; }

  // ---------- session ----------
  async function init() {
    if (!enabled()) return;
    const { data } = await sb().auth.getSession();
    session = data.session || null;
    if (session) await fetchProfile();
    sb().auth.onAuthStateChange((event, s) => {
      const had = !!session;
      session = s || null;
      if (event === 'SIGNED_OUT') {
        profile = null;
        Store.setLocalMode();
        applyChrome();
        Router.replace('/login');
      } else if (event === 'PASSWORD_RECOVERY') {
        Router.replace('/reset');
      } else if (!had && session) {
        // sign-in from another tab or a magic link
        onSignedIn();
      }
    });
  }

  async function fetchProfile() {
    if (!session) { profile = null; return null; }
    const { data } = await sb().from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    profile = data || null;
    return profile;
  }

  async function onSignedIn() {
    await fetchProfile();
    await Cloud.loadAll();
    applyChrome();
    const dest = nextPath && !['/login', '/signup', '/forgot'].includes(nextPath) ? nextPath : '/dashboard';
    nextPath = null;
    Router.replace(dest);
    // Trigger tour/onboarding after dashboard renders
    setTimeout(() => {
      if (typeof Onboarding !== 'undefined') Onboarding.startOnboarding();
    }, 800);
  }

  // ---------- actions ----------
  async function signUp(email, password, displayName) {
    const { data, error } = await sb().auth.signUp({
      email, password,
      options: { data: { display_name: displayName } },
    });
    if (error) return { error: error.message };
    if (data.session) { session = data.session; await onSignedIn(); return { ok: true }; }
    return { ok: true, confirmEmail: true }; // email confirmation enabled on the project
  }

  async function signIn(email, password) {
    const { data, error } = await sb().auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    session = data.session;
    await onSignedIn();
    return { ok: true };
  }

  async function signInDemo() {
    return signIn(Supa.DEMO_EMAIL, Supa.DEMO_PASSWORD);
  }

  async function signOut() {
    try { await sb().auth.signOut(); } catch (e) { /* already handled by listener */ }
  }

  async function resetPassword(email) {
    const { error } = await sb().auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + '/reset',
    });
    return error ? { error: error.message } : { ok: true };
  }

  async function updatePassword(newPassword) {
    const { error } = await sb().auth.updateUser({ password: newPassword });
    return error ? { error: error.message } : { ok: true };
  }

  async function updateProfile(patch) {
    const { error } = await sb().from('profiles').update(patch).eq('id', session.user.id);
    if (!error) profile = { ...profile, ...patch };
    return error ? { error: error.message } : { ok: true };
  }

  async function deleteAccount() {
    const { error } = await sb().rpc('delete_own_account');
    if (error) return { error: error.message };
    await signOut();
    return { ok: true };
  }

  // ---------- chrome: sidebar account block + demo banner ----------
  function applyChrome() {
    const slot = document.getElementById('sidebar_account');
    if (slot) {
      if (enabled() && session) {
        const name = (profile && profile.display_name) || session.user.email || 'Account';
        const initial = (name || 'A').trim().charAt(0).toUpperCase();
        slot.innerHTML = `
          <a class="acct-chip" href="/account" aria-label="Account settings for ${esc(name)}">
            <span class="acct-avatar" aria-hidden="true">${esc(initial)}</span>
            <span class="acct-name">${esc(name)}${isDemo() ? ' <span class="chip" style="font-size:9px">demo</span>' : ''}</span>
          </a>
          <button class="acct-signout" id="nav_signout" aria-label="Sign out">Sign out</button>`;
        const so = document.getElementById('nav_signout');
        if (so) so.addEventListener('click', signOut);
      } else {
        slot.innerHTML = '';
      }
    }
    let banner = document.getElementById('demo_banner');
    if (isDemo()) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'demo_banner';
        banner.className = 'demo-banner';
        banner.setAttribute('role', 'status');
        banner.innerHTML = `<span>You're viewing <b>demo data</b> (read-only). Sign up to track your own portfolio.</span>
          <a class="btn primary sm" href="/signup" id="demo_banner_cta">Sign up free</a>`;
        document.body.appendChild(banner);
        document.body.classList.add('has-demo-banner');
        document.getElementById('demo_banner_cta').addEventListener('click', () => signOut());
      }
    } else if (banner) {
      banner.remove();
      document.body.classList.remove('has-demo-banner');
    }
  }

  // ---------- shared page bits ----------
  function authShell(title, sub, inner) {
    return `<div class="auth-wrap">
      <div class="card auth-card">
        <div class="brand" style="padding:0 0 16px">
          <div class="brand-mark" aria-hidden="true">W</div>
          <div>
            <div class="brand-name">Wealth<span>Forge</span></div>
            <div class="brand-sub">AI · Net worth</div>
          </div>
        </div>
        <h1 class="page-title" style="font-size:19px">${title}</h1>
        <div class="page-sub" style="margin-bottom:18px">${sub}</div>
        ${inner}
      </div>
    </div>`;
  }

  function field(id, label, type, placeholder, autocomplete) {
    return `<div class="field" style="margin-bottom:13px">
      <label for="${id}">${label}</label>
      <input type="${type}" id="${id}" placeholder="${esc(placeholder || '')}" ${autocomplete ? `autocomplete="${autocomplete}"` : ''}/>
      <div class="err" id="${id}_err" role="alert"></div>
    </div>`;
  }
  function setErr(id, msg) {
    const e = document.getElementById(id + '_err');
    const input = document.getElementById(id);
    if (e) e.textContent = msg || '';
    if (input) input.classList.toggle('invalid', !!msg);
  }
  function formMsg(msg, kind) {
    const e = document.getElementById('auth_msg');
    if (e) { e.innerHTML = msg || ''; e.className = 'auth-msg ' + (kind || ''); }
  }
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function localModeNotice(action) {
    return authShell(action, 'Accounts need the Supabase backend, which isn\'t configured for this build.', `
      <div class="form-note" style="margin-bottom:14px">This copy of WealthForge AI is running in <b>local mode</b> — your portfolio lives in this browser's storage and never leaves your device. To enable sign-in, cloud sync and the shared demo account, set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see <code>supabase/README.md</code>).</div>
      <a class="btn primary" href="/dashboard">Continue with local data</a>`);
  }

  // ---------- login ----------
  function renderLogin() {
    if (!enabled()) { view().innerHTML = localModeNotice('Log in'); return; }
    view().innerHTML = authShell('Welcome back', 'Log in to see your portfolio.', `
      ${field('li_email', 'Email', 'email', 'you@example.com', 'email')}
      ${field('li_pw', 'Password', 'password', '••••••••', 'current-password')}
      <div id="auth_msg" class="auth-msg" role="alert"></div>
      <button class="btn primary" id="li_submit" style="width:100%;justify-content:center">Log in</button>
      <button class="btn" id="li_demo" style="width:100%;justify-content:center;margin-top:10px">🔭 Try the demo</button>
      <div class="auth-links">
        <a href="/forgot">Forgot password?</a>
        <span>New here? <a href="/signup">Create an account</a></span>
      </div>`);
    const submit = async () => {
      const email = document.getElementById('li_email').value.trim();
      const pw = document.getElementById('li_pw').value;
      setErr('li_email', EMAIL_RE.test(email) ? '' : 'Enter a valid email address');
      setErr('li_pw', pw ? '' : 'Enter your password');
      if (!EMAIL_RE.test(email) || !pw) return;
      const btn = document.getElementById('li_submit');
      btn.disabled = true; btn.textContent = 'Logging in…';
      const res = await signIn(email, pw);
      if (res.error) { formMsg(esc(res.error), 'error'); btn.disabled = false; btn.textContent = 'Log in'; }
    };
    document.getElementById('li_submit').addEventListener('click', submit);
    view().querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
    document.getElementById('li_demo').addEventListener('click', async () => {
      const btn = document.getElementById('li_demo');
      btn.disabled = true; btn.textContent = 'Opening demo…';
      const res = await signInDemo();
      if (res.error) { formMsg('Demo account unavailable: ' + esc(res.error), 'error'); btn.disabled = false; btn.textContent = '🔭 Try the demo'; }
    });
  }

  // ---------- signup ----------
  function renderSignup() {
    if (!enabled()) { view().innerHTML = localModeNotice('Sign up'); return; }
    view().innerHTML = authShell('Create your account', 'Track every asset and loan you own — free.', `
      ${field('su_name', 'Display name', 'text', 'How should we greet you?', 'name')}
      ${field('su_email', 'Email', 'email', 'you@example.com', 'email')}
      ${field('su_pw', 'Password', 'password', 'At least 8 characters', 'new-password')}
      ${field('su_pw2', 'Confirm password', 'password', 'Repeat the password', 'new-password')}
      <div id="auth_msg" class="auth-msg" role="alert"></div>
      <button class="btn primary" id="su_submit" style="width:100%;justify-content:center">Create account</button>
      <div class="auth-links">
        <span>Already registered? <a href="/login">Log in</a></span>
        <a href="/login" id="su_demo_link">or try the demo first</a>
      </div>`);
    const submit = async () => {
      const name = document.getElementById('su_name').value.trim();
      const email = document.getElementById('su_email').value.trim();
      const pw = document.getElementById('su_pw').value;
      const pw2 = document.getElementById('su_pw2').value;
      setErr('su_name', name ? '' : 'Pick a display name');
      setErr('su_email', EMAIL_RE.test(email) ? '' : 'Enter a valid email address');
      setErr('su_pw', pw.length >= 8 ? '' : 'Use at least 8 characters');
      setErr('su_pw2', pw === pw2 ? '' : "Passwords don't match");
      if (!name || !EMAIL_RE.test(email) || pw.length < 8 || pw !== pw2) return;
      const btn = document.getElementById('su_submit');
      btn.disabled = true; btn.textContent = 'Creating…';
      const res = await signUp(email, pw, name);
      if (res.error) { formMsg(esc(res.error), 'error'); btn.disabled = false; btn.textContent = 'Create account'; return; }
      if (res.confirmEmail) {
        formMsg('✅ Account created — check <b>' + esc(email) + '</b> for a confirmation link, then log in.', 'ok');
        btn.textContent = 'Create account';
      }
    };
    document.getElementById('su_submit').addEventListener('click', submit);
    view().querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
  }

  // ---------- forgot / reset ----------
  function renderForgot() {
    if (!enabled()) { view().innerHTML = localModeNotice('Reset password'); return; }
    view().innerHTML = authShell('Reset your password', "We'll email you a reset link.", `
      ${field('fp_email', 'Email', 'email', 'you@example.com', 'email')}
      <div id="auth_msg" class="auth-msg" role="alert"></div>
      <button class="btn primary" id="fp_submit" style="width:100%;justify-content:center">Send reset link</button>
      <div class="auth-links"><a href="/login">← Back to login</a></div>`);
    document.getElementById('fp_submit').addEventListener('click', async () => {
      const email = document.getElementById('fp_email').value.trim();
      setErr('fp_email', EMAIL_RE.test(email) ? '' : 'Enter a valid email address');
      if (!EMAIL_RE.test(email)) return;
      const res = await resetPassword(email);
      formMsg(res.error ? esc(res.error) : '📬 If that address has an account, a reset link is on its way.', res.error ? 'error' : 'ok');
    });
  }

  function renderReset() {
    if (!enabled()) { view().innerHTML = localModeNotice('Set a new password'); return; }
    if (!session) {
      view().innerHTML = authShell('Set a new password', 'This page needs a valid reset link.', `
        <div class="form-note">Open the link from your password-reset email — it signs you in temporarily so you can set a new password. <a href="/forgot">Request a new link</a>.</div>`);
      return;
    }
    view().innerHTML = authShell('Set a new password', 'You\'re signed in via the reset link — choose a new password.', `
      ${field('rp_pw', 'New password', 'password', 'At least 8 characters', 'new-password')}
      ${field('rp_pw2', 'Confirm new password', 'password', 'Repeat the password', 'new-password')}
      <div id="auth_msg" class="auth-msg" role="alert"></div>
      <button class="btn primary" id="rp_submit" style="width:100%;justify-content:center">Update password</button>`);
    document.getElementById('rp_submit').addEventListener('click', async () => {
      const pw = document.getElementById('rp_pw').value;
      const pw2 = document.getElementById('rp_pw2').value;
      setErr('rp_pw', pw.length >= 8 ? '' : 'Use at least 8 characters');
      setErr('rp_pw2', pw === pw2 ? '' : "Passwords don't match");
      if (pw.length < 8 || pw !== pw2) return;
      const res = await updatePassword(pw);
      if (res.error) { formMsg(esc(res.error), 'error'); return; }
      UI.toast('Password updated');
      Router.go('/dashboard');
    });
  }

  // ---------- account page ----------
  function renderAccount() {
    if (!enabled()) {
      view().innerHTML = `
        <div class="page-head"><div>
          <h1 class="page-title">Account</h1>
          <div class="page-sub">Local mode — no account needed.</div>
        </div></div>
        <div class="card"><div class="card-title">Local data</div>
          <p class="dim small" style="margin-bottom:12px">Your portfolio is stored in this browser only. Configure Supabase (see <code>supabase/README.md</code>) to enable accounts, sync and the shared demo. You can still export your data any time.</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn" onclick="ExportKit.downloadAllCsv()">Download CSV backup</button>
            <button class="btn" onclick="ExportKit.downloadPdf()">Portfolio PDF</button>
          </div>
        </div>`;
      return;
    }
    if (!session) { Router.replace('/login'); return; }
    const p = profile || {};
    const created = session.user.created_at ? Fin.fmtDate(session.user.created_at) : '—';
    const demo = isDemo();
    view().innerHTML = `
      <div class="page-head"><div>
        <h1 class="page-title">Account</h1>
        <div class="page-sub">Profile, security and your data.</div>
      </div></div>

      <div class="card" style="max-width:720px">
        <div class="card-title">Profile</div>
        <div class="form-grid">
          <div class="field">
            <label for="ac_name">Display name</label>
            <input type="text" id="ac_name" value="${esc(p.display_name || '')}" ${demo ? 'disabled' : ''}/>
          </div>
          <div class="field">
            <label for="ac_email">Email</label>
            <input type="email" id="ac_email" value="${esc(session.user.email || '')}" disabled aria-describedby="ac_email_hint"/>
            <div class="hint" id="ac_email_hint">Email is your login and can't be changed here.</div>
          </div>
          <div class="field">
            <label for="ac_ccy">Base currency</label>
            <select id="ac_ccy" ${demo ? 'disabled' : ''}>
              ${['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'].map(c => `<option value="${c}" ${(p.base_currency || 'INR') === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
            <div class="hint">Values are tracked and formatted in ₹ (Indian grouping) today; your preference is saved for multi-currency support.</div>
          </div>
          <div class="field">
            <label>Member since</label>
            <input type="text" value="${esc(created)}" disabled/>
          </div>
        </div>
        ${demo ? '<div class="form-note" style="margin-top:14px">The shared demo profile is read-only.</div>'
               : '<div style="margin-top:16px"><button class="btn primary" id="ac_save">Save profile</button></div>'}
      </div>

      <div class="card" style="max-width:720px;margin-top:18px">
        <div class="card-title">Security</div>
        <div class="form-grid">
          ${demo ? '<div class="form-note">Password changes are disabled on the demo account.</div>' : `
          <div class="field">
            <label for="ac_pw">New password</label>
            <input type="password" id="ac_pw" placeholder="At least 8 characters" autocomplete="new-password"/>
            <div class="err" id="ac_pw_err" role="alert"></div>
          </div>
          <div class="field">
            <label for="ac_pw2">Confirm new password</label>
            <input type="password" id="ac_pw2" autocomplete="new-password"/>
            <div class="err" id="ac_pw2_err" role="alert"></div>
          </div>`}
        </div>
        ${demo ? '' : '<div style="margin-top:16px"><button class="btn" id="ac_pw_save">Change password</button></div>'}
      </div>

      <div class="card" style="max-width:720px;margin-top:18px">
        <div class="card-title">Your data</div>
        <p class="dim small" style="margin-bottom:12px">Download everything — holdings, liabilities and your full snapshot history — as CSV, or a one-page portfolio PDF.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn" onclick="ExportKit.downloadAllCsv()">⬇ Download all my data (CSV)</button>
          <button class="btn" onclick="ExportKit.downloadPdf()">Portfolio PDF</button>
        </div>
      </div>

      <div class="card danger-zone" style="max-width:720px;margin-top:18px">
        <div class="card-title" style="color:var(--neg)">Danger zone</div>
        ${demo ? '<div class="form-note">The shared demo account can\'t be deleted.</div>' : `
        <p class="dim small" style="margin-bottom:12px">Deleting your account permanently removes your profile, holdings, liabilities, goals and snapshot history. This cannot be undone.</p>
        <button class="btn danger" id="ac_delete">Delete account…</button>`}
      </div>`;

    if (!demo) {
      const save = document.getElementById('ac_save');
      if (save) save.addEventListener('click', async () => {
        const res = await updateProfile({
          display_name: document.getElementById('ac_name').value.trim(),
          base_currency: document.getElementById('ac_ccy').value,
        });
        UI.toast(res.error ? 'Could not save: ' + res.error : 'Profile saved');
        applyChrome();
      });
      const pwSave = document.getElementById('ac_pw_save');
      if (pwSave) pwSave.addEventListener('click', async () => {
        const pw = document.getElementById('ac_pw').value;
        const pw2 = document.getElementById('ac_pw2').value;
        setErr('ac_pw', pw.length >= 8 ? '' : 'Use at least 8 characters');
        setErr('ac_pw2', pw === pw2 ? '' : "Passwords don't match");
        if (pw.length < 8 || pw !== pw2) return;
        const res = await updatePassword(pw);
        UI.toast(res.error ? 'Could not change password: ' + res.error : 'Password changed');
        if (!res.error) { document.getElementById('ac_pw').value = ''; document.getElementById('ac_pw2').value = ''; }
      });
      const del = document.getElementById('ac_delete');
      if (del) del.addEventListener('click', () => {
        const back = document.createElement('div');
        back.className = 'modal-backdrop';
        back.innerHTML = `<div class="modal">
          <h3>Delete this account?</h3>
          <p>All your data — profile, holdings, liabilities, goals, history — will be permanently deleted. Type <b>DELETE</b> to confirm.</p>
          <div class="field" style="margin-bottom:14px"><input type="text" id="del_confirm" placeholder="Type DELETE" aria-label="Type DELETE to confirm"/></div>
          <div class="modal-actions">
            <button class="btn" data-cancel>Cancel</button>
            <button class="btn danger" data-ok disabled>Delete forever</button>
          </div>
        </div>`;
        document.body.appendChild(back);
        const okBtn = back.querySelector('[data-ok]');
        back.querySelector('#del_confirm').addEventListener('input', e => { okBtn.disabled = e.target.value.trim() !== 'DELETE'; });
        back.addEventListener('click', e => { if (e.target === back) back.remove(); });
        back.querySelector('[data-cancel]').addEventListener('click', () => back.remove());
        okBtn.addEventListener('click', async () => {
          okBtn.disabled = true; okBtn.textContent = 'Deleting…';
          const res = await deleteAccount();
          if (res.error) { UI.toast('Could not delete: ' + res.error); back.remove(); }
          // success → SIGNED_OUT listener routes to /login
        });
      });
    }
  }

  return {
    init, enabled, isAuthed, isDemo, setNext, applyChrome,
    signUp, signIn, signInDemo, signOut, resetPassword, updatePassword, updateProfile, deleteAccount,
    renderLogin, renderSignup, renderForgot, renderReset, renderAccount,
    get session() { return session; },
    get profile() { return profile; },
  };
})();

if (typeof globalThis !== 'undefined') globalThis.Auth = Auth;
