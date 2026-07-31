/* ============================================================
   WealthForge AI — asset store
   Asset model, per-type valuation dispatcher (current value,
   growth %, annualized/XIRR, projection), localStorage persistence,
   seed demo portfolio.
   ============================================================ */

const Store = (() => {
  const KEY = 'wealthforge.v1';

  // Asset type registry — drives tabs, forms, valuation mode
  const TYPES = {
    equity:     { id: 'equity',     label: 'Equity',        icon: '📈', mode: 'live',     desc: 'Listed shares on NSE/BSE — live LTP' },
    mf:         { id: 'mf',         label: 'Mutual Funds',  icon: '🧺', mode: 'live',     desc: 'MF schemes by NAV — SIP & lump sum' },
    fd:         { id: 'fd',         label: 'Fixed Deposits', icon: '🏦', mode: 'computed', desc: 'Bank/NBFC/post-office FDs — locked terms' },
    gold:       { id: 'gold',       label: 'Gold & Silver', icon: '🥇', mode: 'live',     desc: 'Physical, digital, SGB, ETF' },
    realestate: { id: 'realestate', label: 'Real Estate',   icon: '🏠', mode: 'manual',   desc: 'Property — manually revalued' },
    crypto:     { id: 'crypto',     label: 'Crypto',        icon: '🪙', mode: 'live',     desc: 'Coins & tokens — live price, high volatility' },
    other:      { id: 'other',      label: 'Others',        icon: '🗃️', mode: 'manual',   desc: 'Vehicles, art, PPF/EPF/NPS, bonds…' },
  };
  const TYPE_ORDER = ['equity', 'mf', 'fd', 'gold', 'realestate', 'crypto', 'other'];

  let state = { assets: [] };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { state = JSON.parse(raw); return; }
    } catch (e) { /* corrupted → reseed */ }
    state = { assets: seedAssets() };
    save();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  }

  function uid() { return 'a' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36); }

  function all() { return state.assets; }
  function byType(type) { return state.assets.filter(a => a.type === type); }
  function get(id) { return state.assets.find(a => a.id === id) || null; }
  function add(asset) {
    asset.id = asset.id || uid();
    asset.createdAt = asset.createdAt || new Date().toISOString();
    state.assets.push(asset);
    save();
    return asset;
  }
  function update(id, patch) {
    const i = state.assets.findIndex(a => a.id === id);
    if (i < 0) return null;
    state.assets[i] = { ...state.assets[i], ...patch, id };
    save();
    return state.assets[i];
  }
  function remove(id) {
    state.assets = state.assets.filter(a => a.id !== id);
    save();
  }
  function resetDemo() {
    state = { assets: seedAssets() };
    save();
  }

  // -----------------------------------------------------------
  // Valuation dispatcher — the heart of the app.
  // Returns: { currentValue, grossValue, invested, absGain, absPct,
  //            annualized, annualizedMethod, mode, dayChangePct,
  //            sub, quantityLabel, fx, notes[] }
  // currentValue already applies ownership share and loan netting.
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
            invested = (d.totalPaid != null ? d.totalPaid : invested);
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
        const loan = d.loanBalance || 0;
        sub = `${d.propertyType || 'Residential'}${d.city ? ' · ' + d.city : ''}`;
        if (loan > 0) notes.push(`Outstanding loan ${Fin.fmtINR(loan)} — net equity counted in net worth.`);
        if (d.lastRevaluedOn) notes.push(`Value is your estimate, last revalued ${Fin.fmtDate(d.lastRevaluedOn)}.`);
        if (d.rentPerMonth) notes.push(`Rental yield ≈ ${((d.rentPerMonth * 12) / v * 100).toFixed(1)}% p.a. on current value.`);
        // gross vs net handled below
        const grossValue = v;
        const netValue = Math.max(0, v - loan);
        return finish(a, { v: netValue, grossValue, invested, dayChangePct, sub, notes, fx, mu, sigma, mode, share, years });
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

    return finish(a, { v, grossValue: v, invested, dayChangePct, sub, notes, fx, mu, sigma, mode, share, years });
  }

  function finish(a, x) {
    const d = a.data || {};
    const netShare = x.v * x.share;
    const investedShare = (x.invested || 0) * x.share;
    const absGain = x.grossValue - (x.invested || 0);
    const absPct = x.invested > 0 ? absGain / x.invested : null;

    // annualized: XIRR when lots exist, else CAGR
    let annualized = null, annualizedMethod = 'CAGR';
    const lots = d.lots && d.lots.length > 1 ? d.lots : null;
    if (lots) {
      const flows = lots.map(l => ({ date: l.date, amount: -(l.qty * l.price) }));
      flows.push({ date: new Date(), amount: x.grossValue });
      annualized = Fin.xirr(flows);
      annualizedMethod = 'XIRR';
    } else {
      annualized = Fin.cagr(x.invested, x.grossValue, x.years);
      if (x.years < 1) annualizedMethod = 'Abs (held <1y)';
    }

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
    };
  }

  // Projection band for one asset over `years` (t=0 → now), applying ownership share.
  function projectionBand(a, years, steps = 40) {
    const val = valuation(a);
    const v0 = val.currentValue;
    const d = a.data || {};
    if (v0 == null || !isFinite(v0)) return null;

    switch (val.mode) {
      case 'live': {
        let band = Fin.lognormalBand(v0, val.mu, val.sigma, years, steps);
        if (a.type === 'mf' && d.sipOngoing && d.sipAmount) band = Fin.addSipToBand(band, d.sipAmount);
        if (a.type === 'gold' && d.form === 'sgb') {
          const int = (d.sgbRate != null ? d.sgbRate : 2.5) / 100;
          // layer fixed interest (simple accrual on invested) on the metal path
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
        const r = (d.growthRate != null ? d.growthRate : 7) / 100;
        return Fin.deterministicBand(v0, r, years, steps);
      }
      default: { // manual
        const r = (a.type === 'realestate'
          ? (d.appreciationRate != null ? d.appreciationRate : 6)
          : (d.growthRate != null ? d.growthRate : 0)) / 100;
        // flex ±2pp for a low/base/high band on manual assets
        return Fin.deterministicBand(v0, r, years, steps, r - 0.02, r + 0.02);
      }
    }
  }

  // ---------- portfolio aggregates ----------
  function portfolio() {
    const assets = all();
    let total = 0, invested = 0, dayChange = 0, liveValue = 0;
    const byTypeMap = {};
    for (const a of assets) {
      const v = valuation(a);
      total += v.currentValue || 0;
      invested += (v.investedShare || 0);
      if (v.dayChangePct != null) { dayChange += v.currentValue * v.dayChangePct; liveValue += v.currentValue; }
      byTypeMap[a.type] = (byTypeMap[a.type] || 0) + (v.currentValue || 0);
    }
    return {
      total, invested,
      absGain: total - invested,
      absPct: invested > 0 ? (total - invested) / invested : null,
      dayChange, dayChangePct: liveValue > 0 ? dayChange / liveValue : null,
      byType: byTypeMap,
    };
  }

  function portfolioBand(years, steps = 40) {
    const bands = all().map(a => projectionBand(a, years, steps)).filter(Boolean);
    return Fin.sumBands(bands);
  }

  // ---------- seed demo portfolio ----------
  function seedAssets() {
    return [
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
        id: uid(), type: 'fd', label: 'HDFC 5-yr FD', acquiredOn: '2023-01-15',
        ownership: 'single', sharePct: 100, currency: 'INR', createdAt: new Date().toISOString(),
        data: { principal: 500000, rate: 7.1, startDate: '2023-01-15', tenureYears: 5,
                compounding: 'quarterly', interestType: 'cumulative', bank: 'HDFC Bank',
                institutionType: 'bank', autoRenew: 'principal_interest', tds: true, status: 'active' },
      },
      {
        id: uid(), type: 'fd', label: 'Post-office FD (Mom joint)', acquiredOn: '2024-03-05',
        ownership: 'joint', sharePct: 50, currency: 'INR', createdAt: new Date().toISOString(),
        data: { principal: 300000, rate: 7.5, startDate: '2024-03-05', tenureYears: 3,
                compounding: 'quarterly', interestType: 'cumulative', bank: 'India Post',
                institutionType: 'post-office', autoRenew: 'none', status: 'active' },
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
        id: uid(), type: 'realestate', label: '2BHK, Whitefield', acquiredOn: '2018-07-30',
        ownership: 'joint', sharePct: 50, currency: 'INR', createdAt: new Date().toISOString(),
        data: { propertyType: 'residential', city: 'Bengaluru', locality: 'Whitefield',
                purchasePrice: 6800000, acquisitionCosts: 450000, currentValue: 10500000,
                lastRevaluedOn: '2026-03-01', appreciationRate: 6.5,
                loanBalance: 2400000, loanEmi: 42000, loanRate: 8.6, rentPerMonth: 32000,
                sqft: 1150, ratePerSqft: 9130 },
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
        id: uid(), type: 'other', label: 'PPF (SBI)', acquiredOn: '2016-04-01',
        ownership: 'single', sharePct: 100, currency: 'INR', createdAt: new Date().toISOString(),
        data: { subPattern: 'fixedincome', subType: 'PPF', costBasis: 1200000, growthRate: 7.1, tenureYears: 15 },
      },
      {
        id: uid(), type: 'other', label: 'Honda City', acquiredOn: '2022-10-12',
        ownership: 'single', sharePct: 100, currency: 'INR', createdAt: new Date().toISOString(),
        data: { subPattern: 'depreciating', subType: 'Vehicle', costBasis: 1450000, growthRate: -12,
                valuationMethod: 'rate' },
      },
    ];
  }

  return {
    TYPES, TYPE_ORDER,
    load, save, all, byType, get, add, update, remove, resetDemo,
    valuation, projectionBand, portfolio, portfolioBand,
  };
})();
