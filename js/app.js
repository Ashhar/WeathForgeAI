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

  // ---------- add / edit: grouped type picker ----------
  function typePicker() {
    const modeLabel = m => m === 'live' ? 'Live-priced' : m === 'computed' ? 'Computed' : 'Manual';
    return `
      <div class="page-head">
        <div>
          <div class="page-title">Add an asset you already own</div>
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
      <div class="picker-group-title">Liabilities</div>
      <div class="type-grid">
        <button class="type-card" onclick="Router.go('/add-liability')">
          <div class="t-ico">💳</div>
          <div class="t-name">Loan / liability</div>
          <div class="t-desc">Home, car, personal, education loans & card balances — net worth = assets − liabilities</div>
          <span class="tag computed"><span class="dot"></span>Amortized</span>
        </button>
      </div>
      <div class="disclaimer" style="margin-top:22px">💡 Have a broker / AMC / bank statement handy? Each form has a quick path — quantity, average cost, date — you can finish in seconds, and an optional detailed path (transaction lots) that unlocks true XIRR.</div>`;
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
        view().innerHTML = Views.dashboard();
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

  async function boot() {
    initTheme();
    if (Auth.enabled()) {
      await Auth.init();
      if (Auth.session) await Cloud.loadAll();
    } else {
      Store.load();
    }
    Auth.applyChrome();
    Router.init(route);
    route();
  }

  return { boot, toast, confirmDelete, confirmDeleteLiability, resetDemo, setTheme, route };
})();

document.addEventListener('DOMContentLoaded', UI.boot);

if (typeof globalThis !== 'undefined') globalThis.UI = UI;
