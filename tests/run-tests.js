#!/usr/bin/env node
/* ============================================================
   WealthForge AI — unit tests for the financial math
   Run: node tests/run-tests.js
   Loads the browser modules (IIFE globals) into a VM sandbox,
   then asserts the math: FD compounding, XIRR, EPF/PPF/NPS/RD,
   loan amortization + payoff, RSU vesting + option intrinsic
   value, blended NPS mu/sigma, net worth with liabilities.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = {
  console,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  Intl, Math, Date, JSON, isFinite, parseFloat, parseInt, Number, Array, Object, String,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ['js/market.js', 'js/finance.js', 'js/store.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
// const-declared IIFE globals live in the context's lexical scope, not on the
// sandbox object — pull them out with an in-context expression
const { Fin, Store, Market } = vm.runInContext('({ Fin, Store, Market })', sandbox);

let passed = 0, failed = 0;
function ok(cond, name, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function approx(a, b, tolPct, name) {
  const tol = Math.abs(b) * (tolPct || 0.005) + 1e-9;
  ok(Math.abs(a - b) <= tol, name, `got ${a}, expected ≈ ${b} (±${tol.toFixed(4)})`);
}
function section(t) { console.log(`\n${t}`); }

// ---------- FD compounding ----------
section('FD contractual compounding');
// ₹1,00,000 @ 7.1% quarterly for 5y → 100000·(1+0.071/4)^20 = 142,159.85…
approx(Fin.fdValue(100000, 7.1, 5, 'quarterly'), 100000 * Math.pow(1 + 0.071 / 4, 20), 1e-9, 'cumulative quarterly matches closed form');
approx(Fin.fdValue(100000, 8, 3, 'simple'), 124000, 1e-9, 'simple interest');
ok(Fin.fdValue(100000, 7, 0, 'quarterly') === 100000, 'zero elapsed time returns principal');

// ---------- XIRR ----------
section('XIRR');
// single flow pair: -1000 → 1100 after exactly 1 year ⇒ 10%
const oneYr = Fin.xirr([
  { date: '2024-01-01', amount: -1000 },
  { date: '2024-12-31', amount: 1100 },
]);
approx(oneYr, 0.10, 0.02, 'lump sum 1y ≈ 10%');
// SIP-like staggered flows have a solution between abs return and first-flow CAGR
const sip = Fin.xirr([
  { date: '2022-01-01', amount: -10000 },
  { date: '2023-01-01', amount: -10000 },
  { date: '2024-01-01', amount: -10000 },
  { date: '2025-01-01', amount: 36000 },
]);
ok(sip > 0.05 && sip < 0.15, 'staggered SIP XIRR in sane range', `got ${sip}`);

// ---------- annuity / EPF / PPF ----------
section('Contributory schemes (EPF / PPF / RD)');
// annuityFV: 12 payments of 1000 at 0% = 12000
approx(Fin.annuityFV(1000, 0, 1, 12), 12000, 1e-9, 'annuityFV at 0% = sum of payments');
// closed form check: 1000/mo @ 12% (1%/mo) for 2y = 1000·((1.01^24−1)/0.01)
approx(Fin.annuityFV(1000, 0.12, 2, 12), 1000 * ((Math.pow(1.01, 24) - 1) / 0.01), 1e-9, 'annuityFV matches closed form');
// EPF: balance-only (no contributions) compounds annually
approx(Fin.contributoryFV(100000, 0.0825, 3, 0), 100000 * Math.pow(1.0825, 3), 1e-9, 'EPF balance compounds at statutory rate');
// EPF with contributions > without
ok(Fin.contributoryFV(100000, 0.0825, 3, 5000) > Fin.contributoryFV(100000, 0.0825, 3, 0) + 5000 * 36 - 1, 'EPF contributions accrue interest too');
// PPF: 1 year, start-of-year contribution: (0 + 150000)·1.071
approx(Fin.ppfFV(0, 0.071, 1, 150000), 150000 * 1.071, 1e-9, 'PPF year-1 contribution compounds');
// PPF 15y of 1.5L at 7.1% — known ballpark ≈ ₹40.68L
const ppf15 = Fin.ppfFV(0, 0.071, 15, 150000);
ok(ppf15 > 3900000 && ppf15 < 4200000, 'PPF 15y × ₹1.5L ≈ ₹40–42L', `got ${Math.round(ppf15)}`);
// RD: 5000/mo @ 6.9% for 5y ≈ ₹3.58L (annuity approximation)
const rd = Fin.annuityFV(5000, 0.069, 5, 12);
ok(rd > 350000 && rd < 365000, 'RD 5y maturity in expected range', `got ${Math.round(rd)}`);

// ---------- NPS blend ----------
section('NPS blended mu/sigma');
const blend = Fin.npsBlend(50, 30, 20);
approx(blend.mu, 0.5 * 0.12 + 0.3 * 0.075 + 0.2 * 0.07, 1e-9, 'blended mu is allocation-weighted');
approx(blend.sigma, 0.5 * 0.16 + 0.3 * 0.05 + 0.2 * 0.04, 1e-9, 'blended sigma is allocation-weighted');
const pureG = Fin.npsBlend(0, 0, 100);
ok(pureG.sigma < blend.sigma, 'pure-G allocation is narrower than E-heavy');

// ---------- loan amortization ----------
section('Loan amortization');
// standard EMI: 10L @ 8.5% for 120 months → ₹12,399ish
const emi = Fin.loanEmi(1000000, 0.085, 120);
approx(emi, 12399, 0.001, 'EMI for ₹10L @8.5% 10y ≈ ₹12,399');
// balance after full tenure ≈ 0
approx(Fin.loanBalanceAfter(1000000, 0.085, emi, 120), 0, 0, 'balance after full tenure ≈ 0');
ok(Math.abs(Fin.loanBalanceAfter(1000000, 0.085, emi, 120)) < 1, 'balance zeroes out (abs check)');
// balance after 12 months < principal but > straight-line
const bal12 = Fin.loanBalanceAfter(1000000, 0.085, emi, 12);
ok(bal12 < 1000000 && bal12 > 1000000 - emi * 12, 'early payments are interest-heavy');
// payoff months round-trips the tenure
const months = Fin.loanPayoffMonths(1000000, 0.085, emi);
ok(months >= 119 && months <= 120, 'payoff months ≈ original tenure', `got ${months}`);
// EMI below monthly interest never amortizes
ok(Fin.loanPayoffMonths(1000000, 0.12, 5000) === null, 'EMI under interest → null (never pays off)');
// interest remaining ≈ total paid − principal
const intRem = Fin.loanInterestRemaining(1000000, 0.085, emi);
approx(intRem, emi * months - 1000000, 0.02, 'interest remaining ≈ payments − principal');
// EMI split: first month interest on 10L @8.5% = ₹7,083.33
const split = Fin.emiSplit(1000000, 0.085, emi);
approx(split.interest, 1000000 * 0.085 / 12, 1e-9, 'EMI interest component');
approx(split.principal, emi - 1000000 * 0.085 / 12, 1e-9, 'EMI principal component');

// ---------- vesting ----------
section('ESOP / RSU vesting');
const now = new Date();
const iso = dt => dt.toISOString().slice(0, 10);
const monthsAgo = n => { const d = new Date(now); d.setMonth(d.getMonth() - n); return iso(d); };
const sch = { startDate: monthsAgo(24), totalUnits: 480, cliffMonths: 12, freq: 'monthly', durationMonths: 48 };
// 24 months into a 48-month monthly schedule with 12-month cliff → 50% vested
approx(Fin.vestedUnits(sch), 240, 0.05, '24/48 months vested → ~50%');
ok(Fin.vestedUnits({ ...sch, startDate: monthsAgo(6) }) === 0, 'before cliff → 0 vested');
ok(Fin.vestedUnits({ ...sch, startDate: monthsAgo(60) }) === 480, 'past duration → fully vested');
// quarterly steps vest in chunks: 13 months in = still the cliff amount (12/48)
const q = { ...sch, freq: 'quarterly', startDate: monthsAgo(13) };
approx(Fin.vestedUnits(q), 480 * (12 / 48), 0.01, 'quarterly: month 13 still at cliff fraction');
// vest events cover the full grant
const events = Fin.vestEvents(sch);
approx(events.reduce((s, e) => s + e.units, 0), 480, 1e-6, 'vest events sum to total grant');
ok(events[events.length - 1].cumFrac === 1, 'final event completes the schedule');
// option intrinsic value via Store valuation
const optAsset = {
  id: 't1', type: 'esop', label: 'Opt', acquiredOn: monthsAgo(24), ownership: 'single', sharePct: 100,
  data: { company: 'X', grantType: 'NSO', totalUnits: 480, vestStart: monthsAgo(24), cliffMonths: 12,
          freq: 'monthly', durationMonths: 48, strike: 100, sharePrice: 150, currency: 'INR', isPrivate: true },
};
const optVal = Store.valuation(optAsset);
approx(optVal.grossValue, Fin.vestedUnits(sch) * 50, 0.01, 'option value = vested × (price − strike)');
const underwater = Store.valuation({ ...optAsset, data: { ...optAsset.data, strike: 200 } });
ok(underwater.grossValue === 0, 'underwater options have zero intrinsic value');
const rsu = Store.valuation({ ...optAsset, data: { ...optAsset.data, grantType: 'RSU', strike: undefined } });
approx(rsu.grossValue, Fin.vestedUnits(sch) * 150, 0.01, 'RSU value = vested × price (no strike)');

// ---------- net worth with liabilities ----------
section('Net worth = assets − liabilities');
Store.load(); // seeds demo (localStorage is stubbed to empty)
const p = Store.portfolio();
ok(p.totalAssets > 0, 'seed portfolio has assets');
ok(p.totalLiabilities > 0, 'seed portfolio has liabilities');
approx(p.netWorth, p.totalAssets - p.totalLiabilities, 1e-9, 'net worth = assets − liabilities');
ok(p.total === p.netWorth, 'headline total is net worth');
// linked home loan: RE asset counts gross (loan lives under liabilities — no double count)
const re = Store.all().find(a => a.type === 'realestate');
const reVal = Store.valuation(re);
ok(reVal.extra.linkedLoan != null, 'seed home loan is linked to the property');
approx(reVal.fullValue, re.data.currentValue, 1e-9, 'linked RE counts gross value (loan not double-netted)');
ok(reVal.extra.netEquity < re.data.currentValue, 'net equity shown below gross');
// liability valuation basics
const home = Store.liabilities().find(l => l.type === 'homeloan');
const lv = Store.liabilityValuation(home);
ok(lv.balance > 0 && lv.balance <= home.principal, 'amortized balance ≤ statement balance');
ok(lv.payoffMonths > 0, 'payoff months computed');
ok(lv.interestRemaining > 0, 'interest remaining computed');
const card = Store.liabilities().find(l => l.type === 'creditcard');
ok(Store.liabilityValuation(card).revolving === true, 'credit card treated as revolving');
approx(Store.liabilityValuation(card).balance, card.principal, 1e-9, 'revolving balance stays at statement value');
// liability curve decreases
const curve = Store.liabilityCurve(10, 10);
ok(curve[curve.length - 1].total < curve[0].total, 'liabilities amortize down over time');
// net-of-liabilities projection < assets-only projection at t=0
const bandAssets = Store.portfolioBand(5, 10, false);
const bandNet = Store.portfolioBand(5, 10, true);
approx(bandAssets[0].p50 - bandNet[0].p50, p.totalLiabilities, 0.01, 'net-worth fan starts lower by total liabilities');

// ---------- smallsavings ----------
section('Small savings');
const nsc = Store.valuation({
  id: 't2', type: 'smallsavings', label: 'NSC', acquiredOn: '2024-02-10', ownership: 'single', sharePct: 100,
  data: { subType: 'nsc', principal: 100000, rate: 7.7, tenureYears: 5, startDate: '2024-02-10' },
});
ok(nsc.grossValue > 100000, 'NSC accrues over principal');
approx(nsc.extra.maturityValue, 100000 * Math.pow(1.077, 5), 1e-9, 'NSC maturity = lump-sum compounding');
const mis = Store.valuation({
  id: 't3', type: 'smallsavings', label: 'MIS', acquiredOn: '2024-02-10', ownership: 'single', sharePct: 100,
  data: { subType: 'pomis', principal: 450000, rate: 7.4, tenureYears: 5, startDate: '2024-02-10' },
});
approx(mis.grossValue, 450000, 1e-9, 'PO MIS corpus stays at principal (payout scheme)');
approx(mis.extra.monthlyIncome, 450000 * 0.074 / 12, 1e-9, 'PO MIS monthly income');

// ---------- summary ----------
console.log(`\n${'='.repeat(40)}\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
