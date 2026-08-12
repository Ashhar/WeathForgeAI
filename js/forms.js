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
    // search may be async (cloud master search); guard against stale results
    let seq = 0, debounce = null;
    const run = async () => {
      const my = ++seq;
      try {
        const items = await Promise.resolve(searchFn(inp.value));
        if (my === seq && document.getElementById(id) === inp) show(items || []);
      } catch (e) { /* search failed — keep the list as-is */ }
    };
    inp.addEventListener('input', () => {
      inp.dataset.key = '';
      clearTimeout(debounce);
      debounce = setTimeout(run, 180);
    });
    inp.addEventListener('focus', run);
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
          <label>CSV rows — <code>date,quantity,price</code> (one per line; dates as YYYY-MM-DD or DD-MM-YYYY)</label>
          <textarea id="lots_csv" rows="4" placeholder="2023-01-05,10,2450.50&#10;2023-02-05,10,2512.00"></textarea>
          <div class="hint">The fast path if you have a broker/CAS statement export. Rows append to the table above.</div>
          <div class="err" id="lots_csv_err" style="display:none" role="alert"></div>
        </div>
        <button type="button" class="btn sm" id="lots_csv_apply" style="margin-top:8px">Apply CSV</button>
      </div>`;
  }
  function lotRow(i, l = {}) {
    return `<tr>
      <td><input type="date" data-lot="date" value="${esc(l.date || '')}"/></td>
      <td><input type="number" step="any" data-lot="qty" value="${l.qty != null ? l.qty : ''}" placeholder="Qty"/></td>
      <td><input type="number" step="any" data-lot="price" value="${l.price != null ? l.price : ''}" placeholder="Price"/></td>
      <td><button type="button" class="rm" title="Remove" aria-label="Remove this lot"><span aria-hidden="true">✕</span></button></td>
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
      // the ✕ button wraps its glyph in a span — resolve to the button
      const rm = ev.target.closest('.rm');
      if (rm) { rm.closest('tr').remove(); if (onChange) onChange(); }
    });
    tbl.addEventListener('input', () => { if (onChange) onChange(); });
    $('lots_csv_toggle').addEventListener('click', () => {
      const b = $('lots_csv_box');
      b.style.display = b.style.display === 'none' ? '' : 'none';
    });
    $('lots_csv_apply').addEventListener('click', () => {
      // proper CSV parse (quotes, ₹/comma-formatted numbers) with per-line
      // errors — a bad line is reported, never silently dropped or mangled
      const rows = Importer.parseCsv(val('lots_csv'));
      const lots = [], errs = [];
      rows.forEach((cells, i) => {
        const [rawDate, rawQty, rawPrice] = cells;
        if (i === 0 && /date/i.test(rawDate || '') && !Importer.normalizeDate(rawDate)) return; // header line
        const date = Importer.normalizeDate(rawDate);
        const qty = Importer.parseNumber(rawQty), price = Importer.parseNumber(rawPrice);
        if (!date) { errs.push(`Line ${i + 1}: invalid date "${rawDate || ''}" — use YYYY-MM-DD or DD-MM-YYYY`); return; }
        if (qty == null || qty <= 0) { errs.push(`Line ${i + 1}: invalid quantity "${rawQty || ''}"`); return; }
        if (price == null) { errs.push(`Line ${i + 1}: invalid price "${rawPrice || ''}"`); return; }
        lots.push({ date, qty, price });
      });
      const errEl = $('lots_csv_err');
      if (errEl) {
        if (!rows.length) { errEl.innerHTML = 'Nothing to apply — paste CSV rows first.'; errEl.style.display = ''; }
        else if (errs.length) { errEl.innerHTML = errs.map(e => esc(e)).join('<br/>'); errEl.style.display = ''; }
        else errEl.style.display = 'none';
      }
      if (lots.length) {
        // append to the table (never wipe manually entered lots); drop
        // still-empty placeholder rows first
        const tbody = tbl.querySelector('tbody');
        tbody.querySelectorAll('tr').forEach(tr => {
          const g = k => { const e = tr.querySelector(`[data-lot="${k}"]`); return e ? e.value.trim() : ''; };
          if (!g('date') && !g('qty') && !g('price')) tr.remove();
        });
        tbody.insertAdjacentHTML('beforeend', lots.map((l, i) => lotRow(i, l)).join(''));
        $('lots_csv').value = '';
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
      <span>🤖 Fastest path: AI-powered import from your ${kind}.</span>
      <button type="button" class="btn sm" data-import>Upload file (CSV / XLS / PDF)</button>
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
          s => `<div><div class="ac-name">${s.symbol}</div><div class="ac-sub">${esc(s.name)} · ${esc(s.exchange)}</div></div><div class="ac-price">${s.price != null ? `${s.currency === 'USD' ? '$' : '₹'}${s.price.toLocaleString('en-IN')}` : `<span class="dim">${esc(s.exchange)}</span>`}</div>`,
          (s, inp) => {
            inp.value = s.symbol; inp.dataset.key = s.symbol;
            if (s.price != null) {
              setHint('f_symbol', `${s.name} · ${s.exchange} · LTP ${s.currency === 'USD' ? '$' : '₹'}${s.price.toLocaleString('en-IN')}${s.currency === 'USD' ? ` (FX @ ₹${Market.FX.USDINR}/$${Market.rateNoteText('USDINR') ? ' · ' + Market.rateNoteText('USDINR') : ''})` : ''}`);
            } else {
              setHint('f_symbol', `${s.name} · listed on ${s.exchange} — no live LTP feed yet, valued at your average cost until one is integrated.`);
            }
            const isinEl = $('f_isin');
            if (s.isin && isinEl && !isinEl.value) isinEl.value = s.isin;
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
        if (symbol && !Market.getStock(symbol)) { setErr('f_symbol', 'Unknown symbol — pick one from the search results'); errors.push('symbol'); }
        const quantity = num('f_qty');
        if (!quantity || quantity <= 0) { setErr('f_qty', 'Quantity is required'); errors.push('qty'); } else setErr('f_qty', null);
        const date = val('f_date');
        if (!date) { setErr('f_date', 'Acquisition date is required'); errors.push('date'); } else setErr('f_date', null);
        const avgPrice = num('f_avg'), totalInvested = num('f_total');
        if (avgPrice == null && totalInvested == null) { setErr('f_avg', 'Enter average buy price or total invested'); errors.push('cost'); } else setErr('f_avg', null);
        const lots = collectLots();
        // master-listed symbols have no LTP feed yet — freeze at avg cost
        // so valuation never collapses to zero (store falls back to lastPrice)
        const stk = Market.getStock(symbol);
        const lastPrice = stk && stk.price != null ? undefined
          : (avgPrice != null ? avgPrice : (totalInvested && quantity ? totalInvested / quantity : undefined));
        return { errors, acquiredOn: date, data: {
          symbol, quantity, avgPrice, totalInvested,
          lastPrice,
          lots: lots.length ? lots : undefined,
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
          s => `<div><div class="ac-name">${esc(s.name)}</div><div class="ac-sub">${esc(s.amc)} · ${esc(s.sub || s.category)} · ${s.code}</div></div><div class="ac-price">${s.nav != null ? `₹${s.nav.toLocaleString('en-IN')}` : ''}</div>`,
          (s, inp) => {
            inp.value = s.name; inp.dataset.key = s.code;
            // master schemes carry their plan/option in the scheme itself —
            // mirror it onto the toggles so the variants read consistently
            if (s.master && s.plan) { const el = $('f_plan'); if (el) { el.dataset.value = s.plan; el.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === s.plan)); } }
            if (s.master && s.option) { const el = $('f_option'); if (el) { el.dataset.value = s.option; el.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === s.option)); } }
            setHint('f_scheme', `${s.amc} · ${s.sub || s.category}${s.master ? '' : ` (${s.category})`} · NAV ₹${s.nav != null ? s.nav : '—'}${s.navDate ? ` (as of ${s.navDate})` : ''}${s.elss ? ' · ELSS 3-yr lock-in' : ''}`);
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
        // remember the scheme's name + latest NAV so the holding stays
        // valued and labelled after a reload even without the master
        const sch = Market.getScheme(code);
        return { errors, acquiredOn: date, data: {
          schemeCode: code, plan: segVal('f_plan'), option: segVal('f_option'),
          units: u, avgNav: avgNav || (invested && u ? invested / u : undefined), totalInvested: invested,
          schemeName: sch ? sch.name : undefined,
          lastNav: Market.schemeNav(code, segVal('f_plan')) || avgNav || undefined,
          sipOngoing: checked('f_sip'), sipAmount: num('f_sipamt') || undefined, sipFreq: val('f_sipfreq') || undefined,
          lots: lots.length ? lots : undefined,
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
            ${m && !isUnits ? `<div class="form-note full">Current ${metal} rate: <b>₹${m.perGram.toLocaleString('en-IN', { maximumFractionDigits: 2 })}/g</b> (${m.label}). ${Market.rateChip(metal)}</div>` : ''}
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
          ${seg('f_ccy', 'Purchase currency', [['USD', 'USD'], ['INR', 'INR']], d.investCurrency || 'USD', { hint: `Values convert to ₹ at ${Market.FX.USDINR}/$ (FX note). ${Market.rateChip('USDINR')}` })}
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
            setHint('f_coin', `${c.name} · $${c.priceUSD.toLocaleString('en-US')} · ≈ ${Fin.fmtINR(c.priceUSD * Market.FX.USDINR)} (FX @ ₹${Market.FX.USDINR}/$${Market.rateNoteText('USDINR') ? ' · ' + Market.rateNoteText('USDINR') : ''})${c.stable ? ' · stablecoin, projects ≈ flat' : ''}`);
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
          lots: lots.length ? lots : undefined,
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

    // ---------------- EPF / PF ----------------
    epf: {
      title: 'EPF / Provident fund',
      render(a) {
        const d = a.data || {};
        return `${importBand('EPF passbook / annual statement')}
        <div class="form-grid">
          ${numF('f_balance', 'Current balance (₹, from statement)', { req: true, value: d.balance })}
          ${dateF('f_asof', 'Balance as of (statement date)', { req: true, value: d.asOfDate || Fin.todayISO() })}
          ${numF('f_emp', 'Monthly employee contribution (₹)', { req: true, value: d.empContribution })}
          ${numF('f_er', 'Monthly employer contribution (₹)', { req: true, value: d.erContribution })}
          ${numF('f_rate', 'Statutory interest rate (% p.a.)', { req: true, value: d.rate != null ? d.rate : 8.25, step: '0.01', hint: 'EPFO-declared, credited yearly. Editable when it changes.' })}
          ${dateF('f_date', 'Account start date', { req: true, value: a.acquiredOn })}
          ${numF('f_curage', 'Your current age', { value: d.currentAge != null ? d.currentAge : 30, hint: 'Used with retirement age to project your corpus.' })}
          ${numF('f_retage', 'Retirement age', { value: d.retirementAge != null ? d.retirementAge : 60 })}
        </div>
        <details class="expander"><summary>Add more details — UAN, VPF</summary><div class="expander-body">
          <div class="form-grid">
            ${txt('f_uan', 'UAN', { value: d.uan, placeholder: '1012 3456 7890' })}
            ${numF('f_vpf', 'VPF top-up (₹/month)', { value: d.vpf, hint: 'Voluntary PF over the statutory 12%.' })}
          </div>
        </div></details>
        ${sharedSection(a)}
        <div class="disclaimer" style="margin-top:16px">⚠️ The retirement-corpus projection compounds today's statutory rate and contributions — <b>illustrative, not advice</b>. Update the balance when your annual statement arrives.</div>`;
      },
      wire() {
        const preview = () => {
          const b = num('f_balance'), r = num('f_rate'), emp = num('f_emp') || 0, er = num('f_er') || 0, vpf = num('f_vpf') || 0;
          const yrs = Math.max(0, (num('f_retage') || 60) - (num('f_curage') || 30));
          if (b != null && r != null) {
            const corpus = Fin.contributoryFV(b, r / 100, yrs, emp + er + vpf);
            setHint('f_balance', `Projected corpus at retirement (${yrs}y): ≈ ${Fin.fmtINR(corpus, { compact: true })}`);
          }
        };
        ['f_balance', 'f_rate', 'f_emp', 'f_er', 'f_curage', 'f_retage'].forEach(id => $(id).addEventListener('input', preview));
        preview();
      },
      collect() {
        const errors = [];
        const balance = num('f_balance');
        if (balance == null) { setErr('f_balance', 'Statement balance is required'); errors.push('b'); } else setErr('f_balance', null);
        const rate = num('f_rate');
        if (rate == null) { setErr('f_rate', 'Interest rate is required'); errors.push('r'); } else setErr('f_rate', null);
        const emp = num('f_emp'), er = num('f_er');
        if (emp == null) { setErr('f_emp', 'Employee contribution is required (0 is fine)'); errors.push('e'); } else setErr('f_emp', null);
        if (er == null) { setErr('f_er', 'Employer contribution is required (0 is fine)'); errors.push('e2'); } else setErr('f_er', null);
        const date = val('f_date');
        if (!date) { setErr('f_date', 'Start date is required'); errors.push('d'); } else setErr('f_date', null);
        const asOf = val('f_asof');
        if (!asOf) { setErr('f_asof', 'Statement date is required'); errors.push('a'); } else setErr('f_asof', null);
        return { errors, acquiredOn: date, data: {
          balance, asOfDate: asOf, empContribution: emp, erContribution: er,
          rate, currentAge: num('f_curage') || 30, retirementAge: num('f_retage') || 60,
          uan: val('f_uan') || undefined, vpf: num('f_vpf') || undefined,
        } };
      },
    },

    // ---------------- PPF ----------------
    ppf: {
      title: 'PPF',
      render(a) {
        const d = a.data || {};
        return `${importBand('PPF passbook')}
        <div class="form-grid">
          ${numF('f_balance', 'Current balance (₹)', { req: true, value: d.balance })}
          ${dateF('f_asof', 'Balance as of', { req: true, value: d.asOfDate || Fin.todayISO() })}
          ${numF('f_annual', 'Annual contribution (₹, cap ₹1.5L)', { req: true, value: d.annualContribution, hint: 'Validated against the ₹1,50,000 yearly cap.' })}
          ${numF('f_rate', 'Current rate (% p.a.)', { req: true, value: d.rate != null ? d.rate : 7.1, step: '0.01', hint: 'Government-set quarterly; annual compounding.' })}
          ${dateF('f_open', 'Account open date', { req: true, value: d.openDate || a.acquiredOn, hint: 'Drives the 15-year maturity date (auto-derived).' })}
          ${sel('f_ext', 'Extension after maturity', [[0, 'None'], [5, '+5 years'], [10, '+10 years'], [15, '+15 years']], { value: d.extensionYears || 0, hint: 'PPF extends in 5-year blocks.' })}
        </div>
        ${sharedSection(a)}
        <div class="disclaimer" style="margin-top:16px">⚠️ Maturity projection compounds today's rate — the government revises it quarterly. Illustrative, not advice.</div>`;
      },
      wire() {
        const derive = () => {
          const open = val('f_open');
          const ext = parseInt(val('f_ext'), 10) || 0;
          if (open) {
            const mat = Fin.addYears(open, 15 + ext);
            setHint('f_open', `Matures ${Fin.fmtDate(mat)} (15y${ext ? ' + ' + ext + 'y extension' : ''})`);
          }
          const ann = num('f_annual');
          if (ann != null && ann > 150000) setErr('f_annual', 'Above the ₹1.5L annual PPF cap');
          else setErr('f_annual', null);
        };
        ['f_open', 'f_ext', 'f_annual'].forEach(id => $(id).addEventListener('input', derive));
        derive();
      },
      collect() {
        const errors = [];
        const balance = num('f_balance');
        if (balance == null) { setErr('f_balance', 'Balance is required'); errors.push('b'); } else setErr('f_balance', null);
        const annual = num('f_annual');
        if (annual == null) { setErr('f_annual', 'Annual contribution is required (0 is fine)'); errors.push('a'); }
        else if (annual > 150000) { setErr('f_annual', 'Above the ₹1.5L annual PPF cap'); errors.push('cap'); }
        else setErr('f_annual', null);
        const rate = num('f_rate');
        if (rate == null) { setErr('f_rate', 'Rate is required'); errors.push('r'); } else setErr('f_rate', null);
        const open = val('f_open');
        if (!open) { setErr('f_open', 'Open date is required'); errors.push('o'); } else setErr('f_open', null);
        const asOf = val('f_asof');
        if (!asOf) { setErr('f_asof', 'Statement date is required'); errors.push('s'); } else setErr('f_asof', null);
        return { errors, acquiredOn: open, data: {
          balance, asOfDate: asOf, annualContribution: annual, rate,
          openDate: open, extensionYears: parseInt(val('f_ext'), 10) || 0,
        } };
      },
    },

    // ---------------- NPS ----------------
    nps: {
      title: 'NPS',
      render(a) {
        const d = a.data || {};
        return `${importBand('NPS statement (CRA)')}
        <div class="form-note" style="margin-bottom:16px">NPS is <b>market-linked</b>: your E/C/G split blends equity and debt behaviour, so this one gets a Monte Carlo projection band, not a contractual curve.</div>
        <div class="form-grid">
          ${numF('f_corpus', 'Current corpus (₹)', { req: true, value: d.corpus })}
          ${dateF('f_asof', 'Corpus as of', { req: true, value: d.asOfDate || Fin.todayISO() })}
          ${numF('f_monthly', 'Monthly contribution (₹)', { req: true, value: d.monthlyContribution })}
          ${seg('f_tier', 'Tier', [['I', 'Tier I'], ['II', 'Tier II']], d.tier || 'I', { hint: 'Tier I is the locked retirement account.' })}
          <div class="form-section-title">Asset allocation (must sum to 100)</div>
          ${numF('f_alloce', 'E — Equity (%)', { req: true, value: d.allocE != null ? d.allocE : 50, min: 0 })}
          ${numF('f_allocc', 'C — Corporate debt (%)', { req: true, value: d.allocC != null ? d.allocC : 30, min: 0 })}
          ${numF('f_allocg', 'G — Government securities (%)', { req: true, value: d.allocG != null ? d.allocG : 20, min: 0 })}
          ${dateF('f_date', 'Account start date', { req: true, value: a.acquiredOn })}
        </div>
        <details class="expander"><summary>Add more details</summary><div class="expander-body"><div class="form-grid">
          ${numF('f_totalinv', 'Total invested so far (₹, optional)', { value: d.totalInvested, hint: 'Enables a growth % figure.' })}
          ${txt('f_pran', 'PRAN', { value: d.pran, placeholder: '1100 2233 4455' })}
        </div></div></details>
        ${sharedSection(a)}`;
      },
      wire() {
        const blendPrev = () => {
          const e = num('f_alloce') || 0, c = num('f_allocc') || 0, g = num('f_allocg') || 0;
          const sum = e + c + g;
          if (sum !== 100) { setErr('f_alloce', `Allocation sums to ${sum} — must be 100`); }
          else {
            setErr('f_alloce', null);
            const b = Fin.npsBlend(e, c, g);
            setHint('f_alloce', `Blended: μ ${(b.mu * 100).toFixed(1)}% · σ ${(b.sigma * 100).toFixed(1)}% — drives the band width`);
          }
        };
        ['f_alloce', 'f_allocc', 'f_allocg'].forEach(id => $(id).addEventListener('input', blendPrev));
        blendPrev();
      },
      collect() {
        const errors = [];
        const corpus = num('f_corpus');
        if (corpus == null) { setErr('f_corpus', 'Corpus is required'); errors.push('c'); } else setErr('f_corpus', null);
        const monthly = num('f_monthly');
        if (monthly == null) { setErr('f_monthly', 'Monthly contribution is required (0 is fine)'); errors.push('m'); } else setErr('f_monthly', null);
        const e = num('f_alloce') || 0, c = num('f_allocc') || 0, g = num('f_allocg') || 0;
        if (e + c + g !== 100) { setErr('f_alloce', `Allocation sums to ${e + c + g} — must be 100`); errors.push('alloc'); }
        const date = val('f_date');
        if (!date) { setErr('f_date', 'Start date is required'); errors.push('d'); } else setErr('f_date', null);
        const asOf = val('f_asof');
        if (!asOf) { setErr('f_asof', 'Statement date is required'); errors.push('a'); } else setErr('f_asof', null);
        return { errors, acquiredOn: date, data: {
          corpus, asOfDate: asOf, monthlyContribution: monthly, tier: segVal('f_tier') || 'I',
          allocE: e, allocC: c, allocG: g,
          totalInvested: num('f_totalinv') != null ? num('f_totalinv') : undefined,
          pran: val('f_pran') || undefined,
        } };
      },
    },

    // ---------------- SMALL SAVINGS ----------------
    smallsavings: {
      title: 'Small savings',
      render(a) {
        const d = a.data || {};
        return `${importBand('post-office passbook / certificate')}
        <div class="form-grid">
          ${sel('f_subtype', 'Scheme', [['rd', 'Recurring deposit (RD)'], ['ssy', 'Sukanya Samriddhi (SSY)'], ['kvp', 'Kisan Vikas Patra (KVP)'], ['nsc', 'NSC'], ['pomis', 'Post Office MIS'], ['potd', 'Post Office TD']], { value: d.subType || 'rd', req: true, full: true })}
          <div class="full" id="ss_dyn"></div>
          ${numF('f_rate', 'Interest rate (% p.a., locked)', { req: true, value: d.rate, step: '0.01' })}
          ${numF('f_tenure', 'Tenure (years)', { req: true, value: d.tenureYears, step: '0.5', hint: 'RD 5y · SSY 21y · KVP ~9.6y · NSC 5y · MIS 5y' })}
          ${dateF('f_start', 'Start date', { req: true, value: d.startDate || a.acquiredOn })}
        </div>
        ${sharedSection(a)}`;
      },
      wire(a) {
        const d = a.data || {};
        const renderDyn = () => {
          const st = val('f_subtype');
          if (st === 'rd') {
            $('ss_dyn').innerHTML = `<div class="form-grid">${numF('f_monthlyamt', 'Monthly deposit (₹)', { req: true, value: d.monthlyAmount })}</div>`;
          } else if (st === 'ssy') {
            $('ss_dyn').innerHTML = `<div class="form-grid">
              ${numF('f_ssybal', 'Current balance (₹)', { value: d.balance })}
              ${numF('f_ssyann', 'Annual contribution (₹, cap ₹1.5L)', { req: true, value: d.annualContribution })}
            </div>`;
            $('f_ssyann').addEventListener('input', () => {
              const v2 = num('f_ssyann');
              if (v2 != null && v2 > 150000) setErr('f_ssyann', 'Above the ₹1.5L annual SSY cap'); else setErr('f_ssyann', null);
            });
          } else {
            $('ss_dyn').innerHTML = `<div class="form-grid">${numF('f_principal', 'Principal (₹)', { req: true, value: d.principal })}</div>`;
          }
          preview();
        };
        const preview = () => {
          const st = val('f_subtype'), r = num('f_rate'), t = num('f_tenure');
          if (r == null || !t) return;
          let mv = null;
          if (st === 'rd' && num('f_monthlyamt')) mv = Fin.annuityFV(num('f_monthlyamt'), r / 100, t, 12);
          else if (st === 'ssy' && num('f_ssyann') != null) mv = Fin.ppfFV(num('f_ssybal') || 0, r / 100, t, num('f_ssyann'));
          else if (num('f_principal')) mv = st === 'pomis' ? num('f_principal') : num('f_principal') * Math.pow(1 + r / 100, t);
          if (mv != null) setHint('f_rate', `Maturity value ≈ ${Fin.fmtINR(mv)}${st === 'pomis' ? ` + ${Fin.fmtINR(num('f_principal') * r / 1200)}/mo income` : ''}`);
        };
        $('f_subtype').addEventListener('change', renderDyn);
        ['f_rate', 'f_tenure'].forEach(id => $(id).addEventListener('input', preview));
        renderDyn();
      },
      collect() {
        const errors = [];
        const st = val('f_subtype');
        const rate = num('f_rate');
        if (rate == null) { setErr('f_rate', 'Rate is required'); errors.push('r'); } else setErr('f_rate', null);
        const tenure = num('f_tenure');
        if (!tenure) { setErr('f_tenure', 'Tenure is required'); errors.push('t'); } else setErr('f_tenure', null);
        const start = val('f_start');
        if (!start) { setErr('f_start', 'Start date is required'); errors.push('s'); } else setErr('f_start', null);
        const data = { subType: st, rate, tenureYears: tenure, startDate: start };
        if (st === 'rd') {
          data.monthlyAmount = num('f_monthlyamt');
          if (!data.monthlyAmount) { setErr('f_monthlyamt', 'Monthly deposit is required'); errors.push('m'); }
        } else if (st === 'ssy') {
          data.balance = num('f_ssybal') || 0;
          data.annualContribution = num('f_ssyann');
          data.asOfDate = start;
          if (data.annualContribution == null) { setErr('f_ssyann', 'Annual contribution is required'); errors.push('a'); }
          else if (data.annualContribution > 150000) { setErr('f_ssyann', 'Above the ₹1.5L annual SSY cap'); errors.push('cap'); }
        } else {
          data.principal = num('f_principal');
          if (!data.principal) { setErr('f_principal', 'Principal is required'); errors.push('p'); }
        }
        return { errors, acquiredOn: start, data };
      },
    },

    // ---------------- ESOP / RSU ----------------
    esop: {
      title: 'ESOPs / RSUs',
      render(a) {
        const d = a.data || {};
        return `${importBand('grant letter / equity portal')}
        <div class="form-grid">
          ${txt('f_company', 'Company', { req: true, value: d.company, placeholder: 'Microsoft, Flipkart…' })}
          ${acF('f_ticker', 'Listed ticker (if public)', { value: d.ticker || '', key: d.ticker || '', placeholder: 'Search MSFT, AAPL… (leave blank if private)', hint: d.ticker ? 'Live price linked ✓' : 'Blank = private company → enter a share price below.' })}
          ${seg('f_granttype', 'Grant type', [['RSU', 'RSU'], ['ISO', 'ISO'], ['NSO', 'NSO']], d.grantType || 'RSU', { req: true })}
          ${numF('f_units', 'Total units granted', { req: true, value: d.totalUnits })}
          <div class="form-section-title">Vesting schedule</div>
          ${dateF('f_veststart', 'Vest start date', { req: true, value: d.vestStart || a.acquiredOn })}
          ${numF('f_cliff', 'Cliff (months)', { req: true, value: d.cliffMonths != null ? d.cliffMonths : 12 })}
          ${seg('f_freq', 'Vesting frequency after cliff', [['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['annual', 'Annual']], d.freq || 'quarterly', {})}
          ${numF('f_duration', 'Total vesting period (months)', { req: true, value: d.durationMonths != null ? d.durationMonths : 48 })}
          <div class="form-section-title">Pricing</div>
          ${numF('f_strike', 'Strike price (options only)', { value: d.strike, hint: 'Leave blank for RSUs.' })}
          ${numF('f_shareprice', 'Current share price (private / unlisted)', { value: d.sharePrice, hint: 'Use the 409A / last-round valuation. Ignored when a ticker is linked.' })}
          ${seg('f_ccy', 'Currency', [['USD', 'USD'], ['INR', 'INR']], d.currency || 'USD', { hint: `USD converts at ₹${Market.FX.USDINR}/$. ${Market.rateChip('USDINR')}` })}
          ${check('f_private', 'Private / unlisted company', d.isPrivate, 'Valued manually; tagged illiquid & assumption-based.')}
          ${numF('f_growth', 'Assumed growth if private (% p.a.)', { value: d.assumedGrowth != null ? d.assumedGrowth : 15, step: '0.5' })}
        </div>
        <details class="expander"><summary>Add more details — exit assumptions</summary><div class="expander-body"><div class="form-grid">
          ${txt('f_exitnote', 'Expected exit / IPO assumption', { value: d.exitNote, full: true, placeholder: 'e.g. IPO expected 2028; double-trigger RSUs settle then' })}
        </div></div></details>
        ${sharedSection(a)}
        <div class="disclaimer" style="margin-top:16px">⚠️ Unvested units are excluded from net worth. RSU values are pre-tax; private-company values rest on your assumptions — illustrative, not advice.</div>`;
      },
      wire() {
        wireAc('f_ticker', Market.searchStocks,
          s => `<div><div class="ac-name">${s.symbol}</div><div class="ac-sub">${esc(s.name)} · ${esc(s.exchange)}</div></div><div class="ac-price">${s.price != null ? `${s.currency === 'USD' ? '$' : '₹'}${s.price.toLocaleString('en-IN')}` : `<span class="dim">${esc(s.exchange)}</span>`}</div>`,
          (s, inp) => {
            inp.value = s.symbol; inp.dataset.key = s.symbol;
            setHint('f_ticker', s.price != null
              ? `${s.name} · ${s.currency === 'USD' ? '$' : '₹'}${s.price.toLocaleString('en-IN')} live`
              : `${s.name} · listed on ${s.exchange} — no live feed yet, enter the share price below.`);
          });
        const preview = () => {
          const start = val('f_veststart'), units = num('f_units'), cliff = num('f_cliff'), dur = num('f_duration');
          if (start && units && dur) {
            const vested = Fin.vestedUnits({ startDate: start, totalUnits: units, cliffMonths: cliff || 0, freq: segVal('f_freq') || 'quarterly', durationMonths: dur });
            setHint('f_units', `Vested today: ${Fin.fmtQty(vested, 0)} of ${Fin.fmtQty(units, 0)} (${((vested / units) * 100).toFixed(0)}%)`);
          }
        };
        ['f_veststart', 'f_units', 'f_cliff', 'f_duration'].forEach(id => $(id).addEventListener('input', preview));
        preview();
      },
      collect() {
        const errors = [];
        const company = val('f_company');
        if (!company) { setErr('f_company', 'Company is required'); errors.push('c'); } else setErr('f_company', null);
        const units = num('f_units');
        if (!units || units <= 0) { setErr('f_units', 'Total granted units are required'); errors.push('u'); } else setErr('f_units', null);
        const vestStart = val('f_veststart');
        if (!vestStart) { setErr('f_veststart', 'Vest start date is required'); errors.push('v'); } else setErr('f_veststart', null);
        const duration = num('f_duration');
        if (!duration || duration <= 0) { setErr('f_duration', 'Vesting period is required'); errors.push('dur'); } else setErr('f_duration', null);
        const ticker = $('f_ticker').dataset.key || (val('f_ticker') ? val('f_ticker').toUpperCase() : '');
        const isPrivate = checked('f_private');
        const sharePrice = num('f_shareprice');
        const grantType = segVal('f_granttype') || 'RSU';
        const strike = num('f_strike');
        if (!ticker && sharePrice == null) { setErr('f_shareprice', 'Enter a share price, or link a listed ticker'); errors.push('p'); } else setErr('f_shareprice', null);
        if ((grantType === 'ISO' || grantType === 'NSO') && strike == null) { setErr('f_strike', 'Options need a strike price'); errors.push('st'); } else setErr('f_strike', null);
        return { errors, acquiredOn: vestStart, labelOverride: val('f_label') || `${company} ${grantType}`, data: {
          company, ticker: (ticker && Market.getStock(ticker)) ? ticker : undefined,
          grantType, totalUnits: units, vestStart,
          cliffMonths: num('f_cliff') || 0, freq: segVal('f_freq') || 'quarterly', durationMonths: duration,
          strike: strike != null ? strike : undefined,
          sharePrice: sharePrice != null ? sharePrice : undefined,
          currency: segVal('f_ccy') || 'USD',
          isPrivate: isPrivate || undefined,
          assumedGrowth: num('f_growth') != null ? num('f_growth') : undefined,
          exitNote: val('f_exitnote') || undefined,
        } };
      },
    },
  };

  // ============================================================
  // Liability form (separate collection — not an asset type)
  // ============================================================
  function renderLiability(container, liab) {
    const l = liab || {};
    const reAssets = Store.byType('realestate');
    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <span style="font-size:22px">💳</span>
        <h2 style="font-size:18px">${liab ? 'Edit' : 'Add'} — Liability</h2>
        <span class="tag computed"><span class="dot"></span>Amortized</span>
      </div>
      <p class="dim small" style="margin-bottom:18px">Loans amortize down deterministically from the outstanding balance, EMI and rate. Net worth = assets − liabilities.</p>
      <div class="form-grid">
        ${sel('fl_type', 'Liability type', Object.values(Store.LIABILITY_TYPES).map(t => [t.id, `${t.icon} ${t.label}`]), { value: l.type || 'homeloan', req: true })}
        ${txt('fl_label', 'Label / nickname', { value: l.label, placeholder: 'HDFC home loan' })}
        ${numF('fl_principal', 'Outstanding balance (₹)', { req: true, value: l.principal, hint: 'From your latest loan statement.' })}
        ${dateF('fl_asof', 'Balance as of', { req: true, value: l.asOfDate || Fin.todayISO() })}
        ${numF('fl_rate', 'Interest rate (% p.a.)', { req: true, value: l.rate, step: '0.01' })}
        ${numF('fl_emi', 'EMI (₹/month)', { value: l.emi, hint: 'Leave blank for revolving credit-card balances.' })}
        ${dateF('fl_start', 'Loan start date', { value: l.startDate })}
        ${txt('fl_lender', 'Lender', { value: l.lender, placeholder: 'HDFC Bank' })}
        ${reAssets.length ? sel('fl_linked', 'Link to a property (home loans)', [['', '— Not linked —'], ...reAssets.map(a2 => [a2.id, a2.label])], { value: l.linkedAssetId || '', full: true, hint: 'Linked loans are counted once, under Liabilities; the property then shows gross value + net equity (no double-count).' }) : ''}
        ${txt('fl_notes', 'Notes', { value: l.notes, full: true })}
      </div>`;
    const preview = () => {
      const p2 = num('fl_principal'), r = num('fl_rate'), emi = num('fl_emi');
      if (p2 && r != null && emi) {
        const months = Fin.loanPayoffMonths(p2, r / 100, emi);
        if (months == null) { setErr('fl_emi', `EMI doesn't cover monthly interest (${Fin.fmtINR(p2 * r / 1200)}) — balance would grow`); return; }
        setErr('fl_emi', null);
        const d2 = new Date(); d2.setMonth(d2.getMonth() + months);
        const interest = Fin.loanInterestRemaining(p2, r / 100, emi);
        setHint('fl_emi', `Payoff ${Fin.fmtDate(d2)} (${(months / 12).toFixed(1)}y) · interest remaining ≈ ${Fin.fmtINR(interest, { compact: true })}`);
      }
    };
    ['fl_principal', 'fl_rate', 'fl_emi'].forEach(id => $(id).addEventListener('input', preview));
    preview();
  }

  function collectLiability() {
    const errors = [];
    const principal = num('fl_principal');
    if (!principal || principal <= 0) { setErr('fl_principal', 'Outstanding balance is required'); errors.push('p'); } else setErr('fl_principal', null);
    const rate = num('fl_rate');
    if (rate == null) { setErr('fl_rate', 'Interest rate is required'); errors.push('r'); } else setErr('fl_rate', null);
    const asOf = val('fl_asof');
    if (!asOf) { setErr('fl_asof', 'Balance date is required'); errors.push('a'); } else setErr('fl_asof', null);
    const type = val('fl_type');
    const emi = num('fl_emi');
    if (type !== 'creditcard' && !emi) { setErr('fl_emi', 'EMI is required for loans (credit cards may omit it)'); errors.push('e'); }
    else if (emi && principal && rate != null && Fin.loanPayoffMonths(principal, rate / 100, emi) == null) { setErr('fl_emi', 'EMI is below the monthly interest — the loan never amortizes'); errors.push('e2'); }
    else setErr('fl_emi', null);
    if (errors.length) return { ok: false };
    const linkedEl = document.getElementById('fl_linked');
    return { ok: true, liability: {
      type, label: val('fl_label') || Store.LIABILITY_TYPES[type].label,
      principal, asOfDate: asOf, rate, emi: emi || null,
      startDate: val('fl_start') || asOf, lender: val('fl_lender') || undefined,
      linkedAssetId: linkedEl && linkedEl.value ? linkedEl.value : undefined,
      notes: val('fl_notes') || undefined,
    } };
  }

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
      AIImport.openUploadModal(type);
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
      case 'epf': return 'EPF / PF';
      case 'ppf': return 'PPF';
      case 'nps': return `NPS Tier ${d.tier || 'I'}`;
      case 'smallsavings': { const n = { rd: 'Recurring deposit', ssy: 'Sukanya Samriddhi', kvp: 'KVP', nsc: 'NSC', pomis: 'PO MIS', potd: 'PO TD' }; return n[d.subType] || 'Small savings'; }
      case 'esop': return `${d.company || 'ESOP'} ${d.grantType || 'RSU'}`;
      default: return 'Asset';
    }
  }

  return { render, collect, renderLiability, collectLiability };
})();

if (typeof globalThis !== 'undefined') globalThis.Forms = Forms;
