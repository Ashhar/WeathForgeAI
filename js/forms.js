/* ============================================================
   WealthForge AI — dynamic, type-driven Add/Edit asset forms
   Quick path first, progressive disclosure for identity/advanced,
   smart derivation (tenure↔maturity, amount↔units, size×rate),
   autocomplete for live-priced assets, lots/CSV entry for XIRR.
   ============================================================ */

const Forms = (() => {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const $ = id => document.getElementById(id);
  const val = id => { const e = $(id); return e ? e.value.trim() : ''; };
  const num = id => { const v = val(id); if (v === '') return null; const n = parseFloat(v); return isFinite(n) ? n : null; };
  const checked = id => { const e = $(id); return e ? e.checked : false; };

  // ---------- field builders ----------
  function txt(id, label, o = {}) {
    return `<div class="field ${o.full ? 'full' : ''}">
      <label for="${id}">${label}${o.req ? ' <span class="req">*</span>' : ''}</label>
      <input type="${o.type || 'text'}" id="${id}" value="${esc(o.value)}" placeholder="${esc(o.placeholder || '')}"
        ${o.step ? `step="${o.step}"` : ''} ${o.min != null ? `min="${o.min}"` : ''} autocomplete="off"/>
      ${o.hint ? `<div class="hint" id="${id}_hint">${o.hint}</div>` : `<div class="hint" id="${id}_hint" style="display:none"></div>`}
      <div class="err" id="${id}_err" style="display:none"></div>
    </div>`;
  }
  const numF = (id, label, o = {}) => txt(id, label, { ...o, type: 'number', step: o.step || 'any' });
  const dateF = (id, label, o = {}) => txt(id, label, { ...o, type: 'date' });

  function sel(id, label, options, o = {}) {
    return `<div class="field ${o.full ? 'full' : ''}">
      <label for="${id}">${label}${o.req ? ' <span class="req">*</span>' : ''}</label>
      <select id="${id}">${options.map(op => {
        const [v, l] = Array.isArray(op) ? op : [op, op];
        return `<option value="${esc(v)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(l)}</option>`;
      }).join('')}</select>
      ${o.hint ? `<div class="hint">${o.hint}</div>` : ''}
    </div>`;
  }

  function seg(id, label, options, value, o = {}) {
    return `<div class="field ${o.full ? 'full' : ''}">
      <label>${label}${o.req ? ' <span class="req">*</span>' : ''}</label>
      <div class="seg" id="${id}" data-value="${esc(value)}">
        ${options.map(op => {
          const [v, l] = Array.isArray(op) ? op : [op, op];
          return `<button type="button" data-v="${esc(v)}" class="${String(value) === String(v) ? 'on' : ''}">${esc(l)}</button>`;
        }).join('')}
      </div>
      ${o.hint ? `<div class="hint">${o.hint}</div>` : ''}
    </div>`;
  }
  function segVal(id) { const e = $(id); return e ? e.dataset.value : null; }
  function wireSegs(root, onChange) {
    root.querySelectorAll('.seg').forEach(sg => {
      sg.addEventListener('click', ev => {
        const b = ev.target.closest('button[data-v]');
        if (!b) return;
        sg.querySelectorAll('button').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        sg.dataset.value = b.dataset.v;
        if (onChange) onChange(sg.id, b.dataset.v);
      });
    });
  }

  function check(id, label, on, hint) {
    return `<div class="field"><label style="display:flex;align-items:center;gap:9px;cursor:pointer;margin-bottom:0">
      <input type="checkbox" id="${id}" ${on ? 'checked' : ''} style="width:15px;height:15px;accent-color:#e8b64c"/> ${label}</label>
      ${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
  }

  function setHint(id, text, derived = true) {
    const h = $(id + '_hint');
    if (!h) return;
    if (!text) { h.style.display = 'none'; return; }
    h.style.display = '';
    h.className = 'hint' + (derived ? ' derived' : '');
    h.textContent = text;
  }
  function setErr(id, text) {
    const e = $(id + '_err'), inp = $(id);
    if (!e) return;
    if (!text) { e.style.display = 'none'; if (inp) inp.classList.remove('invalid'); return; }
    e.style.display = ''; e.textContent = text;
    if (inp) inp.classList.add('invalid');
  }

  // ---------- autocomplete ----------
  function acF(id, label, o = {}) {
    return `<div class="field ${o.full ? 'full' : ''}">
      <label for="${id}">${label}${o.req ? ' <span class="req">*</span>' : ''}</label>
      <div class="autocomplete">
        <input type="text" id="${id}" value="${esc(o.value)}" placeholder="${esc(o.placeholder || 'Search…')}" autocomplete="off" data-key="${esc(o.key || '')}"/>
        <div class="ac-list" id="${id}_list" style="display:none"></div>
      </div>
      <div class="hint" id="${id}_hint" ${o.hint ? '' : 'style="display:none"'}>${o.hint || ''}</div>
      <div class="err" id="${id}_err" style="display:none"></div>
    </div>`;
  }
  function wireAc(id, searchFn, itemHtml, onPick) {
    const inp = $(id), list = $(id + '_list');
    if (!inp) return;
    function show(items) {
      if (!items.length) { list.style.display = 'none'; return; }
      list.innerHTML = items.map((it, i) => `<div class="ac-item" data-i="${i}">${itemHtml(it)}</div>`).join('');
      list.style.display = '';
      list.querySelectorAll('.ac-item').forEach(el => {
        el.addEventListener('mousedown', ev => {
          ev.preventDefault();
          const it = items[+el.dataset.i];
          onPick(it, inp);
          list.style.display = 'none';
        });
      });
    }
    inp.addEventListener('input', () => { inp.dataset.key = ''; show(searchFn(inp.value)); });
    inp.addEventListener('focus', () => show(searchFn(inp.value)));
    inp.addEventListener('blur', () => setTimeout(() => { list.style.display = 'none'; }, 150));
  }

  // ---------- lots editor (shared by equity / mf / crypto / gold units) ----------
  function lotsEditor(lots, unitLabel, priceLabel) {
    const rows = (lots && lots.length ? lots : [{}]).map((l, i) => lotRow(i, l)).join('');
    return `
      <div class="form-note">Add individual buy transactions (lump sums, SIP instalments, DCA buys). With 2+ lots the app computes a weighted-average cost and a true <b>XIRR</b>.</div>
      <table class="lots-table" id="lots_tbl">
        <thead><tr><th style="width:32%">Date</th><th style="width:30%">${esc(unitLabel)}</th><th style="width:30%">${esc(priceLabel)}</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap">
        <button type="button" class="btn sm" id="lots_add">+ Add lot</button>
        <button type="button" class="btn sm ghost" id="lots_csv_toggle">Paste CSV</button>
      </div>
      <div id="lots_csv_box" style="display:none;margin-top:10px">
        <div class="field full">
          <label>CSV rows — <code>date,quantity,price</code> (one per line, date as YYYY-MM-DD)</label>
          <textarea id="lots_csv" rows="4" placeholder="2023-01-05,10,2450.50&#10;2023-02-05,10,2512.00"></textarea>
          <div class="hint">The fast path if you have a broker/CAS statement export.</div>
        </div>
        <button type="button" class="btn sm" id="lots_csv_apply" style="margin-top:8px">Apply CSV</button>
      </div>`;
  }
  function lotRow(i, l = {}) {
    return `<tr>
      <td><input type="date" data-lot="date" value="${esc(l.date || '')}"/></td>
      <td><input type="number" step="any" data-lot="qty" value="${l.qty != null ? l.qty : ''}" placeholder="Qty"/></td>
      <td><input type="number" step="any" data-lot="price" value="${l.price != null ? l.price : ''}" placeholder="Price"/></td>
      <td><button type="button" class="rm" title="Remove">✕</button></td>
    </tr>`;
  }
  function wireLots(onChange) {
    const tbl = $('lots_tbl');
    if (!tbl) return;
    $('lots_add').addEventListener('click', () => {
      tbl.querySelector('tbody').insertAdjacentHTML('beforeend', lotRow(0));
      if (onChange) onChange();
    });
    tbl.addEventListener('click', ev => {
      if (ev.target.classList.contains('rm')) { ev.target.closest('tr').remove(); if (onChange) onChange(); }
    });
    tbl.addEventListener('input', () => { if (onChange) onChange(); });
    $('lots_csv_toggle').addEventListener('click', () => {
      const b = $('lots_csv_box');
      b.style.display = b.style.display === 'none' ? '' : 'none';
    });
    $('lots_csv_apply').addEventListener('click', () => {
      const lines = val('lots_csv').split('\n').map(l => l.trim()).filter(Boolean);
      const lots = [];
      for (const line of lines) {
        const [date, qty, price] = line.split(',').map(x => x.trim());
        if (date && qty && price && isFinite(+qty) && isFinite(+price)) lots.push({ date, qty: +qty, price: +price });
      }
      if (lots.length) {
        tbl.querySelector('tbody').innerHTML = lots.map((l, i) => lotRow(i, l)).join('');
        if (onChange) onChange();
      }
    });
  }
  function collectLots() {
    const tbl = $('lots_tbl');
    if (!tbl) return [];
    const lots = [];
    tbl.querySelectorAll('tbody tr').forEach(tr => {
      const g = k => { const e = tr.querySelector(`[data-lot="${k}"]`); return e ? e.value.trim() : ''; };
      const date = g('date'), qty = parseFloat(g('qty')), price = parseFloat(g('price'));
      if (date && isFinite(qty) && qty > 0 && isFinite(price)) lots.push({ date, qty, price });
    });
    lots.sort((a, b) => new Date(a.date) - new Date(b.date));
    return lots;
  }
  // when lots exist, auto-derive quick-path fields
  function deriveFromLots(qtyId, costId, dateId, costIsTotal) {
    const lots = collectLots();
    if (lots.length < 1) return;
    const qty = lots.reduce((s, l) => s + l.qty, 0);
    const total = lots.reduce((s, l) => s + l.qty * l.price, 0);
    if (qty > 0) {
      $(qtyId).value = +qty.toFixed(8);
      $(costId).value = +(costIsTotal ? total : total / qty).toFixed(4);
      if (!val(dateId)) $(dateId).value = lots[0].date;
      setHint(qtyId, `Derived from ${lots.length} lots`);
      setHint(costId, `Weighted average from lots — XIRR will be used`);
    }
  }

  // ---------- shared section (ownership, currency note, tags/notes) ----------
  function sharedSection(a = {}) {
    return `<details class="expander"><summary>Ownership, tags & notes</summary><div class="expander-body"><div class="form-grid">
      ${seg('f_ownership', 'Ownership', [['single', 'Single'], ['joint', 'Joint']], a.ownership || 'single',
        { hint: 'For joint holdings, net worth counts only your share.' })}
      ${numF('f_sharePct', 'Your ownership share (%)', { value: a.sharePct != null ? a.sharePct : 100, min: 1, hint: 'Used only when ownership is joint.' })}
      ${txt('f_tags', 'Tags', { value: (a.tags || []).join(', '), placeholder: 'retirement, long-term', full: false })}
      ${txt('f_notes', 'Notes', { value: a.notes || '', placeholder: 'Anything to remember about this holding', full: true })}
    </div></div></details>`;
  }
  function collectShared(base) {
    base.ownership = segVal('f_ownership') || 'single';
    base.sharePct = num('f_sharePct') != null ? num('f_sharePct') : 100;
    base.tags = val('f_tags') ? val('f_tags').split(',').map(t => t.trim()).filter(Boolean) : [];
    base.notes = val('f_notes');
    return base;
  }

  function importBand(kind) {
    return `<div class="import-band">
      <span>⚡ Fastest path: import from your ${kind}.</span>
      <button type="button" class="btn sm" data-import>Import statement / CSV</button>
    </div>`;
  }

  const modeTag = m => `<span class="tag ${m}"><span class="dot"></span>${m === 'live' ? 'Live-priced' : m === 'computed' ? 'Computed' : 'Manual'}</span>`;

  // ============================================================
  // Per-type specs
  // ============================================================
  const SPECS = {

    // ---------------- EQUITY ----------------
    equity: {
      title: 'Equity — listed shares',
      render(a) {
        const d = a.data || {};
        return `${importBand('broker statement')}
        <div class="form-grid">
          ${acF('f_symbol', 'Stock / scrip', { req: true, placeholder: 'Search RELIANCE, TCS, HDFCBANK…', value: d.symbol ? `${d.symbol}` : '', key: d.symbol || '', full: true, hint: d.symbol ? 'Live LTP linked ✓' : 'Pick from search — drives the live price (LTP).' })}
          ${numF('f_qty', 'Quantity (shares)', { req: true, value: d.quantity, min: 0 })}
          ${dateF('f_date', 'First-buy / acquisition date', { req: true, value: a.acquiredOn })}
          ${numF('f_avg', 'Average buy price (₹)', { value: d.avgPrice, hint: 'Enter this or total invested — the other is derived.' })}
          ${numF('f_total', 'Total invested (₹)', { value: d.totalInvested })}
        </div>
        <details class="expander"><summary>Add more details — lots, dividends, charges</summary><div class="expander-body">
          <div class="form-grid">
            <div class="form-section-title">Transaction lots (for accurate average & XIRR)</div>
            <div class="full">${lotsEditor(d.lots, 'Shares', 'Price / share (₹)')}</div>
            <div class="form-section-title">Identity & extras</div>
            ${txt('f_isin', 'ISIN', { value: d.isin, placeholder: 'INE002A01018' })}
            ${numF('f_dividends', 'Dividends received (₹)', { value: d.dividends, hint: 'Counted into total return.' })}
            ${numF('f_charges', 'Brokerage / charges (₹)', { value: d.charges, hint: 'Added to cost basis.' })}
            <div class="form-note full">Corporate actions (splits / bonuses) change quantity and average price — remember to update this holding when they happen.</div>
          </div>
        </div></details>
        ${sharedSection(a)}`;
      },
      wire(a) {
        wireAc('f_symbol', Market.searchStocks,
          s => `<div><div class="ac-name">${s.symbol}</div><div class="ac-sub">${s.name} · ${s.exchange}</div></div><div class="ac-price">${s.currency === 'USD' ? '$' : '₹'}${s.price.toLocaleString('en-IN')}</div>`,
          (s, inp) => {
            inp.value = s.symbol; inp.dataset.key = s.symbol;
            setHint('f_symbol', `${s.name} · ${s.exchange} · LTP ${s.currency === 'USD' ? '$' : '₹'}${s.price.toLocaleString('en-IN')}${s.currency === 'USD' ? ` (FX @ ₹${Market.FX.USDINR}/$)` : ''}`);
            setErr('f_symbol', null);
          });
        const derive = src => {
          const q = num('f_qty'), avg = num('f_avg'), tot = num('f_total');
          if (!q) return;
          if (src === 'avg' && avg != null) { $('f_total').value = +(q * avg).toFixed(2); setHint('f_total', 'Derived from qty × avg price'); setHint('f_avg', ''); }
          if (src === 'total' && tot != null) { $('f_avg').value = +(tot / q).toFixed(2); setHint('f_avg', 'Derived from total ÷ qty'); setHint('f_total', ''); }
          if (src === 'qty') { if (avg != null) { $('f_total').value = +(q * avg).toFixed(2); setHint('f_total', 'Derived from qty × avg price'); } }
        };
        $('f_avg').addEventListener('input', () => derive('avg'));
        $('f_total').addEventListener('input', () => derive('total'));
        $('f_qty').addEventListener('input', () => derive('qty'));
        wireLots(() => deriveFromLots('f_qty', 'f_avg', 'f_date', false));
      },
      collect() {
        const errors = [];
        const symbol = $('f_symbol').dataset.key || val('f_symbol').toUpperCase();
        if (!symbol) { setErr('f_symbol', 'Pick a stock from search'); errors.push('symbol'); } else setErr('f_symbol', null);
        if (symbol && !Market.getStock(symbol)) { setErr('f_symbol', 'Unknown symbol — pick one from the list'); errors.push('symbol'); }
        const quantity = num('f_qty');
        if (!quantity || quantity <= 0) { setErr('f_qty', 'Quantity is required'); errors.push('qty'); } else setErr('f_qty', null);
        const date = val('f_date');
        if (!date) { setErr('f_date', 'Acquisition date is required'); errors.push('date'); } else setErr('f_date', null);
        const avgPrice = num('f_avg'), totalInvested = num('f_total');
        if (avgPrice == null && totalInvested == null) { setErr('f_avg', 'Enter average buy price or total invested'); errors.push('cost'); } else setErr('f_avg', null);
        const lots = collectLots();
        return { errors, acquiredOn: date, data: {
          symbol, quantity, avgPrice, totalInvested,
          lots: lots.length > 1 ? lots : undefined,
          isin: val('f_isin') || undefined,
          dividends: num('f_dividends') || undefined,
          charges: num('f_charges') || undefined,
        } };
      },
    },

    // ---------------- MUTUAL FUND ----------------
    mf: {
      title: 'Mutual fund',
      render(a) {
        const d = a.data || {};
        const sch = d.schemeCode ? Market.getScheme(d.schemeCode) : null;
        return `${importBand('CAS / AMC statement')}
        <div class="form-grid">
          ${acF('f_scheme', 'Scheme', { req: true, placeholder: 'Search by name or AMFI code…', value: sch ? sch.name : '', key: d.schemeCode || '', full: true, hint: sch ? `NAV linked ✓ · ${sch.category}` : 'Search by scheme name or AMFI code — drives NAV.' })}
          ${seg('f_plan', 'Plan', [['Direct', 'Direct'], ['Regular', 'Regular']], d.plan || 'Direct', { req: true, hint: 'Direct vs Regular changes NAV and returns.' })}
          ${seg('f_option', 'Option', [['Growth', 'Growth'], ['IDCW', 'IDCW']], d.option || 'Growth', { req: true })}
          ${numF('f_units', 'Units held', { value: d.units, hint: 'Enter units or amount invested — the other derives via NAV.' })}
          ${numF('f_amount', 'Amount invested (₹)', { value: d.totalInvested })}
          ${numF('f_avgnav', 'Average cost NAV (₹)', { value: d.avgNav, hint: 'From your statement; used to derive units ↔ amount.' })}
          ${dateF('f_date', 'First investment date', { req: true, value: a.acquiredOn })}
        </div>
        <details class="expander"><summary>Add more details — SIP, transactions, folio</summary><div class="expander-body">
          <div class="form-grid">
            <div class="form-section-title">SIP</div>
            ${check('f_sip', 'Ongoing SIP in this scheme', d.sipOngoing, 'Used for XIRR and to project future contributions.')}
            ${numF('f_sipamt', 'SIP amount (₹ / instalment)', { value: d.sipAmount })}
            ${sel('f_sipfreq', 'SIP frequency', [['monthly', 'Monthly'], ['weekly', 'Weekly'], ['quarterly', 'Quarterly']], { value: d.sipFreq || 'monthly' })}
            <div class="form-section-title">Transaction history (for true XIRR)</div>
            <div class="full">${lotsEditor(d.lots, 'Units', 'NAV (₹)')}</div>
            <div class="form-section-title">Identity</div>
            ${txt('f_folio', 'Folio number', { value: d.folio })}
            <div class="form-note full">ELSS schemes carry a 3-year lock-in per instalment; liquid/debt funds may have exit loads. The scheme's category drives how wide its projection band is drawn.</div>
          </div>
        </div></details>
        ${sharedSection(a)}`;
      },
      wire(a) {
        wireAc('f_scheme', Market.searchSchemes,
          s => `<div><div class="ac-name">${s.name}</div><div class="ac-sub">${s.amc} · ${s.sub} · ${s.code}</div></div><div class="ac-price">₹${s.nav.toLocaleString('en-IN')}</div>`,
          (s, inp) => {
            inp.value = s.name; inp.dataset.key = s.code;
            setHint('f_scheme', `${s.amc} · ${s.sub} (${s.category}) · NAV ₹${s.nav}${s.elss ? ' · ELSS 3-yr lock-in' : ''}`);
            setErr('f_scheme', null);
            derive('any');
          });
        const derive = src => {
          const u = num('f_units'), amt = num('f_amount'), anav = num('f_avgnav');
          if (anav != null && anav > 0) {
            if ((src === 'amount' || (src === 'any' && u == null)) && amt != null) {
              $('f_units').value = +(amt / anav).toFixed(4);
              setHint('f_units', 'Derived: amount ÷ avg NAV');
            } else if ((src === 'units' || src === 'any') && u != null) {
              $('f_amount').value = +(u * anav).toFixed(2);
              setHint('f_amount', 'Derived: units × avg NAV');
            }
          }
        };
        $('f_amount').addEventListener('input', () => derive('amount'));
        $('f_units').addEventListener('input', () => derive('units'));
        $('f_avgnav').addEventListener('input', () => derive('any'));
        wireLots(() => deriveFromLots('f_units', 'f_avgnav', 'f_date', false));
      },
      collect() {
        const errors = [];
        const code = $('f_scheme').dataset.key;
        if (!code || !Market.getScheme(code)) { setErr('f_scheme', 'Pick a scheme from search'); errors.push('scheme'); } else setErr('f_scheme', null);
        const units = num('f_units'), amount = num('f_amount'), avgNav = num('f_avgnav');
        if (units == null && amount == null) { setErr('f_units', 'Enter units or amount invested'); errors.push('units'); } else setErr('f_units', null);
        const date = val('f_date');
        if (!date) { setErr('f_date', 'First investment date is required'); errors.push('date'); } else setErr('f_date', null);
        const lots = collectLots();
        let u = units, invested = amount;
        if (u == null && amount != null && avgNav) u = amount / avgNav;
        if (invested == null && u != null && avgNav) invested = u * avgNav;
        if (u == null) { setErr('f_units', 'Cannot derive units — enter units, or amount + avg NAV'); errors.push('units'); }
        return { errors, acquiredOn: date, data: {
          schemeCode: code, plan: segVal('f_plan'), option: segVal('f_option'),
          units: u, avgNav: avgNav || (invested && u ? invested / u : undefined), totalInvested: invested,
          sipOngoing: checked('f_sip'), sipAmount: num('f_sipamt') || undefined, sipFreq: val('f_sipfreq') || undefined,
          lots: lots.length > 1 ? lots : undefined,
          folio: val('f_folio') || undefined,
        } };
      },
    },

    // ---------------- FIXED DEPOSIT ----------------
    fd: {
      title: 'Fixed deposit',
      render(a) {
        const d = a.data || {};
        return `${importBand('bank FD advice')}
        <div class="form-note" style="margin-bottom:16px">An FD is an immutable contract — its rate and tenure were locked when you booked it, so enter <b>this FD's own terms</b>, not today's rates.</div>
        <div class="form-grid">
          ${numF('f_principal', 'Principal / deposit amount (₹)', { req: true, value: d.principal, min: 0 })}
          ${numF('f_rate', 'Interest rate (% p.a., locked at booking)', { req: true, value: d.rate, step: '0.01' })}
          ${dateF('f_start', 'Start / booking date', { req: true, value: d.startDate || a.acquiredOn })}
          ${numF('f_tenure', 'Tenure (years)', { value: d.tenureYears, step: '0.01', hint: 'Enter tenure or maturity date — the other is derived.' })}
          ${dateF('f_maturity', 'Maturity date', { value: d.maturityDate || '' })}
          ${sel('f_comp', 'Compounding', [['quarterly', 'Quarterly (Indian bank standard)'], ['monthly', 'Monthly'], ['half-yearly', 'Half-yearly'], ['annual', 'Annual'], ['simple', 'Simple interest']], { value: d.compounding || 'quarterly' })}
          ${seg('f_inttype', 'Interest type', [['cumulative', 'Cumulative (reinvests)'], ['payout', 'Non-cumulative (payout)']], d.interestType || 'cumulative', { full: true, hint: 'Cumulative grows to maturity; payout FDs pay interest out periodically and stay ≈ principal.' })}
        </div>
        <details class="expander"><summary>Add more details — bank, renewal, tax</summary><div class="expander-body">
          <div class="form-grid">
            <div class="form-section-title">Identity</div>
            ${txt('f_bank', 'Bank / institution', { value: d.bank, placeholder: 'HDFC Bank' })}
            ${sel('f_insttype', 'Institution type', [['bank', 'Bank'], ['nbfc', 'NBFC'], ['post-office', 'Post office']], { value: d.institutionType || 'bank', hint: 'NBFC & post-office FDs can differ in rates/compounding.' })}
            ${txt('f_fdno', 'FD / receipt number', { value: d.fdNumber })}
            <div class="form-section-title">Advanced</div>
            ${sel('f_payoutfreq', 'Payout frequency (non-cumulative only)', [['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['half-yearly', 'Half-yearly'], ['annual', 'Annual']], { value: d.payoutFreq || 'quarterly' })}
            ${sel('f_renew', 'Auto-renewal at maturity', [['none', 'No auto-renew'], ['principal', 'Renew principal only'], ['principal_interest', 'Renew principal + interest']], { value: d.autoRenew || 'none' })}
            ${sel('f_status', 'Status', [['active', 'Active'], ['matured', 'Matured'], ['closed', 'Closed'], ['premature', 'Prematurely withdrawn']], { value: d.status || 'active' })}
            ${numF('f_penalty', 'Premature-withdrawal penalty (% on rate)', { value: d.penaltyRate, step: '0.01' })}
            ${check('f_taxsaver', 'Tax-saver FD (5-yr 80C lock-in)', d.taxSaver, 'Cannot be broken before 5 years.')}
            ${check('f_senior', 'Senior-citizen rate', d.seniorRate, 'Informational — usually already included in the entered rate.')}
            ${check('f_tds', 'Show values pre-TDS', d.tds !== false, 'Quoted maturity values are pre-TDS; thresholds change with the budget.')}
          </div>
        </div></details>
        ${sharedSection(a)}`;
      },
      wire(a) {
        const derive = src => {
          const start = val('f_start');
          if (!start) return;
          if (src === 'tenure') {
            const t = num('f_tenure');
            if (t != null && t > 0) {
              $('f_maturity').value = Fin.addYears(start, t).toISOString().slice(0, 10);
              setHint('f_maturity', 'Derived from start + tenure'); setHint('f_tenure', '');
            }
          } else if (src === 'maturity') {
            const m = val('f_maturity');
            if (m) {
              $('f_tenure').value = +Fin.fdTenureYears(start, m).toFixed(2);
              setHint('f_tenure', 'Derived from maturity − start'); setHint('f_maturity', '');
            }
          }
          preview();
        };
        const preview = () => {
          const p = num('f_principal'), r = num('f_rate'), t = num('f_tenure');
          if (p && r != null && t) {
            const mv = segVal('f_inttype') === 'payout' ? p : Fin.fdValue(p, r, t, val('f_comp'));
            setHint('f_principal', `Maturity value ≈ ${Fin.fmtINR(mv)}${segVal('f_inttype') === 'payout' ? ' (+ periodic interest payouts)' : ''}`);
          }
        };
        $('f_tenure').addEventListener('input', () => derive('tenure'));
        $('f_maturity').addEventListener('input', () => derive('maturity'));
        $('f_start').addEventListener('input', () => derive(val('f_maturity') ? 'maturity' : 'tenure'));
        ['f_principal', 'f_rate', 'f_comp'].forEach(id => $(id).addEventListener('input', preview));
        wireSegs(document.getElementById('form_body'), preview);
        preview();
      },
      collect() {
        const errors = [];
        const principal = num('f_principal');
        if (!principal || principal <= 0) { setErr('f_principal', 'Principal is required'); errors.push('p'); } else setErr('f_principal', null);
        const rate = num('f_rate');
        if (rate == null || rate <= 0) { setErr('f_rate', 'Interest rate is required'); errors.push('r'); } else setErr('f_rate', null);
        const start = val('f_start');
        if (!start) { setErr('f_start', 'Start date is required'); errors.push('s'); } else setErr('f_start', null);
        let tenure = num('f_tenure');
        const maturity = val('f_maturity');
        if (tenure == null && maturity && start) tenure = Fin.fdTenureYears(start, maturity);
        if (!tenure || tenure <= 0) { setErr('f_tenure', 'Enter tenure or a maturity date'); errors.push('t'); } else setErr('f_tenure', null);
        return { errors, acquiredOn: start, data: {
          principal, rate, startDate: start, tenureYears: tenure,
          maturityDate: maturity || (start && tenure ? Fin.addYears(start, tenure).toISOString().slice(0, 10) : undefined),
          compounding: val('f_comp'), interestType: segVal('f_inttype'),
          bank: val('f_bank') || undefined, institutionType: val('f_insttype'),
          fdNumber: val('f_fdno') || undefined,
          payoutFreq: val('f_payoutfreq'), autoRenew: val('f_renew'), status: val('f_status'),
          penaltyRate: num('f_penalty') || undefined,
          taxSaver: checked('f_taxsaver'), seniorRate: checked('f_senior'), tds: checked('f_tds'),
        } };
      },
    },

    // ---------------- GOLD / SILVER ----------------
    gold: {
      title: 'Gold & silver',
      render(a) {
        const d = a.data || {};
        const form = d.form || 'physical';
        return `${importBand('purchase invoice / demat statement')}
        <div class="form-grid">
          ${seg('f_metal', 'Metal', [['gold', 'Gold'], ['silver', 'Silver']], d.metal || 'gold', { req: true })}
          ${seg('f_form', 'Form', [['physical', 'Physical'], ['digital', 'Digital'], ['sgb', 'SGB'], ['etf', 'ETF / fund']], form, { req: true, full: true, hint: 'Form decides the valuation mode — capture it first.' })}
          <div class="full" id="gold_dyn"></div>
        </div>
        <div id="gold_adv"></div>
        ${sharedSection(a)}`;
      },
      wire(a) {
        const d = a.data || {};
        const renderDyn = () => {
          const form = segVal('f_form'), metal = segVal('f_metal');
          const m = Market.metalRate(metal);
          const isUnits = form === 'etf' || form === 'sgb';
          $('gold_dyn').innerHTML = `<div class="form-grid">
            ${isUnits ? `
              ${form === 'sgb'
                ? txt('f_instr', 'SGB issue / series', { value: d.instrumentId === 'SGB2027' ? 'SGB 2019-20 Series IV (2027)' : (d.sgbIssue || ''), placeholder: 'e.g. SGB 2023-24 Series II', full: true, hint: 'Valued at the current gold price per unit.' })
                : txt('f_instr', 'ETF / fund name', { value: d.instrumentId === 'GOLDBEES' ? 'Nippon Gold BeES ETF' : (d.etfName || ''), placeholder: 'e.g. Nippon Gold BeES', full: true })}
              ${numF('f_units', 'Units held', { req: true, value: d.units, step: 'any' })}
              ${numF('f_buyprice', 'Buy price / unit (₹)', { value: d.buyPrice, hint: 'Or enter total paid.' })}
            ` : `
              ${numF('f_grams', 'Weight (grams)', { req: true, value: d.grams, step: 'any' })}
              ${form === 'physical' ? sel('f_purity', 'Purity', [['24K', '24K (999)'], ['22K', '22K (916) — jewellery standard'], ['18K', '18K (750)']], { value: d.purity || '22K', hint: 'Metal is quoted at 24K/999 — value adjusts for purity.' }) : ''}
              ${numF('f_buyrate', 'Rate at purchase (₹/gram)', { value: d.buyRate, hint: 'Or enter total paid.' })}
            `}
            ${numF('f_totalpaid', 'Total paid (₹)', { value: d.totalPaid })}
            ${dateF('f_date', 'Purchase date', { req: true, value: a.acquiredOn })}
            ${form === 'sgb' ? numF('f_sgbrate', 'SGB fixed interest (% p.a.)', { value: d.sgbRate != null ? d.sgbRate : 2.5, step: '0.1', hint: 'Paid on issue price, over metal appreciation.' }) : ''}
            ${form === 'sgb' ? dateF('f_sgbmat', 'SGB maturity date (8 years)', { value: d.sgbMaturity }) : ''}
            ${m && !isUnits ? `<div class="form-note full">Current ${metal} rate: <b>₹${m.perGram.toLocaleString('en-IN')}/g</b> (${m.label}).</div>` : ''}
          </div>`;
          $('gold_adv').innerHTML = form === 'physical' ? `
            <details class="expander"><summary>Add more details — making charges, storage</summary><div class="expander-body"><div class="form-grid">
              ${numF('f_making', 'Making charges (₹)', { value: d.makingCharges, hint: 'Non-recoverable — included in your cost, excluded from resale value, so jewellery returns trail the metal.' })}
              ${txt('f_storage', 'Storage / insurance notes', { value: d.storageNotes, full: true, placeholder: 'Bank locker #…, insured with…' })}
            </div></div></details>` : '';
          const der = () => {
            if (isUnits) {
              const u = num('f_units'), bp = num('f_buyprice'), tp = num('f_totalpaid');
              if (u && bp != null && tp == null) { $('f_totalpaid').value = +(u * bp).toFixed(2); setHint('f_totalpaid', 'Derived: units × buy price'); }
            } else {
              const g = num('f_grams'), br = num('f_buyrate'), tp = num('f_totalpaid');
              if (g && br != null && tp == null) { $('f_totalpaid').value = +(g * br).toFixed(2); setHint('f_totalpaid', 'Derived: grams × rate'); }
            }
          };
          ['f_units', 'f_buyprice', 'f_grams', 'f_buyrate'].forEach(id => { const e = $(id); if (e) e.addEventListener('input', der); });
        };
        wireSegs(document.getElementById('form_body'), (id) => { if (id === 'f_form' || id === 'f_metal') renderDyn(); });
        renderDyn();
      },
      collect() {
        const errors = [];
        const form = segVal('f_form'), metal = segVal('f_metal');
        const isUnits = form === 'etf' || form === 'sgb';
        const date = val('f_date');
        if (!date) { setErr('f_date', 'Purchase date is required'); errors.push('date'); } else setErr('f_date', null);
        const data = { metal, form };
        if (isUnits) {
          data.units = num('f_units');
          if (!data.units || data.units <= 0) { setErr('f_units', 'Units are required'); errors.push('units'); } else setErr('f_units', null);
          data.buyPrice = num('f_buyprice') || undefined;
          const name = val('f_instr');
          if (form === 'sgb') { data.sgbIssue = name; data.sgbRate = num('f_sgbrate') != null ? num('f_sgbrate') : 2.5; data.sgbMaturity = val('f_sgbmat') || undefined; }
          else data.etfName = name;
          // resolve to a priced instrument when it matches, else keep manual price
          const u = Market.GOLD_UNITS.find(g => name && name.toLowerCase().includes(g.id.toLowerCase().slice(0, 4)) || (g.kind === form));
          data.instrumentId = (u && u.kind === form) ? u.id : undefined;
          if (!data.instrumentId) data.lastUnitPrice = num('f_buyprice') || 0;
        } else {
          data.grams = num('f_grams');
          if (!data.grams || data.grams <= 0) { setErr('f_grams', 'Weight is required'); errors.push('g'); } else setErr('f_grams', null);
          data.purity = form === 'physical' ? val('f_purity') : '24K';
          data.buyRate = num('f_buyrate') || undefined;
          if (form === 'physical') {
            data.makingCharges = num('f_making') || undefined;
            data.storageNotes = val('f_storage') || undefined;
          }
        }
        data.totalPaid = num('f_totalpaid') != null ? num('f_totalpaid') : undefined;
        if (data.totalPaid == null && data.buyRate == null && data.buyPrice == null) {
          setErr('f_totalpaid', 'Enter total paid, or the purchase rate/price'); errors.push('cost');
        } else setErr('f_totalpaid', null);
        return { errors, acquiredOn: date, data };
      },
    },

    // ---------------- REAL ESTATE ----------------
    realestate: {
      title: 'Real estate',
      render(a) {
        const d = a.data || {};
        return `<div class="form-grid">
          ${sel('f_ptype', 'Property type', [['residential', 'Residential'], ['commercial', 'Commercial'], ['land', 'Land'], ['plot', 'Plot']], { value: d.propertyType || 'residential', req: true })}
          ${dateF('f_date', 'Purchase date', { req: true, value: a.acquiredOn })}
          ${numF('f_price', 'Purchase price (₹)', { req: true, value: d.purchasePrice, hint: 'Your cost basis.' })}
          ${numF('f_current', 'Current estimated value (₹)', { req: true, value: d.currentValue, hint: 'Your estimate — no live feed exists for property.' })}
          ${dateF('f_revalued', 'Last revalued on', { value: d.lastRevaluedOn || Fin.todayISO() })}
          ${numF('f_apprate', 'Assumed annual appreciation (%)', { req: true, value: d.appreciationRate != null ? d.appreciationRate : 6, step: '0.1', hint: 'Drives the projection. Editable any time.' })}
        </div>
        <details class="expander"><summary>Add more details — location, size, loan, rent</summary><div class="expander-body">
          <div class="form-grid">
            <div class="form-section-title">Location & size</div>
            ${txt('f_city', 'City', { value: d.city, placeholder: 'Bengaluru' })}
            ${txt('f_locality', 'Locality', { value: d.locality, placeholder: 'Whitefield' })}
            ${numF('f_sqft', 'Size (sq ft)', { value: d.sqft })}
            ${numF('f_ratesqft', 'Rate per sq ft (₹)', { value: d.ratePerSqft, hint: 'Size × rate is an alternate estimate of current value.' })}
            <div class="form-section-title">Loan & income</div>
            ${numF('f_loan', 'Outstanding home loan (₹)', { value: d.loanBalance, hint: 'Net worth counts value − loan (net equity).' })}
            ${numF('f_emi', 'EMI (₹/month)', { value: d.loanEmi })}
            ${numF('f_loanrate', 'Loan rate (% p.a.)', { value: d.loanRate, step: '0.01' })}
            ${numF('f_rent', 'Rental income (₹/month)', { value: d.rentPerMonth, hint: 'For yield and total return.' })}
            <div class="form-section-title">Costs</div>
            ${numF('f_acqcosts', 'Acquisition costs (stamp duty, registration) (₹)', { value: d.acquisitionCosts, hint: 'Added to cost basis.' })}
          </div>
        </div></details>
        ${sharedSection(a)}
        <div class="disclaimer" style="margin-top:16px">⚠️ This value is <b>your estimate</b> and the projection is <b>illustrative, not financial advice</b>. Revalue the property periodically.</div>`;
      },
      wire() {
        const der = () => {
          const s = num('f_sqft'), r = num('f_ratesqft');
          if (s && r) setHint('f_current', `Size × rate suggests ${Fin.fmtINR(s * r)} — tap to use`, true);
        };
        ['f_sqft', 'f_ratesqft'].forEach(id => $(id).addEventListener('input', der));
        $('f_current_hint').addEventListener('click', () => {
          const s = num('f_sqft'), r = num('f_ratesqft');
          if (s && r) { $('f_current').value = s * r; setHint('f_current', 'Derived from size × rate'); }
        });
      },
      collect() {
        const errors = [];
        const price = num('f_price');
        if (!price) { setErr('f_price', 'Purchase price is required'); errors.push('p'); } else setErr('f_price', null);
        const current = num('f_current');
        if (!current) { setErr('f_current', 'Current estimated value is required'); errors.push('c'); } else setErr('f_current', null);
        const date = val('f_date');
        if (!date) { setErr('f_date', 'Purchase date is required'); errors.push('d'); } else setErr('f_date', null);
        const appr = num('f_apprate');
        if (appr == null) { setErr('f_apprate', 'Appreciation rate is required'); errors.push('a'); } else setErr('f_apprate', null);
        return { errors, acquiredOn: date, data: {
          propertyType: val('f_ptype'), purchasePrice: price, currentValue: current,
          lastRevaluedOn: val('f_revalued') || Fin.todayISO(), appreciationRate: appr,
          city: val('f_city') || undefined, locality: val('f_locality') || undefined,
          sqft: num('f_sqft') || undefined, ratePerSqft: num('f_ratesqft') || undefined,
          loanBalance: num('f_loan') || undefined, loanEmi: num('f_emi') || undefined, loanRate: num('f_loanrate') || undefined,
          rentPerMonth: num('f_rent') || undefined, acquisitionCosts: num('f_acqcosts') || undefined,
        } };
      },
    },

    // ---------------- CRYPTO ----------------
    crypto: {
      title: 'Crypto',
      render(a) {
        const d = a.data || {};
        return `${importBand('exchange CSV')}
        <div class="form-grid">
          ${acF('f_coin', 'Coin / token', { req: true, placeholder: 'Search BTC, ETH, SOL…', value: d.coinId || '', key: d.coinId || '', full: true, hint: d.coinId ? 'Live price linked ✓' : 'Pick from search — drives the live price.' })}
          ${numF('f_qty', 'Quantity held', { req: true, value: d.quantity, step: 'any', hint: 'Fractional quantities to 8 decimals are fine.' })}
          ${seg('f_ccy', 'Purchase currency', [['USD', 'USD'], ['INR', 'INR']], d.investCurrency || 'USD', { hint: `Values convert to ₹ at ${Market.FX.USDINR}/$ (FX note).` })}
          ${dateF('f_date', 'First-buy date', { req: true, value: a.acquiredOn })}
          ${numF('f_avg', 'Average buy price (per coin)', { value: d.avgPrice, hint: 'In the purchase currency. Or enter total invested.' })}
          ${numF('f_total', 'Total invested', { value: d.totalInvested })}
        </div>
        <details class="expander"><summary>Add more details — lots, wallet, staking</summary><div class="expander-body">
          <div class="form-grid">
            <div class="form-section-title">Transaction lots (DCA → true XIRR)</div>
            <div class="full">${lotsEditor(d.lots, 'Quantity', 'Price / coin')}</div>
            <div class="form-section-title">Extras</div>
            ${txt('f_wallet', 'Exchange / wallet label', { value: d.wallet, placeholder: 'Coinbase, Ledger…' })}
            ${numF('f_staking', 'Staking / yield (% p.a.)', { value: d.stakingYield, step: '0.1' })}
          </div>
        </div></details>
        ${sharedSection(a)}
        <div class="disclaimer" style="margin-top:16px">⚠️ Crypto is extremely volatile. The projection band is <b>very wide by design</b> and is illustrative — not a forecast, not financial advice.</div>`;
      },
      wire(a) {
        wireAc('f_coin', Market.searchCoins,
          c => `<div><div class="ac-name">${c.id}</div><div class="ac-sub">${c.name}${c.stable ? ' · stablecoin' : ''}</div></div><div class="ac-price">$${c.priceUSD.toLocaleString('en-US')}</div>`,
          (c, inp) => {
            inp.value = c.id; inp.dataset.key = c.id;
            setHint('f_coin', `${c.name} · $${c.priceUSD.toLocaleString('en-US')} · ≈ ${Fin.fmtINR(c.priceUSD * Market.FX.USDINR)} (FX @ ₹${Market.FX.USDINR}/$)${c.stable ? ' · stablecoin, projects ≈ flat' : ''}`);
            setErr('f_coin', null);
          });
        const derive = src => {
          const q = num('f_qty'), avg = num('f_avg'), tot = num('f_total');
          if (!q) return;
          if (src === 'avg' && avg != null) { $('f_total').value = +(q * avg).toFixed(2); setHint('f_total', 'Derived from qty × avg'); }
          if (src === 'total' && tot != null) { $('f_avg').value = +(tot / q).toFixed(2); setHint('f_avg', 'Derived from total ÷ qty'); }
        };
        $('f_avg').addEventListener('input', () => derive('avg'));
        $('f_total').addEventListener('input', () => derive('total'));
        wireLots(() => deriveFromLots('f_qty', 'f_avg', 'f_date', false));
      },
      collect() {
        const errors = [];
        const coinId = $('f_coin').dataset.key || val('f_coin').toUpperCase();
        if (!coinId || !Market.getCoin(coinId)) { setErr('f_coin', 'Pick a coin from search'); errors.push('coin'); } else setErr('f_coin', null);
        const quantity = num('f_qty');
        if (!quantity || quantity <= 0) { setErr('f_qty', 'Quantity is required'); errors.push('q'); } else setErr('f_qty', null);
        const date = val('f_date');
        if (!date) { setErr('f_date', 'First-buy date is required'); errors.push('d'); } else setErr('f_date', null);
        const avgPrice = num('f_avg'), totalInvested = num('f_total');
        if (avgPrice == null && totalInvested == null) { setErr('f_avg', 'Enter average buy price or total invested'); errors.push('c'); } else setErr('f_avg', null);
        const lots = collectLots();
        const c = Market.getCoin(coinId);
        return { errors, acquiredOn: date, data: {
          coinId, quantity, avgPrice, totalInvested, investCurrency: segVal('f_ccy') || 'USD',
          lots: lots.length > 1 ? lots : undefined,
          wallet: val('f_wallet') || undefined, stakingYield: num('f_staking') || undefined,
          stable: c ? !!c.stable : undefined,
        } };
      },
    },

    // ---------------- OTHERS ----------------
    other: {
      title: 'Other asset',
      render(a) {
        const d = a.data || {};
        return `<div class="form-grid">
          ${txt('f_name', 'Asset name', { req: true, value: a.label, placeholder: 'Honda City / PPF / Painting…', full: true })}
          ${seg('f_pattern', 'Behaves like', [['appreciating', 'Appreciating / illiquid'], ['depreciating', 'Depreciating'], ['fixedincome', 'Fixed-income-like']], d.subPattern || 'appreciating', { req: true, full: true, hint: 'Appreciating: art, collectibles. Depreciating: vehicles. Fixed-income: PPF / EPF / NPS / bonds.' })}
          ${txt('f_subtype', 'Sub-type', { value: d.subType, placeholder: 'Vehicle, Art, PPF, Bond…' })}
          ${dateF('f_date', 'Acquisition date', { req: true, value: a.acquiredOn })}
          ${numF('f_cost', 'Cost basis / contributions (₹)', { req: true, value: d.costBasis })}
          <div class="full" id="other_dyn"></div>
        </div>
        ${sharedSection(a)}
        <div class="disclaimer" style="margin-top:16px" id="other_disc">⚠️ Manual estimates and assumed rates are yours — the projection is illustrative, not financial advice.</div>`;
      },
      wire(a) {
        const d = a.data || {};
        const renderDyn = () => {
          const p = segVal('f_pattern');
          if (p === 'fixedincome') {
            $('other_dyn').innerHTML = `<div class="form-grid">
              ${numF('f_rate', 'Interest / growth rate (% p.a.)', { req: true, value: d.growthRate != null ? d.growthRate : 7.1, step: '0.01', hint: 'e.g. PPF 7.1%, EPF 8.25%' })}
              ${numF('f_tenure2', 'Tenure / maturity (years from start)', { value: d.tenureYears != null ? d.tenureYears : 15, step: '0.5' })}
              <div class="form-note full">Valued like a contract: deterministic compounding of your contributions at the entered rate. No Monte Carlo.</div>
            </div>`;
          } else {
            const defRate = p === 'depreciating' ? -12 : 5;
            $('other_dyn').innerHTML = `<div class="form-grid">
              ${seg('f_valmethod', 'Valuation method', [['manual', 'Manual estimate'], ['rate', 'Rate-based']], d.valuationMethod || 'rate', { hint: "Manual: you enter today's value. Rate-based: cost grows/shrinks at the assumed rate." })}
              ${numF('f_rate', `Assumed annual ${p === 'depreciating' ? 'depreciation' : 'growth'} rate (%)`, { req: true, value: d.growthRate != null ? d.growthRate : defRate, step: '0.1', hint: p === 'depreciating' ? 'Negative — e.g. −12% for cars.' : 'Can be negative.' })}
              ${numF('f_currentval', 'Current value (₹, manual estimate)', { value: d.currentValue, hint: 'Used when valuation is manual.' })}
              ${dateF('f_revalued2', 'Last revalued on', { value: d.lastRevaluedOn || Fin.todayISO() })}
            </div>`;
            wireSegs($('other_dyn'));
          }
        };
        wireSegs(document.getElementById('form_body'), id => { if (id === 'f_pattern') renderDyn(); });
        renderDyn();
      },
      collect() {
        const errors = [];
        const name = val('f_name');
        if (!name) { setErr('f_name', 'Asset name is required'); errors.push('n'); } else setErr('f_name', null);
        const cost = num('f_cost');
        if (cost == null) { setErr('f_cost', 'Cost basis is required'); errors.push('c'); } else setErr('f_cost', null);
        const date = val('f_date');
        if (!date) { setErr('f_date', 'Acquisition date is required'); errors.push('d'); } else setErr('f_date', null);
        const pattern = segVal('f_pattern');
        const data = {
          subPattern: pattern, subType: val('f_subtype') || undefined, costBasis: cost,
          growthRate: num('f_rate'),
        };
        if (pattern === 'fixedincome') {
          data.tenureYears = num('f_tenure2') || 15;
          if (data.growthRate == null) { setErr('f_rate', 'Rate is required'); errors.push('r'); }
        } else {
          data.valuationMethod = segVal('f_valmethod') || 'rate';
          data.currentValue = num('f_currentval') != null ? num('f_currentval') : undefined;
          data.lastRevaluedOn = val('f_revalued2') || undefined;
          if (data.valuationMethod === 'manual' && data.currentValue == null) {
            setErr('f_currentval', 'Enter a current value, or switch to rate-based'); errors.push('cv');
          }
          if (data.growthRate == null) { setErr('f_rate', 'Assumed rate is required (can be negative)'); errors.push('r'); }
        }
        return { errors, acquiredOn: date, data, labelOverride: name };
      },
    },
  };

  // ---------- public API ----------
  function render(container, type, asset) {
    const spec = SPECS[type];
    const a = asset || { data: {} };
    const t = Store.TYPES[type];
    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <span style="font-size:22px">${t.icon}</span>
        <h2 style="font-size:18px">${asset ? 'Edit' : 'Add'} — ${spec.title}</h2>
        ${modeTag(t.mode)}
      </div>
      <p class="dim small" style="margin-bottom:18px">${t.mode === 'live' ? 'Current value comes from a market feed; projection uses a Monte Carlo band.' : t.mode === 'computed' ? 'Current value is computed from locked contract terms; projection is a single contractual curve.' : 'Current value is your estimate; projection compounds at your assumed rate.'}</p>
      <div class="field" style="margin-bottom:16px">
        <label for="f_label">Label / nickname <span class="dim">(optional — tell similar holdings apart)</span></label>
        <input type="text" id="f_label" value="${esc(a.label || '')}" placeholder="e.g. 'Retirement SIP', 'Mom's FD'"/>
      </div>
      <div id="form_body">${spec.render(a)}</div>`;
    wireSegs(container);
    spec.wire(a);
    container.querySelectorAll('[data-import]').forEach(b => b.addEventListener('click', () => {
      UI.toast('Statement import is on the roadmap — use "Paste CSV" under lots for now.');
    }));
  }

  function collect(type) {
    const spec = SPECS[type];
    const res = spec.collect();
    if (res.errors.length) return { ok: false };
    let base = {
      type,
      label: res.labelOverride || val('f_label') || undefined,
      acquiredOn: res.acquiredOn,
      currency: type === 'crypto' ? 'USD' : 'INR',
      data: res.data,
    };
    base = collectShared(base);
    if (!base.label) base.label = defaultLabel(type, res.data);
    return { ok: true, asset: base };
  }

  function defaultLabel(type, d) {
    switch (type) {
      case 'equity': return d.symbol;
      case 'mf': { const s = Market.getScheme(d.schemeCode); return s ? s.name : 'Mutual fund'; }
      case 'fd': return `${d.bank || 'FD'} · ${d.rate}%`;
      case 'gold': return d.form === 'sgb' ? (d.sgbIssue || 'SGB') : d.form === 'etf' ? (d.etfName || 'Gold ETF') : `${d.metal === 'silver' ? 'Silver' : 'Gold'} (${d.form})`;
      case 'realestate': return `${d.propertyType || 'Property'}${d.city ? ', ' + d.city : ''}`;
      case 'crypto': return d.coinId;
      default: return 'Asset';
    }
  }

  return { render, collect };
})();
