/* ============================================================
   WealthForge AI — financial math
   FD compounding, CAGR, XIRR, lognormal Monte Carlo bands,
   deterministic projection curves, formatting helpers.
   ============================================================ */

const Fin = (() => {
  const MS_YEAR = 365.25 * 24 * 3600 * 1000;

  function yearsBetween(from, to) {
    return Math.max(0, (new Date(to) - new Date(from)) / MS_YEAR);
  }
  function addYears(date, y) {
    const d = new Date(date);
    const ms = d.getTime() + y * MS_YEAR;
    return new Date(ms);
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }

  // ---------- formatting (Indian conventions) ----------
  const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const inrFmt2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

  function fmtINR(n, opts = {}) {
    if (n == null || !isFinite(n)) return '—';
    const neg = n < 0 ? '−' : '';
    const v = Math.abs(n);
    if (opts.compact) {
      if (v >= 1e7) return `${neg}₹${(v / 1e7).toFixed(2)} Cr`;
      if (v >= 1e5) return `${neg}₹${(v / 1e5).toFixed(2)} L`;
      if (v >= 1e3) return `${neg}₹${(v / 1e3).toFixed(1)}K`;
      return `${neg}₹${v.toFixed(0)}`;
    }
    return `${neg}₹${(opts.decimals ? inrFmt2 : inrFmt).format(v)}`;
  }
  function fmtPct(p, digits = 1) {
    if (p == null || !isFinite(p)) return '—';
    const sign = p > 0 ? '+' : '';
    return `${sign}${(p * 100).toFixed(digits)}%`;
  }
  function fmtQty(n, maxDp = 4) {
    if (n == null || !isFinite(n)) return '—';
    return Number(n.toFixed(maxDp)).toLocaleString('en-IN', { maximumFractionDigits: maxDp });
  }
  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // ---------- returns ----------
  function cagr(invested, current, years) {
    if (!invested || invested <= 0 || current == null || years <= 0) return null;
    if (years < 1) {
      // annualizing a sub-year holding overstates — return simple return instead
      return (current - invested) / invested;
    }
    return Math.pow(current / invested, 1 / years) - 1;
  }

  // XIRR over dated cash flows: [{date, amount}] — investments negative, value positive.
  function xirr(flows) {
    if (!flows || flows.length < 2) return null;
    const t0 = new Date(flows[0].date).getTime();
    const yrs = flows.map(f => (new Date(f.date).getTime() - t0) / MS_YEAR);
    const amts = flows.map(f => f.amount);
    const npv = r => amts.reduce((s, a, i) => s + a / Math.pow(1 + r, yrs[i]), 0);
    const dnpv = r => amts.reduce((s, a, i) => s - (yrs[i] * a) / Math.pow(1 + r, yrs[i] + 1), 0);

    let r = 0.1;
    for (let i = 0; i < 60; i++) {
      const f = npv(r), fp = dnpv(r);
      if (Math.abs(f) < 1e-7) return r;
      if (!isFinite(fp) || fp === 0) break;
      const next = r - f / fp;
      if (!isFinite(next) || next <= -0.999) break;
      if (Math.abs(next - r) < 1e-9) return next;
      r = next;
    }
    // bisection fallback
    let lo = -0.99, hi = 10;
    let flo = npv(lo), fhi = npv(hi);
    if (flo * fhi > 0) return null;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2, fm = npv(mid);
      if (Math.abs(fm) < 1e-7) return mid;
      if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  }

  // ---------- fixed deposit math ----------
  const COMPOUNDING = { monthly: 12, quarterly: 4, 'half-yearly': 2, annual: 1 };

  // Value of a cumulative FD after `years`; simple interest if freq === 'simple'.
  function fdValue(principal, ratePct, years, freq) {
    const r = ratePct / 100;
    if (years <= 0) return principal;
    if (freq === 'simple') return principal * (1 + r * years);
    const n = COMPOUNDING[freq] || 4;
    return principal * Math.pow(1 + r / n, n * years);
  }

  function fdMaturityDate(startDate, tenureYears) { return addYears(startDate, tenureYears); }
  function fdTenureYears(startDate, maturityDate) { return yearsBetween(startDate, maturityDate); }

  // Current accrued value of an FD record as of `asOf`
  function fdCurrentValue(fd, asOf = new Date()) {
    const elapsed = yearsBetween(fd.startDate, asOf);
    const tenure = fd.tenureYears;
    if (fd.interestType === 'payout') {
      // non-cumulative: interest paid out, FD value stays ≈ principal until maturity
      return elapsed >= tenure ? fd.principal : fd.principal;
    }
    const t = Math.min(elapsed, tenure);
    let v = fdValue(fd.principal, fd.rate, t, fd.compounding);
    // past maturity: follow the auto-renew assumption
    if (elapsed > tenure) {
      const extra = elapsed - tenure;
      if (fd.autoRenew === 'principal_interest') {
        v = fdValue(v, fd.rate, extra, fd.compounding);
      } else if (fd.autoRenew === 'principal') {
        // principal re-booked; matured interest sits idle alongside
        const interestAtMaturity = v - fd.principal;
        v = fdValue(fd.principal, fd.rate, extra, fd.compounding) + interestAtMaturity;
      }
      // autoRenew 'none': value stays at maturity value
    }
    return v;
  }

  function fdMaturityValue(fd) {
    if (fd.interestType === 'payout') return fd.principal;
    return fdValue(fd.principal, fd.rate, fd.tenureYears, fd.compounding);
  }

  // Interest payout per period for non-cumulative FDs
  function fdPayoutPerPeriod(fd) {
    const perYear = { monthly: 12, quarterly: 4, 'half-yearly': 2, annual: 1 }[fd.payoutFreq || 'quarterly'] || 4;
    return (fd.principal * fd.rate / 100) / perYear;
  }

  // ---------- contributory schemes (EPF / PPF / NPS / RD) ----------
  // FV of a periodic contribution stream (end-of-period), annualRate as decimal
  function annuityFV(payment, annualRate, years, periodsPerYear = 12) {
    const n = Math.round(years * periodsPerYear);
    if (n <= 0 || !payment) return 0;
    const i = annualRate / periodsPerYear;
    if (i === 0) return payment * n;
    return payment * ((Math.pow(1 + i, n) - 1) / i);
  }

  // EPF-style: existing balance compounds + monthly contributions accrue
  function contributoryFV(balance, annualRate, years, monthlyContribution) {
    if (years <= 0) return balance;
    return balance * Math.pow(1 + annualRate, years) + annuityFV(monthlyContribution, annualRate, years, 12);
  }

  // PPF-style: annual contribution at start of each year, annual compounding
  function ppfFV(balance, annualRate, years, annualContribution) {
    if (years <= 0) return balance;
    let v = balance;
    const full = Math.floor(years), frac = years - full;
    for (let y = 0; y < full; y++) v = (v + annualContribution) * (1 + annualRate);
    return v * Math.pow(1 + annualRate, frac);
  }

  // NPS blended mu/sigma from E/C/G split (percent weights summing to 100)
  const NPS_CLASSES = { E: { mu: 0.12, sigma: 0.16 }, C: { mu: 0.075, sigma: 0.05 }, G: { mu: 0.07, sigma: 0.04 } };
  function npsBlend(ePct, cPct, gPct) {
    const w = { E: (ePct || 0) / 100, C: (cPct || 0) / 100, G: (gPct || 0) / 100 };
    return {
      mu: w.E * NPS_CLASSES.E.mu + w.C * NPS_CLASSES.C.mu + w.G * NPS_CLASSES.G.mu,
      sigma: w.E * NPS_CLASSES.E.sigma + w.C * NPS_CLASSES.C.sigma + w.G * NPS_CLASSES.G.sigma,
    };
  }

  // ---------- loan amortization ----------
  function loanEmi(principal, annualRate, months) {
    const m = annualRate / 12;
    if (months <= 0) return principal;
    if (m === 0) return principal / months;
    const f = Math.pow(1 + m, months);
    return principal * m * f / (f - 1);
  }
  function loanBalanceAfter(principal, annualRate, emi, monthsElapsed) {
    if (monthsElapsed <= 0) return principal;
    const m = annualRate / 12;
    if (m === 0) return Math.max(0, principal - emi * monthsElapsed);
    const f = Math.pow(1 + m, monthsElapsed);
    return Math.max(0, principal * f - emi * (f - 1) / m);
  }
  // months to clear `principal` at `emi`; null if EMI doesn't cover interest
  function loanPayoffMonths(principal, annualRate, emi) {
    if (principal <= 0) return 0;
    const m = annualRate / 12;
    if (m === 0) return Math.ceil(principal / emi);
    if (emi <= principal * m) return null;
    return Math.ceil(Math.log(emi / (emi - principal * m)) / Math.log(1 + m));
  }
  function loanInterestRemaining(principal, annualRate, emi) {
    const n = loanPayoffMonths(principal, annualRate, emi);
    if (n == null) return null;
    const m = annualRate / 12;
    let bal = principal, interest = 0;
    for (let k = 0; k < n && bal > 0.01; k++) {
      const int = bal * m;
      interest += int;
      bal -= Math.min(emi - int, bal);
    }
    return interest;
  }
  function emiSplit(balance, annualRate, emi) {
    const interest = balance * annualRate / 12;
    return { interest, principal: Math.max(0, emi - interest) };
  }

  // ---------- ESOP / RSU vesting ----------
  // sch: {startDate, totalUnits, cliffMonths, freq: 'monthly'|'quarterly'|'annual', durationMonths}
  function monthsBetween(from, to) {
    return Math.max(0, Math.floor((new Date(to) - new Date(from)) / (30.44 * 24 * 3600 * 1000)));
  }
  function vestedUnits(sch, asOf = new Date()) {
    const elapsed = monthsBetween(sch.startDate, asOf);
    const total = sch.durationMonths || 48;
    const cliff = sch.cliffMonths || 0;
    if (elapsed < cliff) return 0;
    if (elapsed >= total) return sch.totalUnits;
    const step = sch.freq === 'annual' ? 12 : sch.freq === 'quarterly' ? 3 : 1;
    const stepsDone = Math.floor((elapsed - cliff) / step);
    const vestedMonths = Math.min(total, cliff + stepsDone * step);
    return sch.totalUnits * (vestedMonths / total);
  }
  function vestEvents(sch) {
    const total = sch.durationMonths || 48;
    const cliff = sch.cliffMonths || 0;
    const step = sch.freq === 'annual' ? 12 : sch.freq === 'quarterly' ? 3 : 1;
    const start = new Date(sch.startDate);
    const events = [];
    let prevFrac = 0;
    for (let mth = cliff; mth <= total; mth += (mth === cliff ? step : step)) {
      const m = Math.min(mth, total);
      const frac = m / total;
      const d = new Date(start);
      d.setMonth(d.getMonth() + m);
      events.push({ date: d, units: sch.totalUnits * (frac - prevFrac), cumFrac: frac, done: d <= new Date() });
      prevFrac = frac;
      if (m === total) break;
    }
    // ensure final vest lands exactly at duration end
    if (events.length && events[events.length - 1].cumFrac < 1) {
      const d = new Date(start);
      d.setMonth(d.getMonth() + total);
      events.push({ date: d, units: sch.totalUnits * (1 - prevFrac), cumFrac: 1, done: d <= new Date() });
    }
    return events;
  }

  // ---------- projections ----------
  // Lognormal (GBM) percentile band: analytic Monte Carlo envelope.
  // Returns [{t, p10, p50, p90}] with t in years from now.
  const Z90 = 1.281552;
  function lognormalBand(v0, mu, sigma, years, steps = 40) {
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const t = (years * i) / steps;
      if (t === 0) { out.push({ t, p10: v0, p50: v0, p90: v0 }); continue; }
      const drift = (mu - (sigma * sigma) / 2) * t;
      const vol = sigma * Math.sqrt(t);
      out.push({
        t,
        p10: v0 * Math.exp(drift - Z90 * vol),
        p50: v0 * Math.exp(drift),
        p90: v0 * Math.exp(drift + Z90 * vol),
      });
    }
    return out;
  }

  // Deterministic curve at a fixed annual rate (can be negative).
  // Optional low/high rates flex the band for manual assets.
  function deterministicBand(v0, rate, years, steps = 40, lowRate = null, highRate = null) {
    const out = [];
    const lo = lowRate == null ? rate : lowRate;
    const hi = highRate == null ? rate : highRate;
    for (let i = 0; i <= steps; i++) {
      const t = (years * i) / steps;
      out.push({
        t,
        p10: v0 * Math.pow(1 + lo, t),
        p50: v0 * Math.pow(1 + rate, t),
        p90: v0 * Math.pow(1 + hi, t),
      });
    }
    return out;
  }

  // Contractual FD curve from now to `years`, honouring maturity + auto-renew
  function fdBand(fd, years, steps = 40) {
    const out = [];
    const now = new Date();
    for (let i = 0; i <= steps; i++) {
      const t = (years * i) / steps;
      const v = fdCurrentValue(fd, addYears(now, t));
      out.push({ t, p10: v, p50: v, p90: v });
    }
    return out;
  }

  // Add monthly SIP contributions onto an existing band (approximate:
  // each percentile grows contributions at its own implied annual rate).
  function addSipToBand(band, monthlySip) {
    if (!monthlySip || monthlySip <= 0) return band;
    const v0 = band[0].p50 || 1;
    return band.map(pt => {
      if (pt.t <= 0) return pt;
      const res = { t: pt.t };
      for (const k of ['p10', 'p50', 'p90']) {
        const annual = Math.pow(pt[k] / v0, 1 / pt.t) - 1;
        const m = Math.pow(1 + annual, 1 / 12) - 1;
        const months = Math.round(pt.t * 12);
        const fv = m === 0 ? monthlySip * months : monthlySip * ((Math.pow(1 + m, months) - 1) / m);
        res[k] = pt[k] + fv;
      }
      return res;
    });
  }

  // Sum multiple bands over a common time grid (assumes same steps/years)
  function sumBands(bands) {
    if (!bands.length) return [];
    const n = bands[0].length;
    const out = [];
    for (let i = 0; i < n; i++) {
      let p10 = 0, p50 = 0, p90 = 0;
      for (const b of bands) {
        p10 += b[i].p10; p50 += b[i].p50; p90 += b[i].p90;
      }
      out.push({ t: bands[0][i].t, p10, p50, p90 });
    }
    return out;
  }

  return {
    yearsBetween, addYears, todayISO,
    fmtINR, fmtPct, fmtQty, fmtDate,
    cagr, xirr,
    fdValue, fdCurrentValue, fdMaturityValue, fdMaturityDate, fdTenureYears, fdPayoutPerPeriod,
    annuityFV, contributoryFV, ppfFV, npsBlend, NPS_CLASSES,
    loanEmi, loanBalanceAfter, loanPayoffMonths, loanInterestRemaining, emiSplit,
    monthsBetween, vestedUnits, vestEvents,
    lognormalBand, deterministicBand, fdBand, addSipToBand, sumBands,
  };
})();

if (typeof globalThis !== 'undefined') globalThis.Fin = Fin;
