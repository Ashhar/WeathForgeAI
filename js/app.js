/* ============================================================
   WealthForge AI — app shell: hash router, add/edit flow,
   modals, toasts, boot.
   Routes:
     #/dashboard            #/holdings/:type      #/asset/:id
     #/add  #/add/:type     #/edit/:id            #/projections/:years?
   ============================================================ */

const UI = (() => {
  const view = () => document.getElementById('view');
  let highlightId = null; // row to flash after save

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

  // ---------- delete confirm ----------
  function confirmDelete(id) {
    const a = Store.get(id);
    if (!a) return;
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal">
      <h3>Delete “${(a.label || 'this holding').replace(/</g, '&lt;')}”?</h3>
      <p>This removes the holding from your portfolio. It doesn't touch the real asset — just this record.</p>
      <div class="modal-actions">
        <button class="btn" id="del_cancel">Cancel</button>
        <button class="btn danger" id="del_ok">Delete holding</button>
      </div>
    </div>`;
    document.body.appendChild(back);
    back.addEventListener('click', e => { if (e.target === back) back.remove(); });
    back.querySelector('#del_cancel').addEventListener('click', () => back.remove());
    back.querySelector('#del_ok').addEventListener('click', () => {
      const type = a.type;
      Store.remove(id);
      back.remove();
      toast('Holding deleted');
      location.hash = `#/holdings/${type}`;
    });
  }

  // ---------- add / edit flow ----------
  function typePicker() {
    return `
      <div class="page-head">
        <div>
          <div class="page-title">Add an asset you already own</div>
          <div class="page-sub">Step 1 — pick the asset type; the form reshapes to it. The backbone is always the same: <b>what & how much</b>, <b>what it cost</b>, and <b>when</b>.</div>
        </div>
      </div>
      <div class="type-grid">
        ${Store.TYPE_ORDER.map(k => {
          const t = Store.TYPES[k];
          return `<button class="type-card" onclick="location.hash='#/add/${k}'">
            <div class="t-ico">${t.icon}</div>
            <div class="t-name">${t.label}</div>
            <div class="t-desc">${t.desc}</div>
            <span class="tag ${t.mode}"><span class="dot"></span>${t.mode === 'live' ? 'Live-priced' : t.mode === 'computed' ? 'Computed' : 'Manual'}</span>
          </button>`;
        }).join('')}
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
    });
  }

  // ---------- router ----------
  function route() {
    const hash = location.hash || '#/dashboard';
    const parts = hash.replace(/^#\//, '').split('/');
    const page = parts[0] || 'dashboard';

    // sidebar active state
    document.querySelectorAll('.nav-item[data-route]').forEach(el => {
      el.classList.toggle('active', el.dataset.route === page ||
        (el.dataset.route === 'holdings' && (page === 'asset' || page === 'add' || page === 'edit')));
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
      case 'asset':
        view().innerHTML = Views.assetDetail(parts[1]);
        break;
      case 'projections':
        view().innerHTML = Views.projections(parseInt(parts[1], 10) || 10);
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
      default:
        view().innerHTML = Views.dashboard();
    }
    window.scrollTo(0, 0);
  }

  function resetDemo() {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal">
      <h3>Reset to demo portfolio?</h3>
      <p>This replaces all your current holdings with the sample demo portfolio. This cannot be undone.</p>
      <div class="modal-actions">
        <button class="btn" id="rd_cancel">Cancel</button>
        <button class="btn danger" id="rd_ok">Reset data</button>
      </div>
    </div>`;
    document.body.appendChild(back);
    back.addEventListener('click', e => { if (e.target === back) back.remove(); });
    back.querySelector('#rd_cancel').addEventListener('click', () => back.remove());
    back.querySelector('#rd_ok').addEventListener('click', () => {
      Store.resetDemo();
      back.remove();
      toast('Demo portfolio restored');
      route();
    });
  }

  function boot() {
    Store.load();
    window.addEventListener('hashchange', route);
    if (!location.hash) location.hash = '#/dashboard';
    route();
  }

  return { boot, toast, confirmDelete, resetDemo };
})();

document.addEventListener('DOMContentLoaded', UI.boot);
