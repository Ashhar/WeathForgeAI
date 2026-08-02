/* ============================================================
   WealthForge AI — market data service
   Gold/silver spot and USD/INR are live in cloud mode: a scheduled
   job (scripts/sync-rates.mjs) writes them to public.market_rates
   with a fetched_at timestamp, and loadLiveRates() applies them at
   boot. Everything else (equity LTP, MF NAV, crypto) is still a
   deterministic simulation so the app works fully offline; in
   local mode the metals/FX rates fall back to simulated values.
   ============================================================ */

const Market = (() => {
  // deterministic PRNG per symbol so charts/prices are stable across reloads
  function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const FX = { USDINR: 87.5 };

  // ---- Equities (NSE/BSE) ----
  const STOCKS = [
    { symbol: 'RELIANCE',   name: 'Reliance Industries',      exchange: 'NSE', price: 3012.4,  mu: 0.13, sigma: 0.22, sector: 'Energy' },
    { symbol: 'TCS',        name: 'Tata Consultancy Services', exchange: 'NSE', price: 4188.6,  mu: 0.12, sigma: 0.18, sector: 'IT' },
    { symbol: 'HDFCBANK',   name: 'HDFC Bank',                exchange: 'NSE', price: 1745.2,  mu: 0.13, sigma: 0.20, sector: 'Banking' },
    { symbol: 'INFY',       name: 'Infosys',                  exchange: 'NSE', price: 1902.3,  mu: 0.12, sigma: 0.21, sector: 'IT' },
    { symbol: 'ICICIBANK',  name: 'ICICI Bank',               exchange: 'NSE', price: 1288.0,  mu: 0.14, sigma: 0.21, sector: 'Banking' },
    { symbol: 'ITC',        name: 'ITC Ltd',                  exchange: 'NSE', price: 512.8,   mu: 0.11, sigma: 0.16, sector: 'FMCG' },
    { symbol: 'BHARTIARTL', name: 'Bharti Airtel',            exchange: 'NSE', price: 1682.1,  mu: 0.13, sigma: 0.22, sector: 'Telecom' },
    { symbol: 'LT',         name: 'Larsen & Toubro',          exchange: 'NSE', price: 3855.9,  mu: 0.13, sigma: 0.23, sector: 'Infra' },
    { symbol: 'SBIN',       name: 'State Bank of India',      exchange: 'NSE', price: 872.5,   mu: 0.13, sigma: 0.26, sector: 'Banking' },
    { symbol: 'TATAMOTORS', name: 'Tata Motors',              exchange: 'NSE', price: 1104.7,  mu: 0.14, sigma: 0.32, sector: 'Auto' },
    { symbol: 'ASIANPAINT', name: 'Asian Paints',             exchange: 'NSE', price: 2496.3,  mu: 0.10, sigma: 0.20, sector: 'Consumer' },
    { symbol: 'WIPRO',      name: 'Wipro',                    exchange: 'NSE', price: 588.4,   mu: 0.10, sigma: 0.24, sector: 'IT' },
    { symbol: 'DMART',      name: 'Avenue Supermarts (DMart)', exchange: 'NSE', price: 4620.0, mu: 0.13, sigma: 0.25, sector: 'Retail' },
    { symbol: 'AAPL',       name: 'Apple Inc (US)',           exchange: 'NASDAQ', price: 246.3, mu: 0.13, sigma: 0.24, sector: 'Tech', currency: 'USD' },
    { symbol: 'MSFT',       name: 'Microsoft Corp (US)',      exchange: 'NASDAQ', price: 512.9, mu: 0.13, sigma: 0.22, sector: 'Tech', currency: 'USD' },
  ];

  // ---- Mutual fund schemes (NAV in ₹) ----
  const MF_SCHEMES = [
    { code: '120503', name: 'Nippon India Small Cap Fund',        amc: 'Nippon India MF', category: 'equity',  sub: 'Small Cap',  nav: 182.44, mu: 0.15, sigma: 0.22 },
    { code: '122639', name: 'Parag Parikh Flexi Cap Fund',        amc: 'PPFAS MF',        category: 'equity',  sub: 'Flexi Cap',  nav: 92.18,  mu: 0.14, sigma: 0.16 },
    { code: '118989', name: 'UTI Nifty 50 Index Fund',            amc: 'UTI MF',          category: 'equity',  sub: 'Index',      nav: 178.02, mu: 0.12, sigma: 0.15 },
    { code: '119598', name: 'Mirae Asset Large Cap Fund',         amc: 'Mirae Asset MF',  category: 'equity',  sub: 'Large Cap',  nav: 118.67, mu: 0.12, sigma: 0.15 },
    { code: '135781', name: 'Quant ELSS Tax Saver Fund',          amc: 'Quant MF',        category: 'equity',  sub: 'ELSS',       nav: 412.55, mu: 0.15, sigma: 0.21, elss: true },
    { code: '118825', name: 'HDFC Balanced Advantage Fund',       amc: 'HDFC MF',         category: 'hybrid',  sub: 'Balanced Advantage', nav: 545.21, mu: 0.11, sigma: 0.10 },
    { code: '119091', name: 'ICICI Pru Equity & Debt Fund',       amc: 'ICICI Pru MF',    category: 'hybrid',  sub: 'Aggressive Hybrid', nav: 398.40, mu: 0.11, sigma: 0.11 },
    { code: '119523', name: 'HDFC Corporate Bond Fund',           amc: 'HDFC MF',         category: 'debt',    sub: 'Corporate Bond', nav: 32.19, mu: 0.072, sigma: 0.018 },
    { code: '120376', name: 'SBI Magnum Gilt Fund',               amc: 'SBI MF',          category: 'debt',    sub: 'Gilt',       nav: 66.73,  mu: 0.070, sigma: 0.028 },
    { code: '118701', name: 'Axis Liquid Fund',                   amc: 'Axis MF',         category: 'liquid',  sub: 'Liquid',     nav: 2864.10, mu: 0.065, sigma: 0.004 },
  ];

  // ---- Crypto (USD prices) ----
  const COINS = [
    { id: 'BTC',  name: 'Bitcoin',   priceUSD: 118400, mu: 0.20, sigma: 0.55 },
    { id: 'ETH',  name: 'Ethereum',  priceUSD: 4260,   mu: 0.18, sigma: 0.65 },
    { id: 'SOL',  name: 'Solana',    priceUSD: 214.5,  mu: 0.20, sigma: 0.85 },
    { id: 'BNB',  name: 'BNB',       priceUSD: 742.0,  mu: 0.15, sigma: 0.60 },
    { id: 'XRP',  name: 'XRP',       priceUSD: 3.12,   mu: 0.15, sigma: 0.80 },
    { id: 'ADA',  name: 'Cardano',   priceUSD: 0.86,   mu: 0.12, sigma: 0.85 },
    { id: 'DOGE', name: 'Dogecoin',  priceUSD: 0.24,   mu: 0.10, sigma: 0.95 },
    { id: 'USDT', name: 'Tether (stablecoin)', priceUSD: 1.0, mu: 0.0, sigma: 0.005, stable: true },
  ];

  // ---- Precious metal spot rates (₹ per gram, 24K/999 for gold) ----
  const METALS = {
    gold:   { perGram: 7850, mu: 0.09, sigma: 0.14, label: 'Gold (24K / 999)' },
    silver: { perGram: 96.5, mu: 0.08, sigma: 0.20, label: 'Silver (999)' },
  };
  const PURITY = { '24K': 1.0, '22K': 0.916, '18K': 0.75 };

  // Gold ETFs / SGB series (unit-priced)
  const GOLD_UNITS = [
    { id: 'GOLDBEES', name: 'Nippon Gold BeES ETF', price: 65.2, kind: 'etf' },
    { id: 'SGB2027',  name: 'SGB 2019-20 Series IV (2027)', price: 7850, kind: 'sgb' },
  ];

  // deterministic "day change" per instrument
  function dayChangePct(key, sigma) {
    const r = mulberry32(hashSeed('day:' + key))();
    return (r * 2 - 1) * (sigma || 0.2) * 4; // ± few %
  }

  // Simulated daily price history ending at current price.
  // Backward geometric walk with seeded RNG → stable, plausible series.
  function priceHistory(key, endPrice, days, sigma, mu) {
    const rnd = mulberry32(hashSeed('hist:' + key));
    const dt = 1 / 252;
    const s = sigma == null ? 0.2 : sigma;
    const m = mu == null ? 0.1 : mu;
    const pts = new Array(days);
    let p = endPrice;
    for (let i = days - 1; i >= 0; i--) {
      pts[i] = p;
      // step backwards
      const z = (rnd() + rnd() + rnd() + rnd() - 2) * Math.sqrt(3); // approx N(0,1)
      p = p / Math.exp((m - (s * s) / 2) * dt + s * Math.sqrt(dt) * z);
    }
    return pts;
  }

  // ---------- public API ----------
  function searchStocks(q) {
    q = (q || '').trim().toLowerCase();
    if (!q) return STOCKS.slice(0, 8);
    return STOCKS.filter(s => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).slice(0, 8);
  }
  function getStock(symbol) { return STOCKS.find(s => s.symbol === symbol) || null; }

  function searchSchemes(q) {
    q = (q || '').trim().toLowerCase();
    if (!q) return MF_SCHEMES.slice(0, 8);
    return MF_SCHEMES.filter(s => s.name.toLowerCase().includes(q) || s.code.includes(q) || s.amc.toLowerCase().includes(q)).slice(0, 8);
  }
  function getScheme(code) { return MF_SCHEMES.find(s => s.code === code) || null; }
  // Regular plans carry a higher TER → slightly lower NAV & expected return
  function schemeNav(code, plan) {
    const s = getScheme(code);
    if (!s) return null;
    return plan === 'Regular' ? s.nav * 0.94 : s.nav;
  }

  function searchCoins(q) {
    q = (q || '').trim().toLowerCase();
    if (!q) return COINS.slice(0, 8);
    return COINS.filter(c => c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)).slice(0, 8);
  }
  function getCoin(id) { return COINS.find(c => c.id === id) || null; }

  function metalRate(metal) { return METALS[metal] || null; }
  function purityFactor(p) { return PURITY[p] != null ? PURITY[p] : 1; }
  function getGoldUnit(id) { return GOLD_UNITS.find(g => g.id === id) || null; }

  // ---------- live rates (cloud mode) ----------
  // public.market_rates rows: gold/silver (₹/gram) + USDINR, written by the
  // scheduled sync job. Freshness metadata backs the "updated X ago" /
  // "showing last known rate" UI so stale data is never presented as current.
  const RATE_STALE_MS = 2 * 60 * 60 * 1000; // several missed 20-min syncs
  const RATE_META = {}; // id → { live, fetchedAt (Date), source }

  async function loadLiveRates() {
    const supa = typeof globalThis !== 'undefined' ? globalThis.Supa : null;
    if (!supa || !supa.client) return false; // local mode: simulated rates
    try {
      const { data, error } = await supa.client
        .from('market_rates').select('id,rate,unit,source,fetched_at');
      if (error) throw error;
      for (const row of data || []) {
        const rate = Number(row.rate);
        if (!(rate > 0)) continue;
        if (row.id === 'gold') METALS.gold.perGram = rate;
        else if (row.id === 'silver') METALS.silver.perGram = rate;
        else if (row.id === 'USDINR') FX.USDINR = rate;
        else continue;
        RATE_META[row.id] = { live: true, fetchedAt: new Date(row.fetched_at), source: row.source || 'live feed' };
      }
      return Object.keys(RATE_META).length > 0;
    } catch (e) {
      console.error('Market.loadLiveRates failed — keeping simulated rates', e);
      return false;
    }
  }

  // { live, stale, fetchedAt, source } — simulated rates are live:false
  function rateInfo(id) {
    const meta = RATE_META[id];
    if (!meta) return { live: false, stale: false, fetchedAt: null, source: 'simulated' };
    const stale = Date.now() - meta.fetchedAt.getTime() > RATE_STALE_MS;
    return { live: true, stale, fetchedAt: meta.fetchedAt, source: meta.source };
  }

  function rateAgeText(fetchedAt) {
    const mins = Math.max(0, Math.round((Date.now() - fetchedAt.getTime()) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 48) return `${hrs} h ago`;
    return `${Math.round(hrs / 24)} days ago`;
  }

  // Plain-text freshness note (for textContent hints); '' in simulated mode.
  function rateNoteText(id) {
    const info = rateInfo(id);
    if (!info.live) return '';
    if (info.stale) {
      const ts = info.fetchedAt.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return `⚠ showing last known rate from ${ts}`;
    }
    return `updated ${rateAgeText(info.fetchedAt)}`;
  }

  // Small freshness chip for any live rate; '' in simulated/local mode.
  function rateChip(id) {
    const info = rateInfo(id);
    if (!info.live) return '';
    if (info.stale) {
      const ts = info.fetchedAt.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return `<span class="chip stale" title="Live feed unreachable — value is not current">⚠️ showing last known rate from ${ts}</span>`;
    }
    return `<span class="chip fresh" title="Source: ${String(info.source).replace(/"/g, '&quot;')}">🕐 updated ${rateAgeText(info.fetchedAt)}</span>`;
  }

  return {
    FX, PURITY, GOLD_UNITS, METALS,
    searchStocks, getStock,
    searchSchemes, getScheme, schemeNav,
    searchCoins, getCoin,
    metalRate, purityFactor, getGoldUnit,
    dayChangePct, priceHistory,
    loadLiveRates, rateInfo, rateChip, rateNoteText,
  };
})();

if (typeof globalThis !== 'undefined') globalThis.Market = Market;
