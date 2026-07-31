/* ============================================================
   WealthForge AI — app shell: hash router, add/edit flows,
   grouped type picker, liabilities, theme toggle, modals, boot.
   Routes:
     #/dashboard              #/holdings/:type       #/asset/:id
     #/add  #/add/:type       #/edit/:id
     #/liabilities            #/add-liability        #/edit-liability/:id
     #/projections/:years?/:mode?                    #/settings
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

  function confirmDelete(id) {
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
        location.hash = `#/holdings/${type}`;
      },
    });
  }

  function confirmDeleteLiability(id) {
    const l = Store.getLiability(id);
    if (!l) return;
    confirmModal({
      title: `Delete “${(l.label || 'this liability').replace(/</g, '&lt;')}”?`,
      body: 'This removes the liability record — net worth will rise by its outstanding balance.',
      okLabel: 'Delete liability',
      onOk: () => {
        Store.removeLiability(id);
        toast('Liability deleted');
        location.hash = '#/liabilities';
        route();
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
            return `<button class="type-card" onclick="location.hash='#/add/${k}'">
              <div class="t-ico">${t.icon}</div>
              <div class="t-name">${t.label}</div>
              <div class="t-desc">${t.desc}</div>
              <span class="tag ${t.mode}"><span class="dot"></span>${modeLabel(t.mode)}</span>
            </button>`;
          }).join('')}
        </div>`).join('')}
      <div class="picker-group-title">Liabilities</div>
      <div class="type-grid">
        <button class="type-card" onclick="location.hash='#/add-liability'">
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
    if (!Store.TYPES[type]) { location.hash = '#/add'; return; }

    view().innerHTML = `
      <button class="back-link" onclick="location.hash='${editId ? `#/asset/${editId}` : '#/add'}'">← ${editId ? 'Back to asset' : 'Choose a different type'}</button>
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
      location.hash = editId ? `#/asset/${editId}` : `#/holdings/${type}`;
    });
    document.getElementById('form_save').addEventListener('click', () => {
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
      location.hash = `#/holdings/${type}`;
      route();
    });
  }

  function liabilityForm(editId) {
    const existing = editId ? Store.getLiability(editId) : null;
    if (editId && !existing) { view().innerHTML = '<div class="card"><div class="empty">Liability not found.</div></div>'; return; }

    view().innerHTML = `
      <button class="back-link" onclick="location.hash='#/liabilities'">← Back to liabilities</button>
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

    document.getElementById('form_cancel').addEventListener('click', () => { location.hash = '#/liabilities'; });
    document.getElementById('form_save').addEventListener('click', () => {
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
      location.hash = '#/liabilities';
      route();
    });
  }

  // ---------- router ----------
  function route() {
    const hash = location.hash || '#/dashboard';
    const parts = hash.replace(/^#\//, '').split('/');
    const page = parts[0] || 'dashboard';

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
      default:
        view().innerHTML = Views.dashboard();
    }
    window.scrollTo(0, 0);
  }

  function resetDemo() {
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

  function boot() {
    initTheme();
    Store.load();
    window.addEventListener('hashchange', route);
    if (!location.hash) location.hash = '#/dashboard';
    route();
  }

  return { boot, toast, confirmDelete, confirmDeleteLiability, resetDemo, setTheme, route };
})();

document.addEventListener('DOMContentLoaded', UI.boot);
