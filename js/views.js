/* ============================================================
   WealthForge AI — screens
   Dashboard · Holdings (tabs per asset type) · Liabilities ·
   Asset detail · Projections · Settings.
   Pure render functions returning HTML into #view.
   ============================================================ */

const Views = (() => {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const { fmtINR, fmtPct, fmtQty, fmtDate } = Fin;

  const modeTag = m => `<span class="tag ${m}"><span class="dot"></span>${m === 'live' ? 'Live' : m === 'computed' ? 'Computed' : 'Manual'}</span>`;
  const deltaChip = (p, opts = {}) => {
    if (p == null || !isFinite(p)) return '<span class="delta flat">—</span>';
    const cls = p > 0.0001 ? 'pos' : p < -0.0001 ? 'neg' : 'flat';
    return `<span class="delta ${cls}">${fmtPct(p, opts.digits != null ? opts.digits : 1)}${opts.suffix || ''}</span>`;
  };
  const pctText = p => {
    if (p == null || !isFinite(p)) return '<span class="dim">—</span>';
    return `<span class="${p >= 0 ? 'pos-t' : 'neg-t'}">${fmtPct(p)}</span>`;
  };
  const freshChip = text => `<span class="chip fresh">🕐 ${esc(text)}</span>`;

  const DISCLAIMER = `<div class="disclaimer">⚠️ <span>Projections are <b>illustrative, not financial advice</b>. Market-linked bands show a 10th–90th percentile range from historical return & volatility; contractual and assumed-rate curves compound deterministic rates.</span></div>`;

  // ============ DASHBOARD ============
  function dashboard() {
    const p = Store.portfolio();
    const assets = Store.all();
    const vals = assets.map(a => ({ a, v: Store.valuation(a) }));
    const liabs = Store.liabilities().map(l => ({ l, lv: Store.liabilityValuation(l) }));

    const slices = Store.TYPE_ORDER
      .map(t => ({ label: Store.TYPES[t].label, value: p.byType[t] || 0, type: t }))
      .filter(s => s.value > 0);

    const movers = vals.filter(x => x.v.dayChangePct != null)
      .sort((x, y) => Math.abs(y.v.dayChangePct) - Math.abs(x.v.dayChangePct)).slice(0, 5);

    const band = Store.portfolioBand(10, 24, true); // net-worth outlook
    const p50End = band.length ? band[band.length - 1] : null;

    const classCards = slices.map(s => {
      const typeAssets = vals.filter(x => x.a.type === s.type);
      const inv = typeAssets.reduce((sum, x) => sum + (x.v.investedShare || 0), 0);
      const gain = inv > 0 ? (s.value - inv) / inv : null;
      return `<div class="card" style="cursor:pointer" onclick="location.hash='#/holdings/${s.type}'">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div class="stat-label">${Store.TYPES[s.type].icon} ${esc(s.label)}</div>
          ${modeTag(Store.TYPES[s.type].mode)}
        </div>
        <div class="stat-value" style="margin-top:8px">${fmtINR(s.value, { compact: true })}</div>
        <div class="stat-sub">${typeAssets.length} holding${typeAssets.length > 1 ? 's' : ''} · ${gain != null ? `<span class="${gain >= 0 ? 'pos-t' : 'neg-t'}">${fmtPct(gain)}</span> overall` : '—'}</div>
      </div>`;
    }).join('');

    const insights = Insights.generate();

    return `
      <div class="page-head">
        <div>
          <div class="page-title">Dashboard</div>
          <div class="page-sub">Your whole net worth — assets minus liabilities, live and honest.</div>
        </div>
        <button class="btn primary" onclick="location.hash='#/add'">+ Add asset</button>
      </div>

      <div class="hero">
        <div>
          <div class="hero-label">Net worth (assets − liabilities)</div>
          <div class="hero-value">${fmtINR(p.netWorth)}</div>
          <div class="hero-meta">
            <span class="dim small">Assets <b style="color:var(--text)">${fmtINR(p.totalAssets, { compact: true })}</b></span>
            <span class="owed-chip">owed ${fmtINR(p.totalLiabilities, { compact: true })}</span>
            ${deltaChip(p.absPct)} <span class="dim small">overall on assets</span>
          </div>
        </div>
        <div style="display:flex;gap:34px;align-items:center;flex-wrap:wrap">
          <div class="stat">
            <div class="stat-label">Today (live assets)</div>
            <div class="stat-value ${p.dayChange >= 0 ? 'pos-t' : 'neg-t'}">${p.dayChange >= 0 ? '+' : '−'}${fmtINR(Math.abs(p.dayChange), { compact: true })}</div>
            <div class="stat-sub">${p.dayChangePct != null ? fmtPct(p.dayChangePct, 2) : '—'} on market-linked value</div>
          </div>
          <div class="stat">
            <div class="stat-label">Net worth in 10y (median)</div>
            <div class="stat-value">${p50End ? fmtINR(p50End.p50, { compact: true }) : '—'}</div>
            <div class="stat-sub">${p50End ? `range ${fmtINR(p50End.p10, { compact: true })} – ${fmtINR(p50End.p90, { compact: true })}` : ''}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Holdings · loans</div>
            <div class="stat-value">${assets.length} · ${liabs.length}</div>
            <div class="stat-sub">${p.totalEmi ? `${fmtINR(p.totalEmi, { compact: true })}/mo in EMIs` : 'no EMIs'}</div>
          </div>
        </div>
      </div>

      ${insights.length ? `
      <div class="card" style="margin-top:18px">
        <div class="card-title">Insights <span class="right dim">informational, not advice</span></div>
        <div class="insight-list">
          ${insights.map(i => `<div class="insight sev-${i.severity}">
            <div class="insight-icon">${i.icon}</div>
            <div>
              <div class="insight-title">${esc(i.title)}</div>
              <div class="insight-body">${esc(i.body)}</div>
              <div class="insight-src">Based on: ${i.sources.map(s => `<span class="chip">${esc(s)}</span>`).join(' ')}</div>
            </div>
          </div>`).join('')}
        </div>
      </div>` : ''}

      <div class="grid cols-2" style="margin-top:18px">
        <div class="card">
          <div class="card-title">Asset allocation</div>
          <div style="display:flex;gap:22px;align-items:center;flex-wrap:wrap">
            <div class="chart-box" style="flex:0 0 190px">${Charts.donut(slices, { centerLabel: fmtINR(p.totalAssets, { compact: true }), centerSub: 'assets' })}</div>
            <div style="flex:1;min-width:210px">
              ${slices.map((s, i) => `<div class="alloc-row">
                <span class="sw" style="background:${Charts.COLORS[i % Charts.COLORS.length]}"></span>
                <span class="nm">${esc(s.label)}</span>
                <span class="vl">${fmtINR(s.value, { compact: true })}</span>
                <span class="pc">${((s.value / (p.totalAssets || 1)) * 100).toFixed(0)}%</span>
              </div>`).join('')}
              ${liabs.length ? `<div class="alloc-row liab-row">
                <span class="sw" style="background:var(--text-faint)"></span>
                <span class="nm">Liabilities (owed)</span>
                <span class="vl">−${fmtINR(p.totalLiabilities, { compact: true })}</span>
                <span class="pc"><a href="#/liabilities">view</a></span>
              </div>` : ''}
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-title">10-year net-worth outlook <span class="right"><a href="#/projections">Full projections →</a></span></div>
          <div class="chart-box">${Charts.fan(band, { height: 210 })}</div>
          <div class="legend">
            <span class="key"><span class="sw" style="background:#e8b64c"></span>Median path</span>
            <span class="key"><span class="sw" style="background:rgba(232,182,76,0.3)"></span>10th–90th percentile</span>
            <span class="key dim">liabilities amortize out of the fan</span>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:18px">
        <div class="card-title">Asset classes</div>
        <div class="grid cols-4">${classCards}</div>
      </div>

      <div class="grid cols-2" style="margin-top:18px">
        <div class="card">
          <div class="card-title">Today's movers</div>
          ${movers.length ? `<div class="tbl-wrap"><table class="tbl"><tbody>
            ${movers.map(x => `<tr onclick="location.hash='#/asset/${x.a.id}'">
              <td><div class="asset-name">${esc(x.a.label)}</div><div class="asset-sub">${esc(x.v.sub)}</div></td>
              <td class="num">${fmtINR(x.v.currentValue, { compact: true })}</td>
              <td class="num">${deltaChip(x.v.dayChangePct, { digits: 2 })}</td>
            </tr>`).join('')}
          </tbody></table></div>` : `<div class="empty">No live-priced holdings yet.</div>`}
        </div>
        <div class="card">
          <div class="card-title">Best performers (annualized)</div>
          <div class="tbl-wrap"><table class="tbl"><tbody>
            ${vals.filter(x => x.v.annualized != null && x.v.annualizedMethod !== 'Rate').sort((a, b) => b.v.annualized - a.v.annualized).slice(0, 5)
              .map(x => `<tr onclick="location.hash='#/asset/${x.a.id}'">
                <td><div class="asset-name">${esc(x.a.label)}</div><div class="asset-sub">${Store.TYPES[x.a.type].label} · ${x.v.annualizedMethod}</div></td>
                <td class="num">${fmtINR(x.v.currentValue, { compact: true })}</td>
                <td class="num">${pctText(x.v.annualized)}</td>
              </tr>`).join('')}
          </tbody></table></div>
        </div>
      </div>
      <div style="margin-top:18px">${DISCLAIMER}</div>`;
  }

  // ============ HOLDINGS ============
  const COLUMNS = {
    equity: ['Holding', 'Qty', 'Avg cost', 'Invested', 'Current', 'Day', 'P&L', 'Annualized', 'Mode'],
    mf: ['Holding', 'Units', 'Invested', 'Current', 'P&L', 'Annualized', 'Mode'],
    esop: ['Holding', 'Grant', 'Vested / total', 'Vested %', 'Vested value', 'Unvested value', 'Mode'],
    fd: ['Holding', 'Principal', 'Rate', 'Booked', 'Maturity', 'Accrued value', 'Maturity value', 'Mode'],
    smallsavings: ['Holding', 'Scheme', 'In / month', 'Rate', 'Matures', 'Current', 'Maturity value', 'Mode'],
    epf: ['Holding', 'Statement balance', 'As of', 'Monthly in', 'Rate', 'Current', 'Mode'],
    ppf: ['Holding', 'Balance', 'Yearly in', 'Rate', 'Matures', 'Current', 'Mode'],
    nps: ['Holding', 'E/C/G', 'Monthly in', 'Corpus as of', 'Current', 'Mode'],
    gold: ['Holding', 'Form', 'Qty', 'Invested', 'Current', 'P&L', 'Annualized', 'Mode'],
    realestate: ['Holding', 'Purchased', 'Est. value', 'Loan', 'Net equity', 'Growth p.a.', 'Mode'],
    crypto: ['Holding', 'Qty', 'Invested', 'Current', 'P&L', 'Annualized', 'Mode'],
    other: ['Holding', 'Sub-type', 'Cost', 'Current', 'Rate', 'P&L', 'Mode'],
  };

  function holdingRow(a, v, highlight) {
    const d = a.data || {};
    const x = v.extra || {};
    const name = `<td><div class="asset-name">${esc(a.label)}${a.ownership === 'joint' ? ` <span class="chip" title="Joint — your share counted">${a.sharePct}% share</span>` : ''}</div><div class="asset-sub">${esc(v.sub)}</div></td>`;
    const mode = `<td>${modeTag(v.mode)}</td>`;
    const pnl = `<td class="num"><div>${pctText(v.absPct)}</div><div class="asset-sub">${fmtINR(v.absGain, { compact: true })}</div></td>`;
    const ann = `<td class="num"><div>${pctText(v.annualized)}</div><div class="asset-sub">${v.annualizedMethod}</div></td>`;
    let cells = '';
    switch (a.type) {
      case 'equity':
        cells = `${name}<td class="num">${fmtQty(d.quantity)}</td><td class="num">${fmtINR(d.avgPrice, { decimals: 1 })}</td><td class="num">${fmtINR(v.invested, { compact: true })}</td><td class="num"><b>${fmtINR(v.grossValue, { compact: true })}</b></td><td class="num">${deltaChip(v.dayChangePct, { digits: 2 })}</td>${pnl}${ann}${mode}`;
        break;
      case 'mf':
        cells = `${name}<td class="num">${fmtQty(d.units, 2)}</td><td class="num">${fmtINR(v.invested, { compact: true })}</td><td class="num"><b>${fmtINR(v.grossValue, { compact: true })}</b></td>${pnl}${ann}${mode}`;
        break;
      case 'esop':
        cells = `${name}<td>${esc(d.grantType || 'RSU')}${d.isPrivate ? ' · private' : ''}</td><td class="num">${fmtQty(x.vested, 0)} / ${fmtQty(d.totalUnits, 0)}</td><td class="num">${((x.vestedPct || 0) * 100).toFixed(0)}%</td><td class="num"><b>${fmtINR(v.grossValue, { compact: true })}</b></td><td class="num dim">${fmtINR(x.unvestedValue, { compact: true })}</td>${mode}`;
        break;
      case 'fd': {
        const mat = Fin.fdMaturityDate(d.startDate, d.tenureYears);
        cells = `${name}<td class="num">${fmtINR(d.principal, { compact: true })}</td><td class="num">${d.rate}%</td><td>${fmtDate(d.startDate)}</td><td>${fmtDate(mat)}</td><td class="num"><b>${fmtINR(v.grossValue, { compact: true })}</b></td><td class="num">${fmtINR(Fin.fdMaturityValue({ ...d, tenureYears: d.tenureYears, interestType: d.interestType || 'cumulative', compounding: d.compounding || 'quarterly' }), { compact: true })}</td>${mode}`;
        break;
      }
      case 'smallsavings': {
        const names = { rd: 'RD', ssy: 'SSY', kvp: 'KVP', nsc: 'NSC', pomis: 'PO MIS', potd: 'PO TD' };
        const inAmt = d.subType === 'rd' ? `${fmtINR(d.monthlyAmount, { compact: true })}/mo` : d.subType === 'ssy' ? `${fmtINR(d.annualContribution, { compact: true })}/yr` : fmtINR(d.principal, { compact: true });
        cells = `${name}<td>${names[d.subType] || esc(d.subType)}</td><td class="num">${inAmt}</td><td class="num">${d.rate}%</td><td>${fmtDate(x.maturityDate)}</td><td class="num"><b>${fmtINR(v.grossValue, { compact: true })}</b></td><td class="num">${fmtINR(x.maturityValue, { compact: true })}</td>${mode}`;
        break;
      }
      case 'epf':
        cells = `${name}<td class="num">${fmtINR(d.balance, { compact: true })}</td><td>${fmtDate(d.asOfDate)}</td><td class="num">${fmtINR(x.monthly, { compact: true })}/mo</td><td class="num">${d.rate != null ? d.rate : 8.25}%</td><td class="num"><b>${fmtINR(v.grossValue, { compact: true })}</b></td>${mode}`;
        break;
      case 'ppf':
        cells = `${name}<td class="num">${fmtINR(d.balance, { compact: true })}</td><td class="num">${fmtINR(d.annualContribution, { compact: true })}</td><td class="num">${d.rate != null ? d.rate : 7.1}%</td><td>${fmtDate(x.maturityDate)}</td><td class="num"><b>${fmtINR(v.grossValue, { compact: true })}</b></td>${mode}`;
        break;
      case 'nps':
        cells = `${name}<td>E${d.allocE}/C${d.allocC}/G${d.allocG}</td><td class="num">${fmtINR(d.monthlyContribution, { compact: true })}</td><td>${fmtDate(d.asOfDate)}</td><td class="num"><b>${fmtINR(v.grossValue, { compact: true })}</b></td>${mode}`;
        break;
      case 'gold': {
        const qty = (d.form === 'etf' || d.form === 'sgb') ? `${fmtQty(d.units, 2)} u` : `${fmtQty(d.grams, 1)} g`;
        cells = `${name}<td>${esc((d.form || '').toUpperCase())}</td><td class="num">${qty}</td><td class="num">${fmtINR(v.invested, { compact: true })}</td><td class="num"><b>${fmtINR(v.grossValue, { compact: true })}</b></td>${pnl}${ann}${mode}`;
        break;
      }
      case 'realestate': {
        const loanShown = x.linkedLoanBalance != null ? x.linkedLoanBalance : (d.loanBalance || 0);
        cells = `${name}<td>${fmtDate(a.acquiredOn)}</td><td class="num">${fmtINR(v.grossValue, { compact: true })}</td><td class="num">${loanShown ? fmtINR(loanShown, { compact: true }) + (x.linkedLoan ? ' <span class="chip">linked</span>' : '') : '—'}</td><td class="num"><b>${fmtINR(x.netEquity, { compact: true })}</b></td><td class="num">${pctText(v.annualized)}</td>${mode}`;
        break;
      }
      case 'crypto':
        cells = `${name}<td class="num">${fmtQty(d.quantity, 6)}</td><td class="num">${fmtINR(v.invested, { compact: true })}</td><td class="num"><b>${fmtINR(v.grossValue, { compact: true })}</b></td>${pnl}${ann}${mode}`;
        break;
      default:
        cells = `${name}<td>${esc(d.subType || d.subPattern || '')}</td><td class="num">${fmtINR(d.costBasis, { compact: true })}</td><td class="num"><b>${fmtINR(v.grossValue, { compact: true })}</b></td><td class="num">${d.growthRate != null ? (d.growthRate > 0 ? '+' : '') + d.growthRate + '%' : '—'}</td>${pnl}${mode}`;
    }
    return `<tr onclick="location.hash='#/asset/${a.id}'" ${highlight === a.id ? 'class="row-highlight"' : ''}>${cells}</tr>`;
  }

  function holdings(tab, highlightId) {
    tab = Store.TYPES[tab] ? tab : 'equity';
    const assets = Store.byType(tab);
    const t = Store.TYPES[tab];
    let tabTotal = 0, tabInvested = 0;
    const rows = assets.map(a => {
      const v = Store.valuation(a);
      tabTotal += v.currentValue; tabInvested += v.investedShare || 0;
      return holdingRow(a, v, highlightId);
    }).join('');

    return `
      <div class="page-head">
        <div>
          <div class="page-title">Holdings</div>
          <div class="page-sub">Everything you own, by asset class. Click a row for detail, growth and its projection.</div>
        </div>
        <button class="btn primary" onclick="location.hash='#/add/${tab}'">+ Add ${t.label.replace(/s$/, '').toLowerCase()}</button>
      </div>
      <div class="tabs">
        ${Store.TYPE_ORDER.map(k => `<button class="tab ${k === tab ? 'active' : ''}" onclick="location.hash='#/holdings/${k}'">${Store.TYPES[k].icon} ${Store.TYPES[k].label}<span class="count">${Store.byType(k).length}</span></button>`).join('')}
        <button class="tab liab-tab" onclick="location.hash='#/liabilities'">💳 Liabilities<span class="count">${Store.liabilities().length}</span></button>
      </div>
      ${assets.length ? `
        <div style="display:flex;gap:26px;margin-bottom:14px;flex-wrap:wrap">
          <div class="stat"><div class="stat-label">${t.label} — current (your share)</div><div class="stat-value">${fmtINR(tabTotal)}</div></div>
          <div class="stat"><div class="stat-label">Invested</div><div class="stat-value">${fmtINR(tabInvested)}</div></div>
          <div class="stat"><div class="stat-label">Overall</div><div class="stat-value">${tabInvested > 0 ? pctText((tabTotal - tabInvested) / tabInvested) : '—'}</div></div>
        </div>
        <div class="card" style="padding:6px 4px"><div class="tbl-wrap">
          <table class="tbl">
            <thead><tr>${COLUMNS[tab].map((c, i) => `<th class="${i > 0 && !['Mode', 'Form', 'Booked', 'Maturity', 'Purchased', 'Sub-type', 'Scheme', 'As of', 'Matures', 'Grant', 'Corpus as of', 'E/C/G'].includes(c) ? 'num' : ''}">${c}</th>`).join('')}</tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr class="tfoot"><td><b>Total (${assets.length})</b></td><td colspan="${COLUMNS[tab].length - 2}" class="num"><b>${fmtINR(tabTotal)}</b> <span class="dim small">current, your share</span></td><td></td></tr></tfoot>
          </table>
        </div></div>` : `
        <div class="card"><div class="empty">
          <div class="big">${t.icon}</div>
          <p><b>No ${t.label.toLowerCase()} yet.</b></p>
          <p class="small" style="margin:8px 0 16px">${esc(t.desc)}</p>
          <button class="btn primary" onclick="location.hash='#/add/${tab}'">+ Add your first</button>
        </div></div>`}`;
  }

  // ============ LIABILITIES ============
  function liabilitiesView(highlightId) {
    const liabs = Store.liabilities();
    let total = 0, totalEmi = 0, totalInterest = 0;
    const rows = liabs.map(l => {
      const lv = Store.liabilityValuation(l);
      total += lv.balance; totalEmi += l.emi || 0; totalInterest += lv.interestRemaining || 0;
      const t = Store.LIABILITY_TYPES[l.type] || Store.LIABILITY_TYPES.otherloan;
      const linked = l.linkedAssetId ? Store.get(l.linkedAssetId) : null;
      return `<tr onclick="location.hash='#/edit-liability/${l.id}'" ${highlightId === l.id ? 'class="row-highlight"' : ''}>
        <td><div class="asset-name">${t.icon} ${esc(l.label || t.label)}</div><div class="asset-sub">${esc(l.lender || '')}${linked ? ` · linked to ${esc(linked.label)}` : ''}</div></td>
        <td class="num"><b>${fmtINR(lv.balance, { compact: true })}</b></td>
        <td class="num">${l.rate}%</td>
        <td class="num">${l.emi ? fmtINR(l.emi) : '<span class="dim">revolving</span>'}</td>
        <td class="num">${lv.split ? `${fmtINR(lv.split.principal, { compact: true })} / ${fmtINR(lv.split.interest, { compact: true })}` : '—'}</td>
        <td>${lv.payoffDate ? `${fmtDate(lv.payoffDate)} <span class="dim small">(${(lv.payoffMonths / 12).toFixed(1)}y)</span>` : lv.revolving ? '<span class="neg-t small">pay it down</span>' : '—'}</td>
        <td class="num">${lv.interestRemaining != null ? fmtINR(lv.interestRemaining, { compact: true }) : '—'}</td>
      </tr>`;
    }).join('');

    return `
      <div class="page-head">
        <div>
          <div class="page-title">Liabilities</div>
          <div class="page-sub">What you owe. Loans amortize down deterministically; net worth counts assets minus this total.</div>
        </div>
        <button class="btn primary" onclick="location.hash='#/add-liability'">+ Add liability</button>
      </div>
      ${liabs.length ? `
        <div style="display:flex;gap:26px;margin-bottom:14px;flex-wrap:wrap">
          <div class="stat"><div class="stat-label">Total owed</div><div class="stat-value">${fmtINR(total)}</div></div>
          <div class="stat"><div class="stat-label">EMIs / month</div><div class="stat-value">${fmtINR(totalEmi)}</div></div>
          <div class="stat"><div class="stat-label">Interest remaining (EMI loans)</div><div class="stat-value">${fmtINR(totalInterest, { compact: true })}</div></div>
        </div>
        <div class="card" style="padding:6px 4px"><div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>Liability</th><th class="num">Outstanding</th><th class="num">Rate</th><th class="num">EMI</th><th class="num">Next EMI split (P / I)</th><th>Payoff</th><th class="num">Interest left</th></tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr class="tfoot"><td><b>Total (${liabs.length})</b></td><td class="num"><b>${fmtINR(total)}</b></td><td></td><td class="num"><b>${fmtINR(totalEmi)}</b></td><td colspan="3"></td></tr></tfoot>
          </table>
        </div></div>
        <div class="form-note" style="margin-top:14px">Liabilities use a neutral treatment on purpose — owing money isn't a "loss", it's a balance to amortize. Click a row to edit or delete.</div>`
      : `<div class="card"><div class="empty">
          <div class="big">💳</div>
          <p><b>No liabilities tracked.</b></p>
          <p class="small" style="margin:8px 0 16px">Add home/car/personal/education loans or card balances so net worth is honest: assets − liabilities.</p>
          <button class="btn primary" onclick="location.hash='#/add-liability'">+ Add your first</button>
        </div></div>`}`;
  }

  // ============ ASSET DETAIL ============
  function assetDetail(id) {
    const a = Store.get(id);
    if (!a) return `<div class="card"><div class="empty">Asset not found. <a href="#/holdings/equity">Back to holdings</a></div></div>`;
    const v = Store.valuation(a);
    const d = a.data || {};
    const x = v.extra || {};
    const t = Store.TYPES[a.type];

    // ------- chart per valuation mode -------
    const LIVE_HISTORY = ['equity', 'mf', 'crypto', 'gold'];
    let chartHtml = '', chartCaption = '';
    if (v.mode === 'live' && LIVE_HISTORY.includes(a.type)) {
      let key, price, sigma, mu, fxMul = 1;
      if (a.type === 'equity') { const s = Market.getStock(d.symbol); key = d.symbol; price = s ? s.price : 0; sigma = v.sigma; mu = v.mu; fxMul = s && s.currency === 'USD' ? Market.FX.USDINR : 1; }
      else if (a.type === 'mf') { key = d.schemeCode; price = Market.schemeNav(d.schemeCode, d.plan) || 0; sigma = v.sigma; mu = v.mu; }
      else if (a.type === 'crypto') { const c = Market.getCoin(d.coinId); key = d.coinId; price = c ? c.priceUSD : 0; sigma = v.sigma; mu = v.mu; fxMul = Market.FX.USDINR; }
      else { key = 'metal:' + (d.metal || 'gold'); price = d.form === 'etf' || d.form === 'sgb' ? (Market.getGoldUnit(d.instrumentId) || { price: d.lastUnitPrice || 0 }).price : (Market.metalRate(d.metal || 'gold') || {}).perGram * Market.purityFactor(d.purity || '24K'); sigma = v.sigma; mu = v.mu; }
      const hist = Market.priceHistory(key, price * fxMul, 250, sigma, mu);
      const yr = new Date().getFullYear();
      chartHtml = Charts.line(hist, { xLabels: [`${yr - 1}`, '', `${yr}`], yFmt: Charts.compactINR });
      chartCaption = 'Simulated 12-month price history (₹) — swap in a live feed for production.';
    } else if (a.type === 'esop' && d.ticker && !d.isPrivate) {
      const s = Market.getStock(d.ticker);
      const fxMul = s && s.currency === 'USD' ? Market.FX.USDINR : 1;
      const hist = Market.priceHistory(d.ticker, (s ? s.price : 0) * fxMul, 250, v.sigma, v.mu);
      const yr = new Date().getFullYear();
      chartHtml = Charts.line(hist, { xLabels: [`${yr - 1}`, '', `${yr}`], yFmt: Charts.compactINR });
      chartCaption = `${esc(d.ticker)} — simulated 12-month share price (₹).`;
    } else if (v.mode === 'computed' || a.type === 'nps') {
      const yearsAhead = a.type === 'fd' ? Math.max(1, Math.ceil(d.tenureYears - v.years) + 1) : a.type === 'epf' ? Math.max(5, x.yearsToRetirement || 10) : 10;
      const band = Store.projectionBand(a, Math.min(yearsAhead, 30), 36);
      chartHtml = Charts.fan(band, { color: a.type === 'nps' ? '#5b9dff' : '#b18cff' });
      chartCaption = a.type === 'fd'
        ? `Contractual compounding curve to maturity${(d.autoRenew && d.autoRenew !== 'none') ? ', then auto-renewed' : ''}. No Monte Carlo.`
        : a.type === 'nps'
          ? `Market-linked Monte Carlo band from your E${d.allocE}/C${d.allocC}/G${d.allocG} blend, with contributions.`
          : a.type === 'epf'
            ? `Contractual curve with your monthly contributions, to retirement age ${d.retirementAge || 60}.`
            : 'Contractual/deterministic growth curve with your contributions. No Monte Carlo.';
    } else {
      const band = Store.projectionBand(a, 10, 36);
      chartHtml = Charts.fan(band, { color: '#ffb75b' });
      chartCaption = 'Deterministic curve at your assumed rate (band flexes the rate ±2pp). Value is your estimate.';
    }

    // ------- projection fan (10y, all modes) -------
    const projBand = Store.projectionBand(a, 10, 36);
    const projEnd = projBand ? projBand[projBand.length - 1] : null;

    // ------- vesting timeline (ESOP only) -------
    let vestingHtml = '';
    if (a.type === 'esop' && x.schedule) {
      const events = Fin.vestEvents(x.schedule);
      const upcoming = events.filter(e => !e.done).slice(0, 4);
      vestingHtml = `
      <div class="card" style="margin-top:18px">
        <div class="card-title">Vesting schedule</div>
        <div style="display:flex;gap:26px;flex-wrap:wrap;margin-bottom:12px">
          <div class="stat"><div class="stat-label">Vested</div><div class="stat-value">${fmtQty(x.vested, 0)} <span class="dim small">/ ${fmtQty(d.totalUnits, 0)}</span></div><div class="stat-sub">${fmtINR(v.grossValue, { compact: true })} at today's price</div></div>
          <div class="stat"><div class="stat-label">Unvested</div><div class="stat-value dim">${fmtQty(x.unvested, 0)}</div><div class="stat-sub">${fmtINR(x.unvestedValue, { compact: true })} — excluded from net worth</div></div>
          <div class="stat"><div class="stat-label">Fully vests</div><div class="stat-value">${fmtDate(events.length ? events[events.length - 1].date : null)}</div><div class="stat-sub">${d.cliffMonths || 0}-month cliff, then ${d.freq || 'quarterly'}</div></div>
        </div>
        <div class="vest-bar"><div class="vest-fill" style="width:${((x.vestedPct || 0) * 100).toFixed(1)}%"></div>
          <div class="vest-marks">${events.map(e2 => `<span class="vest-mark ${e2.done ? 'done' : ''}" style="left:${(e2.cumFrac * 100).toFixed(1)}%" title="${fmtDate(e2.date)} · ${fmtQty(e2.units, 0)} units"></span>`).join('')}</div>
        </div>
        <div class="vest-legend"><span>${fmtDate(x.schedule.startDate)}</span><span>${((x.vestedPct || 0) * 100).toFixed(0)}% vested</span><span>${fmtDate(events.length ? events[events.length - 1].date : null)}</span></div>
        ${upcoming.length ? `<table class="tbl" style="margin-top:10px"><thead><tr><th>Next vest events</th><th class="num">Units</th><th class="num">Value at today's price</th></tr></thead><tbody>
          ${upcoming.map(e2 => `<tr><td>${fmtDate(e2.date)}</td><td class="num">${fmtQty(e2.units, 0)}</td><td class="num">${fmtINR(e2.units * (x.perUnit || 0), { compact: true })}</td></tr>`).join('')}
        </tbody></table>` : '<div class="small dim" style="margin-top:8px">Fully vested 🎉</div>'}
      </div>`;
    }

    // ------- facts grid -------
    const facts = [];
    const add = (k, val2) => { if (val2 != null && val2 !== '' && val2 !== undefined) facts.push(`<div class="kv"><div class="k">${k}</div><div class="v">${val2}</div></div>`); };
    add('Type', `${t.icon} ${t.label}`);
    add('Acquired', fmtDate(a.acquiredOn));
    add('Holding period', v.years < 1 ? `${Math.round(v.years * 12)} months` : `${v.years.toFixed(1)} years`);
    add('Ownership', a.ownership === 'joint' ? `Joint — your share ${a.sharePct}%` : 'Single');
    if (v.fx) add('FX', `Priced in ${v.fx.currency}, converted @ ₹${v.fx.rate}/$`);
    if (a.type === 'equity') { add('Symbol', esc(d.symbol)); add('Quantity', fmtQty(d.quantity)); add('Avg buy price', fmtINR(d.avgPrice, { decimals: 1 })); if (d.dividends) add('Dividends received', fmtINR(d.dividends)); if (d.isin) add('ISIN', esc(d.isin)); }
    if (a.type === 'mf') { const s = Market.getScheme(d.schemeCode); add('Scheme', esc(s ? s.name : d.schemeCode)); add('Plan / option', `${esc(d.plan)} · ${esc(d.option)}`); add('Units', fmtQty(d.units, 3)); add('Avg cost NAV', fmtINR(d.avgNav, { decimals: 1 })); if (d.sipOngoing) add('SIP', `${fmtINR(d.sipAmount)} / ${d.sipFreq || 'monthly'} (ongoing)`); if (d.folio) add('Folio', esc(d.folio)); }
    if (a.type === 'esop') { add('Company', esc(d.company)); if (d.ticker) add('Ticker', esc(d.ticker)); add('Grant type', esc(d.grantType)); if (d.strike != null) { add('Strike', `${d.currency === 'USD' ? '$' : '₹'}${fmtQty(d.strike, 2)}`); add('Intrinsic / unit', fmtINR(x.perUnit, { decimals: 1 })); } add('Share price', fmtINR(x.price, { decimals: 1 })); if (d.isPrivate) add('Liquidity', '<span class="tag manual"><span class="dot"></span>Illiquid · assumption-based</span>'); if (d.exitNote) add('Exit assumption', esc(d.exitNote)); }
    if (a.type === 'fd') {
      add('Bank / institution', esc(d.bank || '—') + (d.institutionType && d.institutionType !== 'bank' ? ` (${d.institutionType})` : ''));
      add('Principal', fmtINR(d.principal)); add('Rate (locked)', `${d.rate}% p.a.`);
      add('Compounding', esc(d.compounding)); add('Interest type', d.interestType === 'payout' ? 'Non-cumulative (payout)' : 'Cumulative');
      add('Matures', fmtDate(Fin.fdMaturityDate(d.startDate, d.tenureYears)));
      add('Maturity value', fmtINR(Fin.fdMaturityValue({ ...d, interestType: d.interestType || 'cumulative', compounding: d.compounding || 'quarterly' })));
      if (d.interestType === 'payout') add('Payout / period', fmtINR(Fin.fdPayoutPerPeriod(d)));
      if (d.autoRenew && d.autoRenew !== 'none') add('Auto-renew', d.autoRenew === 'principal' ? 'Principal only' : 'Principal + interest');
      if (d.taxSaver) add('Tax-saver', '5-yr 80C lock-in');
      if (d.fdNumber) add('FD number', esc(d.fdNumber));
      add('Status', esc(d.status || 'active'));
    }
    if (a.type === 'smallsavings') { add('Scheme', esc(d.subType).toUpperCase()); if (d.principal) add('Principal', fmtINR(d.principal)); if (d.monthlyAmount) add('Monthly deposit', fmtINR(d.monthlyAmount)); if (d.annualContribution) add('Annual contribution', fmtINR(d.annualContribution)); add('Rate (locked)', `${d.rate}%`); add('Matures', fmtDate(x.maturityDate)); add('Maturity value', fmtINR(x.maturityValue)); if (x.monthlyIncome) add('Monthly income', fmtINR(x.monthlyIncome)); }
    if (a.type === 'epf') { add('Statement balance', `${fmtINR(d.balance)} ${freshChip('as of ' + fmtDate(d.asOfDate))}`); add('Monthly in (you + employer)', `${fmtINR(d.empContribution)} + ${fmtINR(d.erContribution)}${d.vpf ? ' + ' + fmtINR(d.vpf) + ' VPF' : ''}`); add('Rate', `${d.rate != null ? d.rate : 8.25}% p.a.`); add(`Corpus at ${d.retirementAge || 60}`, fmtINR(x.retirementCorpus, { compact: true })); if (d.uan) add('UAN', esc(d.uan)); }
    if (a.type === 'ppf') { add('Balance', `${fmtINR(d.balance)} ${freshChip('as of ' + fmtDate(d.asOfDate))}`); add('Annual contribution', fmtINR(d.annualContribution)); add('Rate', `${d.rate != null ? d.rate : 7.1}%`); add('Matures', `${fmtDate(x.maturityDate)}${d.extensionYears ? ` (+${d.extensionYears}y ext.)` : ''}`); add('Maturity value', fmtINR(x.maturityValue, { compact: true })); }
    if (a.type === 'nps') { add('Corpus', `${fmtINR(d.corpus)} ${freshChip('as of ' + fmtDate(d.asOfDate))}`); add('Tier', esc(d.tier || 'I')); add('Allocation', `E ${d.allocE}% · C ${d.allocC}% · G ${d.allocG}%`); if (x.blend) add('Blended μ / σ', `${(x.blend.mu * 100).toFixed(1)}% / ${(x.blend.sigma * 100).toFixed(1)}%`); add('Monthly contribution', fmtINR(d.monthlyContribution)); if (d.pran) add('PRAN', esc(d.pran)); }
    if (a.type === 'gold') {
      add('Form', esc((d.form || '').toUpperCase()));
      if (d.grams) { add('Weight', `${fmtQty(d.grams, 2)} g`); add('Purity', esc(d.purity)); }
      if (d.units) add('Units', fmtQty(d.units, 3));
      if (d.makingCharges) add('Making charges', `${fmtINR(d.makingCharges)} (non-recoverable)`);
      if (d.form === 'sgb') { add('SGB interest', `${d.sgbRate != null ? d.sgbRate : 2.5}% p.a. fixed`); if (d.sgbMaturity) add('SGB matures', fmtDate(d.sgbMaturity)); }
    }
    if (a.type === 'realestate') {
      add('Property', `${esc(d.propertyType)}${d.locality ? ' · ' + esc(d.locality) : ''}${d.city ? ', ' + esc(d.city) : ''}`);
      add('Purchase price', fmtINR(d.purchasePrice));
      if (d.acquisitionCosts) add('Acquisition costs', fmtINR(d.acquisitionCosts));
      if (d.sqft) add('Size', `${fmtQty(d.sqft, 0)} sq ft${d.ratePerSqft ? ` @ ${fmtINR(d.ratePerSqft)}/sq ft` : ''}`);
      if (x.linkedLoan) { add('Linked loan', `${esc(x.linkedLoan.label)} — ${fmtINR(x.linkedLoanBalance, { compact: true })} outstanding`); add('Net equity', fmtINR(x.netEquity)); }
      else if (d.loanBalance) { add('Outstanding loan (inline)', fmtINR(d.loanBalance)); add('Net equity (counted)', fmtINR(v.fullValue)); }
      if (d.loanEmi) add('EMI', `${fmtINR(d.loanEmi)}/mo${d.loanRate ? ` @ ${d.loanRate}%` : ''}`);
      if (d.rentPerMonth) add('Rent', `${fmtINR(d.rentPerMonth)}/mo`);
      add('Assumed appreciation', `${d.appreciationRate}% p.a.`);
      add('Last revalued', `${fmtDate(d.lastRevaluedOn)} ${freshChip('your estimate')}`);
    }
    if (a.type === 'crypto') { add('Coin', esc(d.coinId)); add('Quantity', fmtQty(d.quantity, 8)); add('Avg buy price', `${d.investCurrency === 'USD' ? '$' : '₹'}${fmtQty(d.avgPrice, 2)}`); if (d.wallet) add('Wallet', esc(d.wallet)); if (d.stakingYield) add('Staking', `${d.stakingYield}% p.a.`); }
    if (a.type === 'other') { add('Sub-type', esc(d.subType || d.subPattern)); add('Cost basis', fmtINR(d.costBasis)); add('Assumed rate', `${d.growthRate > 0 ? '+' : ''}${d.growthRate}% p.a.`); if (d.lastRevaluedOn) add('Last revalued', `${fmtDate(d.lastRevaluedOn)} ${freshChip('your estimate')}`); }
    if (d.lots && d.lots.length) add('Transaction lots', `${d.lots.length} buys (XIRR-based return)`);
    if (a.tags && a.tags.length) add('Tags', a.tags.map(x2 => `<span class="chip">${esc(x2)}</span>`).join(' '));

    const manualPanel = v.mode === 'manual' ? `
      <div class="card">
        <div class="card-title">Manual valuation</div>
        <p class="dim small" style="margin-bottom:12px">This asset has no market feed — its current value is your estimate${d.lastRevaluedOn ? `, last revalued <b>${fmtDate(d.lastRevaluedOn)}</b>` : ''}. Keep it fresh.</p>
        <button class="btn" onclick="location.hash='#/edit/${a.id}'">Update value</button>
      </div>` : '';

    const statementTypes = { epf: d.asOfDate, ppf: d.asOfDate, nps: d.asOfDate };
    const statementPanel = statementTypes[a.type] ? `
      <div class="card">
        <div class="card-title">Statement freshness</div>
        <p class="dim small" style="margin-bottom:12px">Balance last updated from your statement on <b>${fmtDate(statementTypes[a.type])}</b> — contributions since are added at the contract rate. Update it when the next statement arrives.</p>
        <button class="btn" onclick="location.hash='#/edit/${a.id}'">Update from statement</button>
      </div>` : '';

    return `
      <button class="back-link" onclick="history.length > 1 ? history.back() : location.hash='#/holdings/${a.type}'">← Back</button>
      <div class="page-head">
        <div>
          <div class="page-title">${esc(a.label)} ${modeTag(v.mode)}</div>
          <div class="page-sub">${esc(v.sub)}</div>
        </div>
        <div style="display:flex;gap:10px">
          <button class="btn" onclick="location.hash='#/edit/${a.id}'">✎ Edit</button>
          <button class="btn danger" onclick="UI.confirmDelete('${a.id}')">Delete</button>
        </div>
      </div>

      <div class="grid cols-4">
        <div class="card"><div class="stat-label">Current value ${a.ownership === 'joint' ? '(your share)' : ''}</div><div class="stat-value">${fmtINR(v.currentValue)}</div>
          ${v.dayChangePct != null ? `<div class="stat-sub">today ${deltaChip(v.dayChangePct, { digits: 2 })}</div>` : `<div class="stat-sub">${v.mode === 'computed' ? 'accrued as of today' : v.mode === 'manual' ? 'your estimate' : 'vested at today’s price'}</div>`}</div>
        <div class="card"><div class="stat-label">Invested (cost basis)</div><div class="stat-value">${v.invested != null ? fmtINR(v.invested) : '—'}</div><div class="stat-sub">${a.type === 'esop' ? 'grants have no cash cost' : 'acquired ' + fmtDate(a.acquiredOn)}</div></div>
        <div class="card"><div class="stat-label">Absolute return</div><div class="stat-value ${(v.absGain || 0) >= 0 ? 'pos-t' : 'neg-t'}">${v.absGain != null ? fmtINR(v.absGain, { compact: true }) : '—'}</div><div class="stat-sub">${v.absPct != null ? fmtPct(v.absPct) : '—'} on invested</div></div>
        <div class="card"><div class="stat-label">Annualized (${v.annualizedMethod})</div><div class="stat-value">${v.annualized != null ? `<span class="${v.annualized >= 0 ? 'pos-t' : 'neg-t'}">${fmtPct(v.annualized)}</span>` : '—'}</div><div class="stat-sub">${v.annualizedMethod === 'XIRR' ? 'true rate across your staggered buys' : v.annualizedMethod === 'Rate' ? 'contract rate' : v.annualizedMethod === 'CAGR' ? 'single lump-sum holding' : ''}</div></div>
      </div>

      ${v.notes.length ? `<div class="card" style="margin-top:18px"><div class="card-title">Notes on this holding</div>${v.notes.map(n => `<div class="small dim" style="padding:4px 0">• ${n}</div>`).join('')}</div>` : ''}

      ${vestingHtml}

      <div class="grid cols-2" style="margin-top:18px">
        <div class="card">
          <div class="card-title">${v.mode === 'live' && LIVE_HISTORY.includes(a.type) || (a.type === 'esop' && d.ticker && !d.isPrivate) ? 'Price history' : v.mode === 'computed' || a.type === 'nps' ? (a.type === 'nps' ? 'Projection (market-linked blend)' : 'Contractual curve') : 'Assumed-growth curve'}</div>
          <div class="chart-box">${chartHtml}</div>
          <div class="small faint" style="margin-top:8px">${chartCaption}</div>
        </div>
        <div class="card">
          <div class="card-title">10-year projection ${v.mode === 'live' ? '(Monte Carlo band)' : '(deterministic)'}</div>
          <div class="chart-box">${Charts.fan(projBand, { height: 240 })}</div>
          ${projEnd ? `<div class="small dim" style="margin-top:8px">Median in 10y: <b>${fmtINR(projEnd.p50, { compact: true })}</b>${projEnd.p90 - projEnd.p10 > 1 ? ` · range ${fmtINR(projEnd.p10, { compact: true })} – ${fmtINR(projEnd.p90, { compact: true })}` : ''}</div>` : ''}
        </div>
      </div>

      ${manualPanel || statementPanel ? `<div style="margin-top:18px">${manualPanel}${statementPanel}</div>` : ''}

      <div class="card" style="margin-top:18px">
        <div class="card-title">Details</div>
        <div class="kv-grid">${facts.join('')}</div>
        ${a.notes ? `<div class="small dim" style="margin-top:14px">📝 ${esc(a.notes)}</div>` : ''}
      </div>
      <div style="margin-top:18px">${DISCLAIMER}</div>`;
  }

  // ============ PROJECTIONS ============
  function projections(horizon, netMode) {
    horizon = horizon || 10;
    const showNet = netMode !== 'assets';
    const band = Store.portfolioBand(horizon, 48, showNet);
    const end = band.length ? band[band.length - 1] : null;
    const p = Store.portfolio();
    const startVal = showNet ? p.netWorth : p.totalAssets;

    const rows = Store.all().map(a => {
      const v = Store.valuation(a);
      const b = Store.projectionBand(a, horizon, 12);
      const e = b ? b[b.length - 1] : null;
      return { a, v, e };
    }).filter(x => x.e).sort((x, y) => y.e.p50 - x.e.p50);

    const liabNow = p.totalLiabilities;
    const lc = Store.liabilityCurve(horizon, 12);
    const liabEnd = lc.length ? lc[lc.length - 1].total : 0;

    return `
      <div class="page-head">
        <div>
          <div class="page-title">Projections</div>
          <div class="page-sub">Each asset is projected by its valuation mode — Monte Carlo bands for market-linked holdings (width scales with volatility), single deterministic curves for contractual and assumed-rate assets — then aggregated. Liabilities amortize down deterministically.</div>
        </div>
        <div class="proj-controls">
          <div class="seg">
            <button class="${showNet ? 'on' : ''}" onclick="location.hash='#/projections/${horizon}/net'">Net worth</button>
            <button class="${!showNet ? 'on' : ''}" onclick="location.hash='#/projections/${horizon}/assets'">Assets only</button>
          </div>
          <span class="dim small">Horizon</span>
          <div class="seg" id="horizon_seg">
            ${[1, 3, 5, 10, 20].map(h => `<button class="${h === horizon ? 'on' : ''}" onclick="location.hash='#/projections/${h}/${showNet ? 'net' : 'assets'}'">${h}y</button>`).join('')}
          </div>
        </div>
      </div>

      ${DISCLAIMER}

      <div class="card" style="margin-top:18px">
        <div class="card-title">${showNet ? 'Net worth' : 'Assets'} — ${horizon}-year fan${showNet && liabNow > 0 ? ` <span class="right dim">liabilities: ${fmtINR(liabNow, { compact: true })} → ${fmtINR(liabEnd, { compact: true })}</span>` : ''}</div>
        <div style="display:flex;gap:30px;flex-wrap:wrap;margin-bottom:12px">
          <div class="stat"><div class="stat-label">Today</div><div class="stat-value">${fmtINR(startVal, { compact: true })}</div></div>
          <div class="stat"><div class="stat-label">Median in ${horizon}y</div><div class="stat-value" style="color:var(--brand)">${end ? fmtINR(end.p50, { compact: true }) : '—'}</div>
            <div class="stat-sub">${end && startVal > 0 && end.p50 > 0 ? fmtPct(Math.pow(end.p50 / startVal, 1 / horizon) - 1) + ' implied p.a.' : ''}</div></div>
          <div class="stat"><div class="stat-label">Conservative (p10)</div><div class="stat-value">${end ? fmtINR(end.p10, { compact: true }) : '—'}</div></div>
          <div class="stat"><div class="stat-label">Optimistic (p90)</div><div class="stat-value">${end ? fmtINR(end.p90, { compact: true }) : '—'}</div></div>
        </div>
        <div class="chart-box">${Charts.fan(band, { height: 300 })}</div>
        <div class="legend">
          <span class="key"><span class="sw" style="background:#e8b64c"></span>Median path</span>
          <span class="key"><span class="sw" style="background:rgba(232,182,76,0.3)"></span>10th–90th percentile band</span>
          ${showNet && liabNow > 0 ? '<span class="key dim">net of amortizing loan balances</span>' : ''}
        </div>
      </div>

      <div class="card" style="margin-top:18px">
        <div class="card-title">Per-asset projection at ${horizon} years</div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Holding</th><th>Method</th><th class="num">Today</th><th class="num">Median +${horizon}y</th><th class="num">Range (p10–p90)</th></tr></thead>
          <tbody>
            ${rows.map(x => `<tr onclick="location.hash='#/asset/${x.a.id}'">
              <td><div class="asset-name">${esc(x.a.label)}</div><div class="asset-sub">${Store.TYPES[x.a.type].label}</div></td>
              <td>${modeTag(x.v.mode)} <span class="small faint">${x.v.mode === 'live' ? `σ ${(x.v.sigma * 100).toFixed(0)}%` : x.v.mode === 'computed' ? 'contractual' : 'assumed rate'}</span></td>
              <td class="num">${fmtINR(x.v.currentValue, { compact: true })}</td>
              <td class="num"><b>${fmtINR(x.e.p50, { compact: true })}</b></td>
              <td class="num">${Math.abs(x.e.p90 - x.e.p10) < Math.max(1, x.e.p50 * 0.001) ? '<span class="dim">deterministic</span>' : `${fmtINR(x.e.p10, { compact: true })} – ${fmtINR(x.e.p90, { compact: true })}`}</td>
            </tr>`).join('')}
            ${liabNow > 0 ? `<tr onclick="location.hash='#/liabilities'">
              <td><div class="asset-name">Liabilities (all)</div><div class="asset-sub">amortizing down</div></td>
              <td><span class="chip">owed</span></td>
              <td class="num">−${fmtINR(liabNow, { compact: true })}</td>
              <td class="num"><b>−${fmtINR(liabEnd, { compact: true })}</b></td>
              <td class="num"><span class="dim">deterministic</span></td>
            </tr>` : ''}
          </tbody>
        </table></div>
        <div class="small faint" style="margin-top:10px">Debt & liquid funds get far narrower bands than equity; crypto bands are widest by design. FDs, EPF, PPF and small savings follow their contract terms; NPS blends E/C/G; manual assets compound your assumed rate.</div>
      </div>`;
  }

  // ============ SETTINGS / DATA SOURCES ============
  function settings() {
    const SOURCES = [
      { name: 'Equity LTP (NSE/BSE)', mode: 'live', src: 'Simulated feed — swap for an exchange/broker API', fresh: 'per session' },
      { name: 'Mutual fund NAV', mode: 'live', src: 'Simulated — swap for AMFI daily NAV', fresh: 'per session' },
      { name: 'RSU / ESOP share price', mode: 'live', src: 'Listed: ticker feed · Private: your 409A/last-round value', fresh: 'listed live · private manual' },
      { name: 'NPS', mode: 'live', src: 'E/C/G blend from your allocation; corpus from your CRA statement', fresh: 'statement date' },
      { name: 'Crypto prices + USD/INR FX', mode: 'live', src: 'Simulated — swap for an exchange API', fresh: 'per session' },
      { name: 'Gold / silver spot', mode: 'live', src: 'Simulated per-gram rate (24K/999 basis)', fresh: 'per session' },
      { name: 'Fixed deposits & small savings', mode: 'computed', src: 'Your entered contract terms — rate, tenure, compounding', fresh: 'contract' },
      { name: 'EPF / PF', mode: 'computed', src: 'Manual statement balance + statutory rate', fresh: 'your last statement' },
      { name: 'PPF', mode: 'computed', src: 'Passbook balance + government rate', fresh: 'your last statement' },
      { name: 'Loans & liabilities', mode: 'computed', src: 'Amortization from balance, EMI and rate', fresh: 'your last statement' },
      { name: 'Real estate & physical assets', mode: 'manual', src: 'Your estimates', fresh: 'last revalued date' },
    ];
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    return `
      <div class="page-head">
        <div>
          <div class="page-title">Settings</div>
          <div class="page-sub">Where every number comes from, and how the app looks.</div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Appearance</div>
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <div class="seg">
            <button class="${theme === 'dark' ? 'on' : ''}" onclick="UI.setTheme('dark')">🌙 Dark</button>
            <button class="${theme === 'light' ? 'on' : ''}" onclick="UI.setTheme('light')">☀️ Light</button>
          </div>
          <span class="dim small">Both themes keep AA contrast; charts re-tint automatically.</span>
        </div>
      </div>
      <div class="card" style="margin-top:18px">
        <div class="card-title">Data sources</div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Feed</th><th>Mode</th><th>Source</th><th>Freshness</th></tr></thead>
          <tbody>${SOURCES.map(s => `<tr style="cursor:default">
            <td class="asset-name">${esc(s.name)}</td>
            <td>${modeTag(s.mode)}</td>
            <td class="dim">${esc(s.src)}</td>
            <td class="dim small">${esc(s.fresh)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        <div class="small faint" style="margin-top:10px">This demo simulates market feeds deterministically so it runs anywhere; <code>js/market.js</code> is the single swap-in point for real APIs.</div>
      </div>
      <div class="card" style="margin-top:18px">
        <div class="card-title">Data</div>
        <p class="dim small" style="margin-bottom:12px">Holdings and liabilities persist in this browser (localStorage). Reset restores the sample portfolio.</p>
        <button class="btn danger" onclick="UI.resetDemo()">Reset demo data</button>
      </div>`;
  }

  return { dashboard, holdings, liabilitiesView, assetDetail, projections, settings };
})();
