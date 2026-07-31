/* ============================================================
   WealthForge AI — asset & liability store
   Asset model, per-type valuation dispatcher (current value,
   growth %, annualized/XIRR, projection), liabilities with
   amortization, localStorage persistence, seed demo portfolio.
   Net worth = total assets − total liabilities.
   ============================================================ */

const Store = (() => {
  const KEY = 'wealthforge.v2';

  // Asset type registry — drives tabs, forms, valuation mode
  const TYPES = {
    equity:       { id: 'equity',       label: 'Equity',         icon: '📈', mode: 'live',     desc: 'Listed shares on NSE/BSE — live LTP' },
    mf:           { id: 'mf',           label: 'Mutual Funds',   icon: '🧺', mode: 'live',     desc: 'MF schemes by NAV — SIP & lump sum' },
    esop:         { id: 'esop',         label: 'ESOPs / RSUs',   icon: '💼', mode: 'live',     desc: 'Grants with vesting — public or private' },
    crypto:       { id: 'crypto',       label: 'Crypto',         icon: '🪙', mode: 'live',     desc: 'Coins & tokens — live price, high volatility' },
    fd:           { id: 'fd',           label: 'Fixed Deposits', icon: '🏦', mode: 'computed', desc: 'Bank/NBFC/post-office FDs — locked terms' },
    smallsavings: { id: 'smallsavings', label: 'Small Savings',  icon: '📮', mode: 'computed', desc: 'RD, SSY, KVP, NSC, PO MIS/TD' },
    epf:          { id: 'epf',          label: 'EPF / PF',       icon: '🛡️', mode: 'computed', desc: 'Provident fund — statement balance + contributions' },
    ppf:          { id: 'ppf',          label: 'PPF',            icon: '🌱', mode: 'computed', desc: '15-year small-savings account, ₹1.5L/yr cap' },
    nps:          { id: 'nps',          label: 'NPS',            icon: '🎯', mode: 'live',     desc: 'Market-linked retirement — E/C/G blend' },
    gold:         { id: 'gold',         label: 'Gold & Silver',  icon: '🥇', mode: 'live',     desc: 'Physical, digital, SGB, ETF' },
    realestate:   { id: 'realestate',   label: 'Real Estate',    icon: '🏠', mode: 'manual',   desc: 'Property — manually revalued' },
    other:        { id: 'other',        label: 'Others',         icon: '🗃️', mode: 'manual',   desc: 'Vehicles, art, bonds, P2P…' },
  };
  const TYPE_ORDER = ['equity', 'mf', 'esop', 'crypto', 'fd', 'smallsavings', 'epf', 'ppf', 'nps', 'gold', 'realestate', 'other'];

  // Type-picker groups (spec §4: keep the bigger grid scannable)
  const TYPE_GROUPS = [
    { title: 'Market-linked', types: ['equity', 'mf', 'crypto', 'esop'] },
    { title: 'Deposits & small savings', types: ['fd', 'smallsavings'] },
    { title: 'Retirement', types: ['epf', 'ppf', 'nps'] },
    { title: 'Property & physical', types: ['realestate', 'gold'] },
    { title: 'Other', types: ['other'] },
  ];

  // Liability type registry
  const LIABILITY_TYPES = {
    homeloan:   { id: 'homeloan',   label: 'Home loan',        icon: '🏠' },
    carloan:    { id: 'carloan',    label: 'Car loan',         icon: '🚗' },
    personal:   { id: 'personal',   label: 'Personal loan',    icon: '👤' },
    education:  { id: 'education',  label: 'Education loan',   icon: '🎓' },
    creditcard: { id: 'creditcard', label: 'Credit card',      icon: '💳' },
    otherloan:  { id: 'otherloan',  label: 'Other loan',       icon: '📋' },
  };

  let state = { assets: [], liabilities: [], snapshots: [], goals: [] };
  let readOnly = false;     // demo mode: all mutations are no-ops
  let persistLocal = true;  // false when data lives in Supabase
  let onMutate = null;      // cloud write-through hook: (collection, op, record) => {}

  function emit(collection, op, record) {
    if (onMutate) { try { onMutate(collection, op, record); } catch (e) { /* sync errors surface in Cloud */ } }
  }
  function setOnMutate(fn) { onMutate = fn; }
  function isReadOnly() { return readOnly; }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        state = JSON.parse(raw);
        state.assets = state.assets || [];
        state.liabilities = state.liabilities || [];
        state.snapshots = state.snapshots || [];
        state.goals = state.goals || [];
        // pre-snapshot installs that still hold the untouched sample
        // portfolio get its reconstructed history too
        if (!state.snapshots.length && looksLikeSeed(state.assets)) {
          state.snapshots = backfillSnapshots();
          save();
        }
        return;
      }
    } catch (e) { /* corrupted → reseed */ }
    state = seed();
    state.snapshots = backfillSnapshots();
    save();
  }
  function save() {
    if (!persistLocal) return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  }

  // Replace local state with cloud data (Supabase mode).
  function setRemote(data, opts = {}) {
    state = {
      assets: data.assets || [],
      liabilities: data.liabilities || [],
      snapshots: data.snapshots || [],
      goals: data.goals || [],
    };
    readOnly = !!opts.readOnly;
    persistLocal = false;
  }
  function setLocalMode() {
    readOnly = false;
    persistLocal = true;
    load();
  }

  function uid() {
    // uuids so records can be upserted straight into Postgres
    try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* fall through */ }
    return 'a' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
  }

  // ---------- asset CRUD ----------
  function all() { return state.assets; }
  function byType(type) { return state.assets.filter(a => a.type === type); }
  function get(id) { return state.assets.find(a => a.id === id) || null; }
  function add(asset) {
    if (readOnly) return null;
    asset.id = asset.id || uid();
    asset.createdAt = asset.createdAt || new Date().toISOString();
    state.assets.push(asset);
    save();
    emit('assets', 'upsert', asset);
    return asset;
  }
  function update(id, patch) {
    if (readOnly) return null;
    const i = state.assets.findIndex(a => a.id === id);
    if (i < 0) return null;
    state.assets[i] = { ...state.assets[i], ...patch, id };
    save();
    emit('assets', 'upsert', state.assets[i]);
    return state.assets[i];
  }
  function remove(id) {
    if (readOnly) return;
    state.assets = state.assets.filter(a => a.id !== id);
    // unlink any liability pointing at it
    state.liabilities.forEach(l => {
      if (l.linkedAssetId === id) { delete l.linkedAssetId; emit('liabilities', 'upsert', l); }
    });
    save();
    emit('assets', 'delete', { id });
  }

  // ---------- liability CRUD ----------
  function liabilities() { return state.liabilities; }
  function getLiability(id) { return state.liabilities.find(l => l.id === id) || null; }
  function addLiability(l) {
    if (readOnly) return null;
    l.id = l.id || uid();
    l.createdAt = l.createdAt || new Date().toISOString();
    state.liabilities.push(l);
    save();
    emit('liabilities', 'upsert', l);
    return l;
  }
  function updateLiability(id, patch) {
    if (readOnly) return null;
    const i = state.liabilities.findIndex(l => l.id === id);
    if (i < 0) return null;
    state.liabilities[i] = { ...state.liabilities[i], ...patch, id };
    save();
    emit('liabilities', 'upsert', state.liabilities[i]);
    return state.liabilities[i];
  }
  function removeLiability(id) {
    if (readOnly) return;
    state.liabilities = state.liabilities.filter(l => l.id !== id);
    save();
    emit('liabilities', 'delete', { id });
  }
  function liabilityLinkedTo(assetId) {
    return state.liabilities.find(l => l.linkedAssetId === assetId) || null;
  }
  function resetDemo() {
    if (readOnly) return;
    state = seed();
    state.snapshots = backfillSnapshots();
    save();
  }

  // ---------- net-worth snapshots ----------
  function snapshots() {
    return state.snapshots.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  }
  // Record today's snapshot from live valuations (deduped by date).
  // Called when the dashboard opens; demo mode is read-only so the
  // seeded history stays authoritative there.
  function recordSnapshot() {
    if (readOnly) return null;
    const today = Fin.todayISO();
    const p = portfolio();
    if (!isFinite(p.netWorth)) return null;
    const snap = {
      date: today,
      totalAssets: Math.round(p.totalAssets),
      totalLiabilities: Math.round(p.totalLiabilities),
      netWorth: Math.round(p.netWorth),
      byType: Object.fromEntries(Object.entries(p.byType).map(([k, v]) => [k, Math.round(v)])),
    };
    const i = state.snapshots.findIndex(s => s.date === today);
    if (i >= 0) {
      const prev = state.snapshots[i];
      if (prev.netWorth === snap.netWorth && !prev.synthetic) return prev; // nothing changed
      state.snapshots[i] = snap;
    } else {
      state.snapshots.push(snap);
    }
    save();
    emit('snapshots', 'upsert', snap);
    return snap;
  }
  // snapshots within the last `days` (null → all), oldest first
  function snapshotRange(days) {
    const all2 = snapshots();
    if (!days) return all2;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const iso = cutoff.toISOString().slice(0, 10);
    return all2.filter(s => s.date >= iso);
  }
  // recent trend from snapshot history: monthly growth (absolute ₹/month
  // and %/month) over up to the trailing 6 months
  function recentGrowth() {
    const range = snapshotRange(183);
    if (range.length < 2) return null;
    const first = range[0], last = range[range.length - 1];
    const months = Math.max(0.5, Fin.yearsBetween(first.date, last.date) * 12);
    return {
      perMonthAbs: (last.netWorth - first.netWorth) / months,
      perMonthPct: first.netWorth > 0 ? Math.pow(last.netWorth / first.netWorth, 1 / months) - 1 : null,
      from: first, to: last, months,
    };
  }
  // Reconstructed weekly history for sample/demo portfolios so the
  // chart looks alive from day one (deterministic, ends at today's
  // real net worth). Real user accounts accumulate honest snapshots.
  function backfillSnapshots(weeks = 52) {
    const p = portfolio();
    if (!isFinite(p.netWorth) || p.netWorth <= 0) return [];
    const out = [];
    const startFactor = 0.82;
    for (let i = 0; i <= weeks; i++) {
      const f = i / weeks;
      const d = new Date();
      d.setDate(d.getDate() - (weeks - i) * 7);
      const wobble = 0.02 * Math.sin(i / 2.9) + 0.012 * Math.sin(i / 1.3 + 2);
      const nw = Math.round(p.netWorth * (startFactor + (1 - startFactor) * f + wobble * (1 - f * 0.5)));
      const liab = Math.round(p.totalLiabilities * (1.12 - 0.12 * f));
      out.push({
        date: d.toISOString().slice(0, 10),
        totalAssets: nw + liab,
        totalLiabilities: liab,
        netWorth: nw,
        synthetic: true,
      });
    }
    // last point = today's real numbers
    const today = out[out.length - 1];
    today.totalAssets = Math.round(p.totalAssets);
    today.totalLiabilities = Math.round(p.totalLiabilities);
    today.netWorth = Math.round(p.netWorth);
    return out;
  }
  function looksLikeSeed(assets) {
    const labels = new Set((assets || []).map(a => a.label));
    return labels.has('Flexi cap SIP') && labels.has('2BHK, Whitefield') && labels.has('Wedding jewellery');
  }

  // ---------- goals ----------
  function goals() { return state.goals; }
  function getGoal(id) { return state.goals.find(g => g.id === id) || null; }
  function addGoal(g) {
    if (readOnly) return null;
    g.id = g.id || uid();
    g.createdAt = g.createdAt || new Date().toISOString();
    g.achieved = !!g.achieved;
    state.goals.push(g);
    save();
    emit('goals', 'upsert', g);
    return g;
  }
  function updateGoal(id, patch) {
    if (readOnly) return null;
    const i = state.goals.findIndex(g => g.id === id);
    if (i < 0) return null;
    state.goals[i] = { ...state.goals[i], ...patch, id };
    save();
    emit('goals', 'upsert', state.goals[i]);
    return state.goals[i];
  }
  function removeGoal(id) {
    if (readOnly) return;
    state.goals = state.goals.filter(g => g.id !== id);
    save();
    emit('goals', 'delete', { id });
  }
  // Marks any goal whose target the current net worth has crossed as
  // achieved (once), and returns the newly-achieved goals so the UI can
  // celebrate exactly one time per goal.
  function checkGoalAchievements() {
    if (readOnly) return [];
    const nw = portfolio().netWorth;
    const newly = [];
    for (const g of state.goals) {
      if (!g.achieved && nw >= g.targetAmount) {
        g.achieved = true;
        g.achievedAt = new Date().toISOString();
        newly.push(g);
        emit('goals', 'upsert', g);
      }
    }
    if (newly.length) save();
    return newly;
  }
  // progress + pace for one goal against current net worth & trend
  function goalProgress(g) {
    const p = portfolio();
    const nw = p.netWorth;
    const pct = g.targetAmount > 0 ? Math.max(0, Math.min(1, nw / g.targetAmount)) : 0;
    let projectedDate = null, monthsAway = null;
    const growth = recentGrowth();
    if (!g.achieved && growth && growth.perMonthAbs > 0 && nw < g.targetAmount) {
      monthsAway = (g.targetAmount - nw) / growth.perMonthAbs;
      if (monthsAway < 600) {
        projectedDate = new Date();
        projectedDate.setDate(projectedDate.getDate() + Math.round(monthsAway * 30.44));
      } else {
        monthsAway = null;
      }
    }
    let status = 'ontrack';
    if (g.achieved) status = 'achieved';
    else if (g.targetDate) {
      if (projectedDate) status = projectedDate <= new Date(g.targetDate) ? 'ontrack' : 'behind';
      else status = new Date(g.targetDate) > new Date() ? 'ontrack' : 'behind';
    } else if (!projectedDate) {
      status = 'behind';
    }
    return { netWorth: nw, pct, projectedDate, monthsAway, status };
  }

  // ---------- liability valuation ----------
  // Returns { balance, payoffMonths, payoffDate, interestRemaining, split, revolving }
  function liabilityValuation(l) {
    const asOf = l.asOfDate || l.startDate;
    const monthsElapsed = Fin.monthsBetween(asOf, new Date());
    const r = (l.rate || 0) / 100;
    const revolving = l.type === 'creditcard' || !l.emi;
    const balance = revolving ? l.principal : Fin.loanBalanceAfter(l.principal, r, l.emi, monthsElapsed);
    let payoffMonths = null, payoffDate = null, interestRemaining = null, split = null;
    if (!revolving && balance > 0) {
      payoffMonths = Fin.loanPayoffMonths(balance, r, l.emi);
      if (payoffMonths != null) {
        payoffDate = new Date();
        payoffDate.setMonth(payoffDate.getMonth() + payoffMonths);
        interestRemaining = Fin.loanInterestRemaining(balance, r, l.emi);
      }
      split = Fin.emiSplit(balance, r, l.emi);
    }
    return { balance, payoffMonths, payoffDate, interestRemaining, split, revolving, monthsElapsed };
  }

  // liability payoff curve over `years`: total outstanding at each t
  function liabilityCurve(years, steps = 40) {
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const t = (years * i) / steps;
      let total = 0;
      for (const l of state.liabilities) {
        const v = liabilityValuation(l);
        if (v.revolving) { total += v.balance; continue; }
        total += Fin.loanBalanceAfter(v.balance, (l.rate || 0) / 100, l.emi, Math.round(t * 12));
      }
      out.push({ t, total });
    }
    return out;
  }

  // -----------------------------------------------------------
  // Valuation dispatcher — the heart of the app.
  // currentValue applies ownership share (and, for unlinked RE,
  // nets the inline loan). Linked-loan RE counts gross here and
  // the debt is counted once, under liabilities.
  // -----------------------------------------------------------
  function valuation(a) {
    const d = a.data || {};
    const share = (a.ownership === 'joint' && a.sharePct) ? a.sharePct / 100 : 1;
    let v = null;         // gross current value (₹, full holding)
    let invested = null;  // cost basis (₹, full holding)
    let dayChangePct = null;
    let sub = '';
    let notes = [];
    let fx = null;
    let mu = 0.1, sigma = 0.15;
    let mode = TYPES[a.type].mode;
    let extra = {};       // type-specific computed facts for the UI

    const years = Fin.yearsBetween(a.acquiredOn, new Date());

    switch (a.type) {
      case 'equity': {
        const s = Market.getStock(d.symbol);
        const price = s ? s.price : (d.lastPrice || 0);
        const isUSD = s && s.currency === 'USD';
        const fxRate = isUSD ? Market.FX.USDINR : 1;
        if (isUSD) fx = { currency: 'USD', rate: fxRate };
        v = (d.quantity || 0) * price * fxRate;
        invested = d.totalInvested != null ? d.totalInvested : (d.quantity || 0) * (d.avgPrice || 0) * fxRate;
        if (d.charges) invested += d.charges;
        dayChangePct = s ? Market.dayChangePct(d.symbol, s.sigma) / 100 : null;
        sub = s ? `${s.exchange} · ₹${Fin.fmtQty(price * fxRate, 2)}` : d.symbol;
        if (s) { mu = s.mu; sigma = s.sigma; }
        break;
      }
      case 'mf': {
        const s = Market.getScheme(d.schemeCode);
        const nav = Market.schemeNav(d.schemeCode, d.plan) || d.lastNav || 0;
        v = (d.units || 0) * nav;
        invested = d.totalInvested != null ? d.totalInvested : (d.units || 0) * (d.avgNav || 0);
        sub = s ? `${d.plan || 'Direct'} · ${d.option || 'Growth'} · NAV ₹${Fin.fmtQty(nav, 2)}` : '';
        if (s) {
          mu = s.mu; sigma = s.sigma;
          if (s.category === 'debt' || s.category === 'liquid') notes.push('Debt/liquid scheme — narrow projection band.');
          if (s.elss) notes.push('ELSS: 3-year lock-in per instalment.');
        }
        dayChangePct = s ? Market.dayChangePct(d.schemeCode, s.sigma) / 200 : null;
        break;
      }
      case 'esop': {
        const s = d.ticker ? Market.getStock(d.ticker) : null;
        const isUSD = (d.currency || (s && s.currency)) === 'USD';
        const fxRate = isUSD ? Market.FX.USDINR : 1;
        if (isUSD) fx = { currency: 'USD', rate: fxRate };
        const price = s ? s.price : (d.sharePrice || 0);
        const sch = { startDate: d.vestStart, totalUnits: d.totalUnits || 0, cliffMonths: d.cliffMonths || 0, freq: d.freq || 'monthly', durationMonths: d.durationMonths || 48 };
        const vested = Fin.vestedUnits(sch);
        const isOption = d.grantType === 'ISO' || d.grantType === 'NSO';
        const perUnit = isOption ? Math.max(0, price - (d.strike || 0)) : price;
        v = vested * perUnit * fxRate;
        invested = 0; // grants have no cash cost basis until exercise
        const vestedPct = sch.totalUnits > 0 ? vested / sch.totalUnits : 0;
        extra = {
          vested, vestedPct,
          unvested: sch.totalUnits - vested,
          unvestedValue: (sch.totalUnits - vested) * perUnit * fxRate,
          totalGrantValue: sch.totalUnits * perUnit * fxRate,
          perUnit: perUnit * fxRate,
          schedule: sch,
          price: price * fxRate,
        };
        sub = `${d.grantType || 'RSU'} · ${(vestedPct * 100).toFixed(0)}% vested · ${d.company || d.ticker || ''}`;
        if (d.isPrivate) {
          mode = 'manual';
          mu = (d.assumedGrowth != null ? d.assumedGrowth : 15) / 100; sigma = 0;
          notes.push('Private company — valued at your 409A/last-round price. Illiquid, assumption-based.');
        } else if (s) {
          mu = s.mu; sigma = s.sigma;
          dayChangePct = Market.dayChangePct(d.ticker, s.sigma) / 100;
        } else {
          mu = 0.12; sigma = 0.30;
        }
        if (d.grantType === 'RSU') notes.push('RSUs: value shown pre-tax; double-trigger RSUs settle only at a liquidity event.');
        if (isOption && price <= (d.strike || 0)) notes.push('Options are currently underwater (price ≤ strike) — intrinsic value is zero.');
        notes.push(`Unvested ${Fin.fmtQty(sch.totalUnits - vested, 0)} units (${Fin.fmtINR(extra.unvestedValue, { compact: true })}) are excluded from net worth until they vest.`);
        break;
      }
      case 'fd': {
        const fd = {
          principal: d.principal, rate: d.rate, startDate: d.startDate || a.acquiredOn,
          tenureYears: d.tenureYears, compounding: d.compounding || 'quarterly',
          interestType: d.interestType || 'cumulative', autoRenew: d.autoRenew || 'none',
          payoutFreq: d.payoutFreq,
        };
        v = Fin.fdCurrentValue(fd);
        invested = d.principal;
        const mat = Fin.fdMaturityDate(fd.startDate, fd.tenureYears);
        const left = Fin.yearsBetween(new Date(), mat);
        sub = new Date() < mat
          ? `${d.rate}% p.a. · matures ${Fin.fmtDate(mat)} (${left < 1 ? Math.round(left * 12) + ' mo' : left.toFixed(1) + ' yr'} left)`
          : `${d.rate}% p.a. · matured ${Fin.fmtDate(mat)}`;
        if (fd.interestType === 'payout') notes.push(`Non-cumulative: ~${Fin.fmtINR(Fin.fdPayoutPerPeriod(fd))} interest paid per period; FD value stays ≈ principal.`);
        if (d.taxSaver) notes.push('Tax-saver FD: 5-year 80C lock-in — cannot be broken early.');
        if (d.tds) notes.push('Values shown are pre-TDS.');
        break;
      }
      case 'smallsavings': {
        const r = (d.rate || 0) / 100;
        const elapsed = Fin.yearsBetween(d.startDate || a.acquiredOn, new Date());
        const tenure = d.tenureYears || 5;
        const tCap = Math.min(elapsed, tenure);
        const st = d.subType || 'nsc';
        if (st === 'rd') {
          v = Fin.annuityFV(d.monthlyAmount || 0, r, tCap, 12);
          invested = (d.monthlyAmount || 0) * Math.round(Math.min(elapsed, tenure) * 12);
          extra.maturityValue = Fin.annuityFV(d.monthlyAmount || 0, r, tenure, 12);
          sub = `RD · ${Fin.fmtINR(d.monthlyAmount)}/mo · ${d.rate}%`;
        } else if (st === 'ssy') {
          v = Fin.ppfFV(d.balance || 0, r, Fin.yearsBetween(d.asOfDate || d.startDate || a.acquiredOn, new Date()), d.annualContribution || 0);
          invested = (d.balance || 0) + (d.annualContribution || 0) * Math.floor(Fin.yearsBetween(d.asOfDate || d.startDate || a.acquiredOn, new Date()));
          extra.maturityValue = Fin.ppfFV(v, r, Math.max(0, tenure - elapsed), d.annualContribution || 0);
          sub = `Sukanya Samriddhi · ${d.rate}% · ${Fin.fmtINR(d.annualContribution)}/yr`;
        } else if (st === 'pomis') {
          v = d.principal; // payout scheme — corpus stays at principal
          invested = d.principal;
          extra.monthlyIncome = (d.principal || 0) * r / 12;
          extra.maturityValue = d.principal;
          sub = `PO MIS · ${d.rate}% · pays ${Fin.fmtINR(extra.monthlyIncome)}/mo`;
          notes.push(`Monthly income scheme: interest is paid out (≈${Fin.fmtINR(extra.monthlyIncome)}/mo); principal returns at maturity.`);
        } else { // nsc / kvp / potd — lump-sum compounding
          v = (d.principal || 0) * Math.pow(1 + r, tCap);
          invested = d.principal;
          extra.maturityValue = (d.principal || 0) * Math.pow(1 + r, tenure);
          const names = { nsc: 'NSC', kvp: 'KVP', potd: 'PO TD' };
          sub = `${names[st] || st.toUpperCase()} · ${d.rate}% · ${tenure}y`;
        }
        const mat = Fin.addYears(d.startDate || a.acquiredOn, tenure);
        extra.maturityDate = mat;
        if (new Date() < mat) sub += ` · matures ${Fin.fmtDate(mat)}`;
        break;
      }
      case 'epf': {
        const r = (d.rate != null ? d.rate : 8.25) / 100;
        const monthly = (d.empContribution || 0) + (d.erContribution || 0) + (d.vpf || 0);
        const since = Fin.yearsBetween(d.asOfDate || a.acquiredOn, new Date());
        v = Fin.contributoryFV(d.balance || 0, r, since, monthly);
        invested = (d.balance || 0) + monthly * Math.round(since * 12);
        const yearsToRet = Math.max(0, (d.retirementAge || 60) - (d.currentAge || 30));
        extra.monthly = monthly;
        extra.retirementCorpus = Fin.contributoryFV(v, r, yearsToRet, monthly);
        extra.yearsToRetirement = yearsToRet;
        sub = `${d.rate != null ? d.rate : 8.25}% p.a. · ${Fin.fmtINR(monthly)}/mo · balance as of ${Fin.fmtDate(d.asOfDate)}`;
        notes.push(`Statement balance as of ${Fin.fmtDate(d.asOfDate)} — update it when your annual EPF statement arrives.`);
        notes.push(`Projected corpus at ${d.retirementAge || 60}: ≈ ${Fin.fmtINR(extra.retirementCorpus, { compact: true })} (illustrative, at the current statutory rate).`);
        break;
      }
      case 'ppf': {
        const r = (d.rate != null ? d.rate : 7.1) / 100;
        const since = Fin.yearsBetween(d.asOfDate || a.acquiredOn, new Date());
        v = Fin.ppfFV(d.balance || 0, r, since, d.annualContribution || 0);
        invested = (d.balance || 0) + (d.annualContribution || 0) * Math.floor(since);
        const tenure = 15 + (d.extensionYears || 0);
        const mat = Fin.addYears(d.openDate || a.acquiredOn, tenure);
        const yearsLeft = Fin.yearsBetween(new Date(), mat);
        extra.maturityDate = mat;
        extra.maturityValue = Fin.ppfFV(v, r, Math.max(0, yearsLeft), (d.annualContribution || 0));
        extra.yearsLeft = yearsLeft;
        sub = `${d.rate != null ? d.rate : 7.1}% · ${Fin.fmtINR(d.annualContribution)}/yr · matures ${Fin.fmtDate(mat)}`;
        notes.push(`15-year account${d.extensionYears ? ` extended by ${d.extensionYears}y` : ''} — matures ${Fin.fmtDate(mat)} (${yearsLeft < 1 ? Math.round(yearsLeft * 12) + ' months' : yearsLeft.toFixed(1) + ' years'} left).`);
        if ((d.annualContribution || 0) < 150000) notes.push(`₹${((150000 - (d.annualContribution || 0)) / 1000).toFixed(0)}K of the ₹1.5L annual cap unused.`);
        break;
      }
      case 'nps': {
        const blend = Fin.npsBlend(d.allocE, d.allocC, d.allocG);
        mu = blend.mu; sigma = blend.sigma;
        const since = Fin.yearsBetween(d.asOfDate || a.acquiredOn, new Date());
        v = (d.corpus || 0) + (d.monthlyContribution || 0) * Math.round(since * 12);
        invested = d.totalInvested != null ? d.totalInvested : null;
        extra.blend = blend;
        sub = `Tier ${d.tier || 'I'} · E${d.allocE || 0}/C${d.allocC || 0}/G${d.allocG || 0} · ${Fin.fmtINR(d.monthlyContribution)}/mo`;
        notes.push(`Returns are market-linked: E/C/G split blends to μ ${(blend.mu * 100).toFixed(1)}% · σ ${(blend.sigma * 100).toFixed(1)}%.`);
        notes.push(`Corpus as of ${Fin.fmtDate(d.asOfDate)} — contributions since are added at face value.`);
        dayChangePct = Market.dayChangePct('nps:' + a.id, sigma) / 250;
        break;
      }
      case 'gold': {
        const metal = d.metal || 'gold';
        const m = Market.metalRate(metal);
        if (d.form === 'etf' || d.form === 'sgb') {
          const u = Market.getGoldUnit(d.instrumentId);
          const price = u ? u.price : (d.lastUnitPrice || 0);
          v = (d.units || 0) * price;
          invested = d.totalPaid != null ? d.totalPaid : (d.units || 0) * (d.buyPrice || 0);
          sub = `${d.form.toUpperCase()} · ${Fin.fmtQty(d.units, 3)} units`;
          if (d.form === 'sgb') {
            const int = d.sgbRate != null ? d.sgbRate : 2.5;
            notes.push(`SGB pays ${int}% p.a. fixed interest on issue price, over metal appreciation.`);
          }
        } else {
          const purity = Market.purityFactor(d.purity || '24K');
          v = (d.grams || 0) * (m ? m.perGram : 0) * purity;
          invested = d.totalPaid != null ? d.totalPaid : (d.grams || 0) * (d.buyRate || 0);
          sub = `${d.form === 'digital' ? 'Digital' : 'Physical'} · ${Fin.fmtQty(d.grams, 2)} g · ${d.purity || '24K'}`;
          if (d.form === 'physical' && d.makingCharges) {
            notes.push(`Making charges ${Fin.fmtINR(d.makingCharges)} are non-recoverable — excluded from current value, included in cost.`);
          }
        }
        if (m) { mu = m.mu; sigma = m.sigma; }
        dayChangePct = Market.dayChangePct('metal:' + metal, sigma) / 300;
        break;
      }
      case 'realestate': {
        if (d.currentValue != null) v = d.currentValue;
        else if (d.sqft && d.ratePerSqft) v = d.sqft * d.ratePerSqft;
        else v = d.purchasePrice;
        invested = (d.purchasePrice || 0) + (d.acquisitionCosts || 0);
        sub = `${d.propertyType || 'Residential'}${d.city ? ' · ' + d.city : ''}`;
        const linked = liabilityLinkedTo(a.id);
        let loan = 0;
        if (linked) {
          const lv = liabilityValuation(linked);
          extra.linkedLoan = linked;
          extra.linkedLoanBalance = lv.balance;
          notes.push(`Linked to “${linked.label || LIABILITY_TYPES[linked.type].label}” (${Fin.fmtINR(lv.balance, { compact: true })} outstanding) — the loan is counted once, under Liabilities. Net equity: ${Fin.fmtINR(Math.max(0, v - lv.balance), { compact: true })}.`);
        } else {
          loan = d.loanBalance || 0;
          if (loan > 0) notes.push(`Outstanding loan ${Fin.fmtINR(loan)} netted here — link it as a Liability to track amortization and payoff.`);
        }
        if (d.lastRevaluedOn) notes.push(`Value is your estimate, last revalued ${Fin.fmtDate(d.lastRevaluedOn)}.`);
        if (d.rentPerMonth) notes.push(`Rental yield ≈ ${((d.rentPerMonth * 12) / v * 100).toFixed(1)}% p.a. on current value.`);
        const grossValue = v;
        const netValue = Math.max(0, v - loan);
        extra.netEquity = Math.max(0, v - (linked ? extra.linkedLoanBalance : loan));
        return finish(a, { v: netValue, grossValue, invested, dayChangePct, sub, notes, fx, mu, sigma, mode, share, years, extra });
      }
      case 'crypto': {
        const c = Market.getCoin(d.coinId);
        const priceUSD = c ? c.priceUSD : (d.lastPrice || 0);
        const fxRate = Market.FX.USDINR;
        fx = { currency: 'USD', rate: fxRate };
        v = (d.quantity || 0) * priceUSD * fxRate;
        if (d.totalInvested != null) {
          invested = d.investCurrency === 'USD' ? d.totalInvested * fxRate : d.totalInvested;
        } else {
          const buyFx = d.investCurrency === 'USD' ? fxRate : 1;
          invested = (d.quantity || 0) * (d.avgPrice || 0) * buyFx;
        }
        sub = c ? `$${Fin.fmtQty(priceUSD, 2)} · ${Fin.fmtQty(d.quantity, 8)} ${d.coinId}` : d.coinId;
        if (c) { mu = c.mu; sigma = c.sigma; }
        if (c && c.stable) { notes.push('Stablecoin — value ≈ pegged; projected roughly flat.'); }
        else notes.push('Crypto is extremely volatile — projection band is very wide and illustrative only.');
        dayChangePct = c ? Market.dayChangePct(d.coinId, c.sigma) / 60 : null;
        break;
      }
      case 'other': {
        invested = d.costBasis || 0;
        const rate = (d.growthRate != null ? d.growthRate : 0) / 100;
        if (d.subPattern === 'fixedincome') {
          mode = 'computed';
          const fd = {
            principal: d.costBasis, rate: d.growthRate || 7, startDate: a.acquiredOn,
            tenureYears: d.tenureYears || 15, compounding: 'annual', interestType: 'cumulative', autoRenew: 'principal_interest',
          };
          v = Fin.fdCurrentValue(fd);
          sub = `${d.subType || 'Fixed income'} · ${d.growthRate || 7}% p.a.`;
        } else if (d.valuationMethod === 'manual' && d.currentValue != null) {
          v = d.currentValue;
          sub = d.subType || (d.subPattern === 'depreciating' ? 'Depreciating' : 'Appreciating');
          if (d.lastRevaluedOn) notes.push(`Manual estimate, last updated ${Fin.fmtDate(d.lastRevaluedOn)}.`);
        } else {
          v = (d.costBasis || 0) * Math.pow(1 + rate, years);
          sub = `${d.subType || ''} · ${d.growthRate > 0 ? '+' : ''}${d.growthRate || 0}% p.a. assumed`;
        }
        if (d.subPattern === 'depreciating') notes.push('Depreciating asset — assumed negative growth rate.');
        break;
      }
    }

    return finish(a, { v, grossValue: v, invested, dayChangePct, sub, notes, fx, mu, sigma, mode, share, years, extra });
  }

  // C3: per-asset valuation-mode override (set from the detail-page
  // toggle, persisted on the asset). 'live' is only ever the natural
  // mode; 'manual' freezes the value at the user's estimate; 'computed'
  // compounds the cost basis at an assumed rate.
  function applyModeOverride(a, x, d) {
    const o = a.valuationMode;
    if (!o || o === x.mode) return;
    if (o === 'manual' && d.manualValue != null) {
      x.v = d.manualValue;
      x.grossValue = d.manualValue;
      x.mode = 'manual';
      x.sigma = 0;
      x.dayChangePct = null;
      x.notes = [`Valuation switched to Manual — using your estimate of ${Fin.fmtINR(d.manualValue)}${d.manualValueDate ? ` (as of ${Fin.fmtDate(d.manualValueDate)})` : ''}. Switch back to ${TYPES[a.type].mode} any time.`, ...x.notes];
    } else if (o === 'computed') {
      const rate = d.assumedRate != null ? d.assumedRate : 8;
      const base = (x.invested != null && x.invested > 0) ? x.invested : x.v;
      const v2 = base * Math.pow(1 + rate / 100, x.years);
      x.v = v2;
      x.grossValue = v2;
      x.mode = 'computed';
      x.sigma = 0;
      x.dayChangePct = null;
      x.notes = [`Valuation switched to Computed — cost basis compounding at an assumed ${rate}% p.a.`, ...x.notes];
    }
  }

  function finish(a, x) {
    const d = a.data || {};
    applyModeOverride(a, x, d);
    const netShare = x.v * x.share;
    const investedShare = (x.invested || 0) * x.share;
    const absGain = x.invested != null ? x.grossValue - x.invested : null;
    const absPct = x.invested > 0 ? absGain / x.invested : null;

    // annualized: XIRR when lots exist, else CAGR
    let annualized = null, annualizedMethod = 'CAGR';
    const lots = d.lots && d.lots.length > 1 ? d.lots : null;
    if (lots) {
      const flows = lots.map(l => ({ date: l.date, amount: -(l.qty * l.price) }));
      flows.push({ date: new Date(), amount: x.grossValue });
      annualized = Fin.xirr(flows);
      annualizedMethod = 'XIRR';
    } else if (x.invested > 0) {
      annualized = Fin.cagr(x.invested, x.grossValue, x.years);
      if (x.years < 1) annualizedMethod = 'Abs (held <1y)';
    } else {
      annualizedMethod = '—';
    }
    // contractual schemes report their contract rate as the honest annualized figure
    if (a.type === 'epf') { annualized = (d.rate != null ? d.rate : 8.25) / 100; annualizedMethod = 'Rate'; }
    if (a.type === 'ppf') { annualized = (d.rate != null ? d.rate : 7.1) / 100; annualizedMethod = 'Rate'; }

    return {
      currentValue: netShare,
      grossValue: x.grossValue,
      fullValue: x.v,
      invested: x.invested,
      investedShare,
      absGain, absPct,
      annualized, annualizedMethod,
      dayChangePct: x.dayChangePct,
      mode: x.mode, sub: x.sub, notes: x.notes, fx: x.fx,
      mu: x.mu, sigma: x.sigma,
      years: x.years,
      share: x.share,
      extra: x.extra || {},
    };
  }

  // Projection band for one asset over `years` (t=0 → now), applying ownership share.
  function projectionBand(a, years, steps = 40) {
    const val = valuation(a);
    const v0 = val.currentValue;
    const d = a.data || {};
    if (v0 == null || !isFinite(v0)) return null;

    // contributory contractual schemes — deterministic with contributions
    if (a.type === 'epf') {
      const r = (d.rate != null ? d.rate : 8.25) / 100;
      const monthly = val.extra.monthly || 0;
      return gridBand(years, steps, t => Fin.contributoryFV(v0, r, t, monthly));
    }
    if (a.type === 'ppf') {
      const r = (d.rate != null ? d.rate : 7.1) / 100;
      const yearsLeft = val.extra.yearsLeft != null ? val.extra.yearsLeft : years;
      return gridBand(years, steps, t => {
        const contribYears = Math.min(t, Math.max(0, yearsLeft));
        let v = Fin.ppfFV(v0, r, contribYears, d.annualContribution || 0);
        if (t > contribYears) v *= Math.pow(1 + r, t - contribYears); // post-maturity: compounds, no fresh contributions
        return v;
      });
    }
    if (a.type === 'smallsavings') {
      const r = (d.rate || 0) / 100;
      const elapsed = Fin.yearsBetween(d.startDate || a.acquiredOn, new Date());
      const left = Math.max(0, (d.tenureYears || 5) - elapsed);
      const st = d.subType || 'nsc';
      return gridBand(years, steps, t => {
        const tc = Math.min(t, left);
        let v;
        if (st === 'rd') v = Fin.annuityFV(d.monthlyAmount || 0, r, Math.min(elapsed + t, d.tenureYears || 5), 12) * val.share;
        else if (st === 'ssy') v = Fin.ppfFV(v0, r, tc, d.annualContribution || 0);
        else if (st === 'pomis') v = v0;
        else v = v0 * Math.pow(1 + r, tc);
        return v; // past maturity the contract value holds
      });
    }
    if (a.type === 'nps') {
      let band = Fin.lognormalBand(v0, val.mu, val.sigma, years, steps);
      if (d.monthlyContribution) band = Fin.addSipToBand(band, d.monthlyContribution * val.share);
      return band;
    }
    if (a.type === 'esop') {
      const x = val.extra;
      const sch = x.schedule;
      if (!sch) return null;
      const priv = !!d.isPrivate;
      const growth = priv ? Fin.deterministicBand(1, val.mu, years, steps) : Fin.lognormalBand(1, val.mu, val.sigma, years, steps);
      // value path = (units vested at t) × per-unit value × growth factor
      return growth.map(pt => {
        const at = new Date(); at.setMonth(at.getMonth() + Math.round(pt.t * 12));
        const units = Fin.vestedUnits(sch, at);
        const base = units * x.perUnit * val.share;
        return { t: pt.t, p10: base * pt.p10, p50: base * pt.p50, p90: base * pt.p90 };
      });
    }

    switch (val.mode) {
      case 'live': {
        let band = Fin.lognormalBand(v0, val.mu, val.sigma, years, steps);
        if (a.type === 'mf' && d.sipOngoing && d.sipAmount) band = Fin.addSipToBand(band, d.sipAmount);
        if (a.type === 'gold' && d.form === 'sgb') {
          const int = (d.sgbRate != null ? d.sgbRate : 2.5) / 100;
          const base = (val.invested || v0) * val.share;
          band = band.map(pt => ({
            t: pt.t,
            p10: pt.p10 + base * int * pt.t,
            p50: pt.p50 + base * int * pt.t,
            p90: pt.p90 + base * int * pt.t,
          }));
        }
        return band;
      }
      case 'computed': {
        if (a.type === 'fd') {
          const fd = {
            principal: d.principal, rate: d.rate, startDate: d.startDate || a.acquiredOn,
            tenureYears: d.tenureYears, compounding: d.compounding || 'quarterly',
            interestType: d.interestType || 'cumulative', autoRenew: d.autoRenew || 'none',
          };
          const band = Fin.fdBand(fd, years, steps);
          return val.share === 1 ? band : band.map(p => ({ t: p.t, p10: p.p10 * val.share, p50: p.p50 * val.share, p90: p.p90 * val.share }));
        }
        const r = (d.assumedRate != null ? d.assumedRate
          : d.growthRate != null ? d.growthRate : 7) / 100;
        return Fin.deterministicBand(v0, r, years, steps);
      }
      default: { // manual
        const r = (a.type === 'realestate'
          ? (d.appreciationRate != null ? d.appreciationRate : 6)
          : (d.growthRate != null ? d.growthRate : 0)) / 100;
        return Fin.deterministicBand(v0, r, years, steps, r - 0.02, r + 0.02);
      }
    }
  }

  function gridBand(years, steps, fn) {
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const t = (years * i) / steps;
      const v = fn(t);
      out.push({ t, p10: v, p50: v, p90: v });
    }
    return out;
  }

  // ---------- portfolio aggregates ----------
  function portfolio() {
    const assets = all();
    let totalAssets = 0, invested = 0, dayChange = 0, liveValue = 0;
    const byTypeMap = {};
    for (const a of assets) {
      const v = valuation(a);
      totalAssets += v.currentValue || 0;
      invested += (v.investedShare || 0);
      if (v.dayChangePct != null) { dayChange += v.currentValue * v.dayChangePct; liveValue += v.currentValue; }
      byTypeMap[a.type] = (byTypeMap[a.type] || 0) + (v.currentValue || 0);
    }
    let totalLiabilities = 0, totalEmi = 0;
    for (const l of state.liabilities) {
      const lv = liabilityValuation(l);
      totalLiabilities += lv.balance || 0;
      totalEmi += l.emi || 0;
    }
    const netWorth = totalAssets - totalLiabilities;
    return {
      total: netWorth, // headline: net worth = assets − liabilities
      totalAssets, totalLiabilities, netWorth, totalEmi,
      invested,
      absGain: totalAssets - invested,
      absPct: invested > 0 ? (totalAssets - invested) / invested : null,
      dayChange, dayChangePct: liveValue > 0 ? dayChange / liveValue : null,
      byType: byTypeMap,
    };
  }

  // assets fan; pass netOfLiabilities to subtract the amortizing payoff curve
  function portfolioBand(years, steps = 40, netOfLiabilities = false) {
    const bands = all().map(a => projectionBand(a, years, steps)).filter(Boolean);
    let band = Fin.sumBands(bands);
    if (netOfLiabilities && band.length) {
      const lc = liabilityCurve(years, steps);
      band = band.map((p, i) => ({
        t: p.t,
        p10: p.p10 - lc[i].total,
        p50: p.p50 - lc[i].total,
        p90: p.p90 - lc[i].total,
      }));
    }
    return band;
  }

  // ---------- seed demo portfolio ----------
  function seed() {
    const reId = uid();
    const assets = [
      {
        id: uid(), type: 'equity', label: 'Reliance core holding', acquiredOn: '2021-06-14',
        ownership: 'single', sharePct: 100, currency: 'INR', createdAt: new Date().toISOString(),
        data: { symbol: 'RELIANCE', quantity: 40, avgPrice: 2210, lots: [
          { date: '2021-06-14', qty: 25, price: 2105 },
          { date: '2022-11-02', qty: 15, price: 2385 },
        ] },
      },
      {
        id: uid(), type: 'equity', label: 'TCS', acquiredOn: '2023-02-20',
        ownership: 'single', sharePct: 100, currency: 'INR', createdAt: new Date().toISOString(),
        data: { symbol: 'TCS', quantity: 12, avgPrice: 3390 },
      },
      {
        id: uid(), type: 'mf', label: 'Flexi cap SIP', acquiredOn: '2020-04-10',
        ownership: 'single', sharePct: 100, currency: 'INR', createdAt: new Date().toISOString(),
        data: { schemeCode: '122639', plan: 'Direct', option: 'Growth', units: 5200, avgNav: 48.6,
                sipOngoing: true, sipAmount: 15000, sipFreq: 'monthly',
                lots: [
                  { date: '2020-04-10', qty: 1800, price: 30.1 },
                  { date: '2021-04-10', qty: 1400, price: 44.9 },
                  { date: '2022-04-10', qty: 1100, price: 52.3 },
                  { date: '2023-04-10', qty: 900, price: 61.8 },
                ] },
      },
      {
        id: uid(), type: 'mf', label: 'Emergency corpus', acquiredOn: '2023-08-01',
        ownership: 'single', sharePct: 100, currency: 'INR', createdAt: new Date().toISOString(),
        data: { schemeCode: '119523', plan: 'Direct', option: 'Growth', units: 9300, avgNav: 28.4 },
      },
      {
        id: uid(), type: 'esop', label: 'Microsoft RSU grant', acquiredOn: '2023-07-01',
        ownership: 'single', sharePct: 100, currency: 'USD', createdAt: new Date().toISOString(),
        data: { company: 'Microsoft', ticker: 'MSFT', grantType: 'RSU', totalUnits: 160,
                vestStart: '2023-07-01', cliffMonths: 12, freq: 'quarterly', durationMonths: 48,
                currency: 'USD' },
      },
      {
        id: uid(), type: 'fd', label: 'HDFC 5-yr FD', acquiredOn: '2023-01-15',
        ownership: 'single', sharePct: 100, currency: 'INR', createdAt: new Date().toISOString(),
        data: { principal: 500000, rate: 7.1, startDate: '2023-01-15', tenureYears: 5,
                compounding: 'quarterly', interestType: 'cumulative', bank: 'HDFC Bank',
                institutionType: 'bank', autoRenew: 'principal_interest', tds: true, status: 'active' },
      },
      {
        id: uid(), type: 'smallsavings', label: 'NSC 2024', acquiredOn: '2024-02-10',
        ownership: 'single', sharePct: 100, currency: 'INR', createdAt: new Date().toISOString(),
        data: { subType: 'nsc', principal: 100000, rate: 7.7, tenureYears: 5, startDate: '2024-02-10' },
      },
      {
        id: uid(), type: 'epf', label: 'EPF (Infosys UAN)', acquiredOn: '2017-08-01',
        ownership: 'single', sharePct: 100, currency: 'INR', createdAt: new Date().toISOString(),
        data: { balance: 865000, asOfDate: '2026-03-31', empContribution: 9000, erContribution: 5500,
                vpf: 0, rate: 8.25, currentAge: 32, retirementAge: 60, uan: '1012 3456 7890' },
      },
      {
        id: uid(), type: 'ppf', label: 'PPF (SBI)', acquiredOn: '2016-04-01',
        ownership: 'single', sharePct: 100, currency: 'INR', createdAt: new Date().toISOString(),
        data: { balance: 1240000, asOfDate: '2026-03-31', annualContribution: 150000, rate: 7.1,
                openDate: '2016-04-01', extensionYears: 0 },
      },
      {
        id: uid(), type: 'nps', label: 'NPS Tier I', acquiredOn: '2020-01-15',
        ownership: 'single', sharePct: 100, currency: 'INR', createdAt: new Date().toISOString(),
        data: { corpus: 620000, asOfDate: '2026-06-30', monthlyContribution: 10000, tier: 'I',
                allocE: 50, allocC: 30, allocG: 20 },
      },
      {
        id: uid(), type: 'gold', label: 'Wedding jewellery', acquiredOn: '2019-11-22',
        ownership: 'single', sharePct: 100, currency: 'INR', createdAt: new Date().toISOString(),
        data: { metal: 'gold', form: 'physical', grams: 85, purity: '22K', buyRate: 3900,
                totalPaid: 361500, makingCharges: 30000 },
      },
      {
        id: uid(), type: 'gold', label: 'SGB 2019-20 S4', acquiredOn: '2019-09-17',
        ownership: 'single', sharePct: 100, currency: 'INR', createdAt: new Date().toISOString(),
        data: { metal: 'gold', form: 'sgb', instrumentId: 'SGB2027', units: 30, buyPrice: 3890,
                sgbRate: 2.5, sgbMaturity: '2027-09-17' },
      },
      {
        id: reId, type: 'realestate', label: '2BHK, Whitefield', acquiredOn: '2018-07-30',
        ownership: 'joint', sharePct: 50, currency: 'INR', createdAt: new Date().toISOString(),
        data: { propertyType: 'residential', city: 'Bengaluru', locality: 'Whitefield',
                purchasePrice: 6800000, acquisitionCosts: 450000, currentValue: 10500000,
                lastRevaluedOn: '2026-03-01', appreciationRate: 6.5,
                rentPerMonth: 32000, sqft: 1150, ratePerSqft: 9130 },
      },
      {
        id: uid(), type: 'crypto', label: 'BTC stack', acquiredOn: '2021-02-01',
        ownership: 'single', sharePct: 100, currency: 'USD', createdAt: new Date().toISOString(),
        data: { coinId: 'BTC', quantity: 0.18, avgPrice: 41200, investCurrency: 'USD',
                lots: [
                  { date: '2021-02-01', qty: 0.10, price: 33500 },
                  { date: '2022-06-20', qty: 0.05, price: 20100 },
                  { date: '2024-01-12', qty: 0.03, price: 46800 },
                ] },
      },
      {
        id: uid(), type: 'crypto', label: 'ETH', acquiredOn: '2022-09-10',
        ownership: 'single', sharePct: 100, currency: 'USD', createdAt: new Date().toISOString(),
        data: { coinId: 'ETH', quantity: 1.4, avgPrice: 1720, investCurrency: 'USD' },
      },
      {
        id: uid(), type: 'other', label: 'Honda City', acquiredOn: '2022-10-12',
        ownership: 'single', sharePct: 100, currency: 'INR', createdAt: new Date().toISOString(),
        data: { subPattern: 'depreciating', subType: 'Vehicle', costBasis: 1450000, growthRate: -12,
                valuationMethod: 'rate' },
      },
    ];
    const liabilities = [
      {
        id: uid(), type: 'homeloan', label: 'HDFC home loan', lender: 'HDFC Bank',
        principal: 2400000, asOfDate: '2026-06-30', rate: 8.6, emi: 42000,
        startDate: '2018-08-01', linkedAssetId: reId, createdAt: new Date().toISOString(),
      },
      {
        id: uid(), type: 'carloan', label: 'Car loan (Honda City)', lender: 'ICICI Bank',
        principal: 420000, asOfDate: '2026-06-30', rate: 9.4, emi: 13500,
        startDate: '2022-10-12', createdAt: new Date().toISOString(),
      },
      {
        id: uid(), type: 'creditcard', label: 'Amex card outstanding', lender: 'American Express',
        principal: 85000, asOfDate: '2026-07-15', rate: 42, emi: null,
        startDate: '2026-07-15', createdAt: new Date().toISOString(),
      },
    ];
    const achievedAt = new Date(); achievedAt.setMonth(achievedAt.getMonth() - 4);
    const goals = [
      { id: uid(), title: 'First ₹1.5 Cr net worth', targetAmount: 15000000, targetDate: null,
        achieved: true, achievedAt: achievedAt.toISOString(), createdAt: new Date().toISOString() },
      { id: uid(), title: '₹2.5 Cr by 2030', targetAmount: 25000000, targetDate: '2030-12-31',
        achieved: false, achievedAt: null, createdAt: new Date().toISOString() },
    ];
    return { assets, liabilities, snapshots: [], goals };
  }

  return {
    TYPES, TYPE_ORDER, TYPE_GROUPS, LIABILITY_TYPES,
    load, save, all, byType, get, add, update, remove, resetDemo,
    liabilities, getLiability, addLiability, updateLiability, removeLiability,
    liabilityValuation, liabilityCurve, liabilityLinkedTo,
    valuation, projectionBand, portfolio, portfolioBand,
    snapshots, recordSnapshot, snapshotRange, recentGrowth,
    goals, getGoal, addGoal, updateGoal, removeGoal, checkGoalAchievements, goalProgress,
    setRemote, setLocalMode, setOnMutate, isReadOnly,
  };
})();

if (typeof globalThis !== 'undefined') globalThis.Store = Store;
