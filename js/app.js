/* ============================================================
   WealthForge AI — app shell: route handling (history routing
   via js/router.js), add/edit flows, grouped type picker,
   liabilities, theme toggle, modals, boot.
   Routes:
     /dashboard              /holdings/:type       /asset/:id
     /add  /add/:type        /edit/:id
     /liabilities            /add-liability        /edit-liability/:id
     /projections/:years?/:mode?                   /settings
     (unknown → 404)
   ============================================================ */

const UI = (() => {
  const view = () => document.getElementById('view');
  let highlightId = null; // row to flash after save

  // ---------- theme ----------
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('wf.theme', theme); } catch (e) { /* ignore */ }
    route(); // re-render so charts pick up the new tokens
  }
  function initTheme() {
    let theme = 'dark';
    try { theme = localStorage.getItem('wf.theme') || 'dark'; } catch (e) { /* ignore */ }
    document.documentElement.dataset.theme = theme;
  }

  // ---------- toast ----------
  let toastTimer = null;
  function toast(msg) {
    let el = document.getElementById('toast');
    if (el) el.remove();
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 3200);
  }

  // ---------- confirm modal helper ----------
  function confirmModal({ title, body, okLabel, onOk }) {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal">
      <h3>${title}</h3>
      <p>${body}</p>
      <div class="modal-actions">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn danger" data-ok>${okLabel}</button>
      </div>
    </div>`;
    document.body.appendChild(back);
    back.addEventListener('click', e => { if (e.target === back) back.remove(); });
    back.querySelector('[data-cancel]').addEventListener('click', () => back.remove());
    back.querySelector('[data-ok]').addEventListener('click', () => { back.remove(); onOk(); });
  }

  // demo mode: block mutations with a clear explanation
  function demoBlocked() {
    if (!Store.isReadOnly()) return false;
    toast('Demo data is read-only — sign up to track your own portfolio');
    return true;
  }

  function confirmDelete(id) {
    if (demoBlocked()) return;
    const a = Store.get(id);
    if (!a) return;
    confirmModal({
      title: `Delete “${(a.label || 'this holding').replace(/</g, '&lt;')}”?`,
      body: "This removes the holding from your portfolio. It doesn't touch the real asset — just this record.",
      okLabel: 'Delete holding',
      onOk: () => {
        const type = a.type;
        Store.remove(id);
        toast('Holding deleted');
        Router.go(`/holdings/${type}`);
      },
    });
  }

  function confirmDeleteLiability(id) {
    if (demoBlocked()) return;
    const l = Store.getLiability(id);
    if (!l) return;
    confirmModal({
      title: `Delete “${(l.label || 'this liability').replace(/</g, '&lt;')}”?`,
      body: 'This removes the liability record — net worth will rise by its outstanding balance.',
      okLabel: 'Delete liability',
      onOk: () => {
        Store.removeLiability(id);
        toast('Liability deleted');
        Router.go('/liabilities');
      },
    });
  }

  // ---------- valuation-mode toggle (C3) ----------
  function promptModal({ title, body, label, value, type, onOk }) {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal" role="dialog" aria-label="${title}">
      <h3>${title}</h3>
      <p>${body}</p>
      <div class="field" style="margin-bottom:16px">
        <label for="pm_input">${label}</label>
        <input type="${type || 'number'}" id="pm_input" value="${value != null ? value : ''}"/>
        <div class="err" id="pm_err" role="alert"></div>
      </div>
      <div class="modal-actions">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn primary" data-ok>Apply</button>
      </div>
    </div>`;
    document.body.appendChild(back);
    const input = back.querySelector('#pm_input');
    input.focus(); input.select();
    back.addEventListener('click', e => { if (e.target === back) back.remove(); });
    back.querySelector('[data-cancel]').addEventListener('click', () => back.remove());
    const submit = () => {
      const n = parseFloat(input.value);
      if (!isFinite(n)) { back.querySelector('#pm_err').textContent = 'Enter a number'; return; }
      back.remove();
      onOk(n);
    };
    back.querySelector('[data-ok]').addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  }

  function setValuationMode(id, mode) {
    if (demoBlocked()) return;
    const a = Store.get(id);
    if (!a) return;
    const natural = Store.TYPES[a.type].mode;
    const v = Store.valuation(a);
    if (mode === v.mode) return;
    if (mode === natural) {
      Store.update(id, { valuationMode: null });
      toast(`Back to ${natural} valuation`);
      route();
    } else if (mode === 'manual') {
      promptModal({
        title: 'Switch to manual valuation',
        body: 'The holding will be valued at your estimate until you change it — no market feed, no compounding.',
        label: "Today's value (₹)",
        value: Math.round(v.grossValue || 0),
        onOk: n => {
          Store.update(id, { valuationMode: 'manual', data: { ...(a.data || {}), manualValue: n, manualValueDate: Fin.todayISO() } });
          toast('Switched to manual valuation');
          route();
        },
      });
    } else if (mode === 'computed') {
      promptModal({
        title: 'Switch to computed valuation',
        body: 'The holding will compound its cost basis at a fixed assumed rate — deterministic, no market noise.',
        label: 'Assumed growth rate (% p.a.)',
        value: a.data && a.data.assumedRate != null ? a.data.assumedRate : 8,
        onOk: n => {
          Store.update(id, { valuationMode: 'computed', data: { ...(a.data || {}), assumedRate: n } });
          toast('Switched to computed valuation');
          route();
        },
      });
    } else if (mode === 'live' && natural === 'live') {
      Store.update(id, { valuationMode: null });
      toast('Back to live pricing');
      route();
    }
  }

  // ---------- export ----------
  function exportModal() {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal" role="dialog" aria-label="Export your data">
      <h3>Export your data</h3>
      <p>Everything stays on your device — files are generated locally.${Store.isReadOnly() ? ' Demo exports are watermarked.' : ''}</p>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
        <button class="btn" data-csv style="justify-content:flex-start">🗃️ CSV backup — assets, liabilities & history (3 files)</button>
        <button class="btn" data-pdf style="justify-content:flex-start">📄 One-page portfolio PDF</button>
      </div>
      <div class="modal-actions"><button class="btn" data-cancel>Close</button></div>
    </div>`;
    document.body.appendChild(back);
    back.addEventListener('click', e => { if (e.target === back) back.remove(); });
    back.querySelector('[data-cancel]').addEventListener('click', () => back.remove());
    back.querySelector('[data-csv]').addEventListener('click', () => { back.remove(); ExportKit.downloadAllCsv(); });
    back.querySelector('[data-pdf]').addEventListener('click', () => { back.remove(); ExportKit.downloadPdf(); });
  }

  // ---------- goals ----------
  function goalModal(editId) {
    if (demoBlocked()) return;
    const g = editId ? Store.getGoal(editId) : null;
    if (editId && !g) return;
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal" role="dialog" aria-label="${g ? 'Edit goal' : 'New goal'}">
      <h3>${g ? 'Edit goal' : 'New goal'}</h3>
      <div class="field" style="margin-bottom:12px">
        <label for="g_title">Goal title <span class="req">*</span></label>
        <input type="text" id="g_title" value="${esc(g ? g.title : '')}" placeholder="e.g. ₹1 Cr net worth"/>
        <div class="err" id="g_title_err" role="alert"></div>
      </div>
      <div class="field" style="margin-bottom:12px">
        <label for="g_amount">Target net worth (₹) <span class="req">*</span></label>
        <input type="number" id="g_amount" min="1" value="${g ? g.targetAmount : ''}" placeholder="10000000"/>
        <div class="err" id="g_amount_err" role="alert"></div>
      </div>
      <div class="field" style="margin-bottom:16px">
        <label for="g_date">Target date (optional)</label>
        <input type="date" id="g_date" value="${g && g.targetDate ? g.targetDate : ''}"/>
      </div>
      <div class="modal-actions">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn primary" data-ok>${g ? 'Save goal' : 'Create goal'}</button>
      </div>
    </div>`;
    document.body.appendChild(back);
    back.addEventListener('click', e => { if (e.target === back) back.remove(); });
    back.querySelector('[data-cancel]').addEventListener('click', () => back.remove());
    back.querySelector('#g_title').focus();
    back.querySelector('[data-ok]').addEventListener('click', () => {
      const title = back.querySelector('#g_title').value.trim();
      const amount = parseFloat(back.querySelector('#g_amount').value);
      const date = back.querySelector('#g_date').value || null;
      const tErr = back.querySelector('#g_title_err'), aErr = back.querySelector('#g_amount_err');
      tErr.textContent = title ? '' : 'Give the goal a name';
      aErr.textContent = amount > 0 ? '' : 'Enter a target amount above zero';
      if (!title || !(amount > 0)) return;
      if (g) {
        // lowering the target below current net worth re-checks achievement
        Store.updateGoal(g.id, { title, targetAmount: amount, targetDate: date });
        toast('Goal updated');
      } else {
        Store.addGoal({ title, targetAmount: amount, targetDate: date });
        toast('Goal created');
      }
      back.remove();
      celebrateNewAchievements();
      route();
    });
  }

  function confirmDeleteGoal(id) {
    if (demoBlocked()) return;
    const g = Store.getGoal(id);
    if (!g) return;
    confirmModal({
      title: `Delete goal “${(g.title || '').replace(/</g, '&lt;')}”?`,
      body: 'This removes the goal and its progress tracking. Your holdings are untouched.',
      okLabel: 'Delete goal',
      onOk: () => { Store.removeGoal(id); toast('Goal deleted'); route(); },
    });
  }

  // one-time celebration when net worth crosses a goal target
  function celebrateNewAchievements() {
    const newly = Store.checkGoalAchievements();
    for (const g of newly) {
      toast(`🎉 Goal achieved: ${g.title} — you crossed ${Fin.fmtINR(g.targetAmount, { compact: true })}!`);
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          new Notification('🎉 WealthForge — goal achieved!', {
            body: `${g.title}: your net worth crossed ${Fin.fmtINR(g.targetAmount, { compact: true })}.`,
          });
        } catch (e) { /* notification blocked */ }
      }
    }
    return newly.length;
  }

  function wireGoalsPage() {
    const btn = document.getElementById('goal_notif');
    if (btn) btn.addEventListener('click', async () => {
      const res = await Notification.requestPermission();
      toast(res === 'granted' ? 'Browser alerts enabled' : 'Alerts stay off — you can re-enable in site settings');
      route();
    });
  }

  // ---------- add / edit: grouped type picker ----------
  function typePicker() {
    const modeLabel = m => m === 'live' ? 'Live-priced' : m === 'computed' ? 'Computed' : 'Manual';
    return `
      <div class="page-head">
        <div>
          <h1 class="page-title">Add an asset you already own</h1>
          <div class="page-sub">Step 1 — pick the type; the form reshapes to it. The backbone is always the same: <b>what & how much</b>, <b>what it cost</b>, and <b>when</b>.</div>
        </div>
      </div>
      ${Store.TYPE_GROUPS.map(g => `
        <div class="picker-group-title">${g.title}</div>
        <div class="type-grid">
          ${g.types.map(k => {
            const t = Store.TYPES[k];
            return `<button class="type-card" onclick="Router.go('/add/${k}')">
              <div class="t-ico">${t.icon}</div>
              <div class="t-name">${t.label}</div>
              <div class="t-desc">${t.desc}</div>
              <span class="tag ${t.mode}"><span class="dot"></span>${modeLabel(t.mode)}</span>
            </button>`;
          }).join('')}
        </div>`).join('')}
      <div class="picker-group-title">Bulk Import</div>
      <div class="type-grid">
        <button class="type-card" onclick="AIImport.openUploadModal()" style="background:linear-gradient(135deg, var(--brand-bg, #1a1f2e) 0%, var(--card-bg, #242938) 100%); border-color: var(--brand, #00d4ff)">
          <div class="t-ico">🤖</div>
          <div class="t-name">AI-Powered Import</div>
          <div class="t-desc">Upload any statement (CSV, XLS, PDF) from any broker — AI extracts all asset types automatically</div>
          <span class="tag live"><span class="dot"></span>Intelligent</span>
        </button>
      </div>
      <div class="picker-group-title">Liabilities</div>
      <div class="type-grid">
        <button class="type-card" onclick="Router.go('/add-liability')">
          <div class="t-ico">💳</div>
          <div class="t-name">Loan / liability</div>
          <div class="t-desc">Home, car, personal, education loans & card balances — net worth = assets − liabilities</div>
          <span class="tag computed"><span class="dot"></span>Amortized</span>
        </button>
      </div>
      <div class="disclaimer" style="margin-top:22px">💡 Have a broker / AMC / bank statement handy? Each form has <b>AI-Powered Import</b> — upload any CSV, XLS, or PDF and AI extracts your holdings automatically. Or use the quick manual path — quantity, average cost, date — to finish in seconds.</div>`;
  }

  function addEditForm(type, editId) {
    const existing = editId ? Store.get(editId) : null;
    if (editId && !existing) { view().innerHTML = '<div class="card"><div class="empty">Asset not found.</div></div>'; return; }
    if (!Store.TYPES[type]) { Router.go('/add'); return; }

    view().innerHTML = `
      <button class="back-link" onclick="Router.go('${editId ? `/asset/${editId}` : '/add'}')">← ${editId ? 'Back to asset' : 'Choose a different type'}</button>
      <div class="card" style="max-width:860px">
        <div id="form_container"></div>
        <div class="form-actions">
          <span class="small faint">Fields marked <span style="color:var(--brand)">*</span> are required — everything else is progressive disclosure.</span>
          <div style="display:flex;gap:10px">
            <button class="btn" id="form_cancel">Cancel</button>
            <button class="btn primary" id="form_save">${editId ? 'Save changes' : 'Add to portfolio'}</button>
          </div>
        </div>
      </div>`;

    Forms.render(document.getElementById('form_container'), type, existing);

    document.getElementById('form_cancel').addEventListener('click', () => {
      Router.go(editId ? `/asset/${editId}` : `/holdings/${type}`);
    });
    document.getElementById('form_save').addEventListener('click', () => {
      if (demoBlocked()) return;
      const res = Forms.collect(type);
      if (!res.ok) { toast('Please fix the highlighted fields'); return; }
      if (editId) {
        Store.update(editId, res.asset);
        highlightId = editId;
        toast('Holding updated');
      } else {
        const added = Store.add(res.asset);
        highlightId = added.id;
        toast('Added to your portfolio');
      }
      Router.go(`/holdings/${type}`);
    });
  }

  function liabilityForm(editId) {
    const existing = editId ? Store.getLiability(editId) : null;
    if (editId && !existing) { view().innerHTML = '<div class="card"><div class="empty">Liability not found.</div></div>'; return; }

    view().innerHTML = `
      <button class="back-link" onclick="Router.go('/liabilities')">← Back to liabilities</button>
      <div class="card" style="max-width:860px">
        <div id="form_container"></div>
        <div class="form-actions">
          ${editId ? `<button class="btn danger" onclick="UI.confirmDeleteLiability('${editId}')">Delete</button>` : '<span></span>'}
          <div style="display:flex;gap:10px">
            <button class="btn" id="form_cancel">Cancel</button>
            <button class="btn primary" id="form_save">${editId ? 'Save changes' : 'Add liability'}</button>
          </div>
        </div>
      </div>`;

    Forms.renderLiability(document.getElementById('form_container'), existing);

    document.getElementById('form_cancel').addEventListener('click', () => { Router.go('/liabilities'); });
    document.getElementById('form_save').addEventListener('click', () => {
      if (demoBlocked()) return;
      const res = Forms.collectLiability();
      if (!res.ok) { toast('Please fix the highlighted fields'); return; }
      if (editId) {
        Store.updateLiability(editId, res.liability);
        highlightId = editId;
        toast('Liability updated');
      } else {
        const added = Store.addLiability(res.liability);
        highlightId = added.id;
        toast('Liability added — net worth updated');
      }
      Router.go('/liabilities');
    });
  }

  // ---------- route handling ----------
  const AUTH_PAGES = ['login', 'signup', 'forgot', 'reset'];

  function route() {
    const parts = Router.path().replace(/^\//, '').split('/');
    const page = parts[0] || 'dashboard';
    const isAuthPage = AUTH_PAGES.includes(page);

    // auth guard: cloud mode gates data pages behind login and remembers
    // the intended destination; auth pages bounce signed-in users home
    if (Auth.enabled()) {
      if (!Auth.session && !isAuthPage) {
        Auth.setNext(Router.path());
        Router.replace('/login');
        return;
      }
      if (Auth.session && isAuthPage && page !== 'reset') {
        Router.replace('/dashboard');
        return;
      }
    }
    document.body.classList.toggle('auth-page', isAuthPage);

    // nav active state (sidebar + mobile bottom bar)
    document.querySelectorAll('[data-route]').forEach(el => {
      el.classList.toggle('active', el.dataset.route === page ||
        (el.dataset.route === 'holdings' && ['asset', 'add', 'edit'].includes(page)) ||
        (el.dataset.route === 'liabilities' && ['add-liability', 'edit-liability'].includes(page)));
    });

    switch (page) {
      case 'dashboard':
        Store.recordSnapshot(); // one honest snapshot per day, deduped
        if (celebrateNewAchievements()) { /* achieved pill renders below */ }
        view().innerHTML = Views.dashboard();
        Views.wireDashboard();
        break;
      case 'goals':
        celebrateNewAchievements();
        view().innerHTML = Views.goalsView();
        wireGoalsPage();
        break;
      case 'holdings': {
        view().innerHTML = Views.holdings(parts[1] || 'equity', highlightId);
        highlightId = null;
        break;
      }
      case 'liabilities':
        view().innerHTML = Views.liabilitiesView(highlightId);
        highlightId = null;
        break;
      case 'asset':
        view().innerHTML = Views.assetDetail(parts[1]);
        break;
      case 'projections':
        view().innerHTML = Views.projections(parseInt(parts[1], 10) || 10, parts[2] || 'net');
        break;
      case 'settings':
        view().innerHTML = Views.settings();
        break;
      case 'add':
        if (parts[1]) addEditForm(parts[1], null);
        else view().innerHTML = typePicker();
        break;
      case 'edit':
        if (parts[1]) {
          const a = Store.get(parts[1]);
          if (a) addEditForm(a.type, parts[1]);
          else view().innerHTML = '<div class="card"><div class="empty">Asset not found.</div></div>';
        }
        break;
      case 'add-liability':
        liabilityForm(null);
        break;
      case 'edit-liability':
        liabilityForm(parts[1]);
        break;
      case 'login':
        Auth.renderLogin();
        break;
      case 'signup':
        Auth.renderSignup();
        break;
      case 'forgot':
        Auth.renderForgot();
        break;
      case 'reset':
        Auth.renderReset();
        break;
      case 'account':
        Auth.renderAccount();
        break;
      default:
        view().innerHTML = Views.notFound();
    }
    window.scrollTo(0, 0);
  }

  function resetDemo() {
    if (demoBlocked()) return;
    confirmModal({
      title: 'Reset to demo portfolio?',
      body: 'This replaces all your current holdings and liabilities with the sample demo portfolio. This cannot be undone.',
      okLabel: 'Reset data',
      onOk: () => {
        Store.resetDemo();
        toast('Demo portfolio restored');
        route();
      },
    });
  }

  // C6: first-visit disclaimer — dismissed once, persisted locally
  function firstVisitDisclaimer() {
    try { if (localStorage.getItem('wf.disclaimerAck')) return; } catch (e) { return; }
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal" role="dialog" aria-label="Before you begin">
      <h3>Before you begin</h3>
      <p><b>WealthForge AI is informational, not financial advice.</b> Values are as you enter or estimate them, market prices are indicative, and every projection — bands, goal dates, insights — is an illustration built on assumptions, not a promise. Please verify important numbers with your own statements and, for decisions, a qualified adviser.</p>
      <div class="modal-actions">
        <button class="btn primary" data-ok>Got it — continue</button>
      </div>
    </div>`;
    document.body.appendChild(back);
    back.querySelector('[data-ok]').addEventListener('click', () => {
      try { localStorage.setItem('wf.disclaimerAck', new Date().toISOString()); } catch (e) { /* ignore */ }
      back.remove();
    });
  }

  async function boot() {
    initTheme();
    if (Auth.enabled()) {
      await Auth.init();
      // live rates load alongside portfolio data so the first render
      // (and its snapshot) already uses current gold/silver/FX; held
      // master securities then get their identities + real NAVs
      if (Auth.session) {
        await Promise.all([Cloud.loadAll(), Market.loadLiveRates()]);
        await Market.loadHeldQuotes(Store.all());
        Store.backfillUserHistory();
      }
    } else {
      Store.load();
    }
    Auth.applyChrome();
    Router.init(route);
    route();
    firstVisitDisclaimer();
  }

  function setHistRange(key) {
    try { localStorage.setItem('wf.histRange', key); } catch (e) { /* ignore */ }
    route();
  }

  return {
    boot, toast, confirmDelete, confirmDeleteLiability, resetDemo, setTheme, route, setHistRange,
    goalModal, confirmDeleteGoal, exportModal, setValuationMode,
  };
})();

document.addEventListener('DOMContentLoaded', UI.boot);

if (typeof globalThis !== 'undefined') globalThis.UI = UI;
