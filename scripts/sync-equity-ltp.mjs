#!/usr/bin/env node
/* ============================================================
   WealthForge AI — equity & crypto price sync
   Fetches live LTP for equities (yahoo-finance2) and crypto
   (CoinGecko), then upserts into public.equity_prices.

   Schedule: every 15 min Mon–Fri 9:00–16:00 IST for equity;
   crypto runs 24/7 on the same cadence.

   Only fetches symbols that users actually hold (queries the
   assets table for distinct symbols/coins). Falls back to the
   full built-in list if no user assets exist.

   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
   ============================================================ */

import yahooFinance from 'yahoo-finance2';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('sync-equity-ltp: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates',
};

async function supaFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Supabase ${path} → HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function upsertPrices(rows) {
  if (!rows.length) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/equity_prices?on_conflict=symbol`, {
    method: 'POST', headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(rows), signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`upsert equity_prices → HTTP ${res.status}: ${await res.text()}`);
}

// ---- Discover which symbols users hold ----
async function getHeldSymbols() {
  try {
    const assets = await supaFetch("assets?select=category,metadata&or=(category.eq.equity,category.eq.esop)");
    const symbols = new Set();
    for (const a of assets) {
      const meta = a.metadata || {};
      const data = meta.data || {};
      if (data.symbol) symbols.add(data.symbol.toUpperCase());
      if (data.ticker) symbols.add(data.ticker.toUpperCase());
    }
    return [...symbols];
  } catch (e) {
    console.warn('sync-equity-ltp: could not query held symbols, using empty list:', e.message);
    return [];
  }
}

async function getHeldCoins() {
  try {
    const assets = await supaFetch("assets?select=category,metadata&category=eq.crypto");
    const coins = new Set();
    for (const a of assets) {
      const meta = a.metadata || {};
      const data = meta.data || {};
      if (data.coinId) coins.add(data.coinId.toUpperCase());
    }
    return [...coins];
  } catch (e) {
    console.warn('sync-equity-ltp: could not query held coins:', e.message);
    return [];
  }
}

// ---- Equity: yahoo-finance2 ----
async function syncEquityPrices(symbols) {
  if (!symbols.length) { console.log('sync-equity-ltp: no equity symbols to sync'); return 0; }

  // Yahoo Finance uses .NS for NSE, .BO for BSE — try NSE first
  const yahooSymbols = symbols.map(s => `${s}.NS`);

  let quotes;
  try {
    quotes = await yahooFinance.quote(yahooSymbols, {}, { validateResult: false });
  } catch (e) {
    console.error('sync-equity-ltp: yahoo-finance2 batch failed:', e.message);
    // Try individually as fallback
    quotes = [];
    for (const ys of yahooSymbols) {
      try {
        const q = await yahooFinance.quote(ys, {}, { validateResult: false });
        if (q) quotes.push(q);
      } catch (e2) { /* skip */ }
    }
  }

  if (!Array.isArray(quotes)) quotes = [quotes].filter(Boolean);

  const now = new Date().toISOString();
  const rows = [];

  for (const q of quotes) {
    if (!q || !q.symbol) continue;
    const price = q.regularMarketPrice;
    if (!(price > 0)) continue;

    // Strip .NS / .BO suffix to get the original symbol
    const sym = q.symbol.replace(/\.(NS|BO)$/, '');
    rows.push({
      symbol: sym,
      price: price,
      change_pct: q.regularMarketChangePercent != null ? +q.regularMarketChangePercent.toFixed(4) : null,
      prev_close: q.regularMarketPreviousClose || null,
      currency: 'INR',
      source: 'yahoo-finance2',
      fetched_at: now,
    });
  }

  // For symbols that failed on .NS, try .BO (BSE)
  const fetched = new Set(rows.map(r => r.symbol));
  const missed = symbols.filter(s => !fetched.has(s));
  if (missed.length) {
    for (const sym of missed) {
      try {
        const q = await yahooFinance.quote(`${sym}.BO`, {}, { validateResult: false });
        if (q && q.regularMarketPrice > 0) {
          rows.push({
            symbol: sym,
            price: q.regularMarketPrice,
            change_pct: q.regularMarketChangePercent != null ? +q.regularMarketChangePercent.toFixed(4) : null,
            prev_close: q.regularMarketPreviousClose || null,
            currency: 'INR',
            source: 'yahoo-finance2 (BSE)',
            fetched_at: now,
          });
        }
      } catch (e) { /* skip */ }
    }
  }

  if (rows.length) await upsertPrices(rows);
  console.log(`sync-equity-ltp: ${rows.length}/${symbols.length} equity prices updated`);
  return rows.length;
}

// ---- Crypto: CoinGecko ----
const COIN_MAP = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin', USDT: 'tether',
  AVAX: 'avalanche-2', DOT: 'polkadot', MATIC: 'matic-network',
  LINK: 'chainlink', UNI: 'uniswap', ATOM: 'cosmos', LTC: 'litecoin',
};

async function syncCryptoPrices(coins) {
  if (!coins.length) { console.log('sync-equity-ltp: no crypto coins to sync'); return 0; }

  // Map our coin IDs to CoinGecko IDs
  const geckoIds = coins.map(c => COIN_MAP[c] || c.toLowerCase()).filter(Boolean);
  if (!geckoIds.length) return 0;

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${geckoIds.join(',')}&vs_currencies=usd&include_24hr_change=true`;

  let data;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`CoinGecko → HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    // Fallback to CoinCap
    console.warn('sync-equity-ltp: CoinGecko failed, trying CoinCap:', e.message);
    try {
      const capUrl = `https://api.coincap.io/v2/assets?ids=${geckoIds.join(',')}`;
      const res = await fetch(capUrl, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`CoinCap → HTTP ${res.status}`);
      const capData = await res.json();
      data = {};
      for (const asset of (capData.data || [])) {
        data[asset.id] = { usd: parseFloat(asset.priceUsd), usd_24h_change: parseFloat(asset.changePercent24Hr) };
      }
    } catch (e2) {
      console.error('sync-equity-ltp: both crypto providers failed:', e2.message);
      return 0;
    }
  }

  const now = new Date().toISOString();
  const rows = [];
  const reverseMap = Object.fromEntries(Object.entries(COIN_MAP).map(([k, v]) => [v, k]));

  for (const [geckoId, priceData] of Object.entries(data)) {
    const price = priceData.usd;
    if (!(price > 0)) continue;
    const symbol = reverseMap[geckoId] || geckoId.toUpperCase();
    rows.push({
      symbol: `crypto:${symbol}`,
      price: price,
      change_pct: priceData.usd_24h_change != null ? +priceData.usd_24h_change.toFixed(4) : null,
      prev_close: null,
      currency: 'USD',
      source: 'coingecko',
      fetched_at: now,
    });
  }

  if (rows.length) await upsertPrices(rows);
  console.log(`sync-equity-ltp: ${rows.length}/${coins.length} crypto prices updated`);
  return rows.length;
}

// ---- Main ----
async function main() {
  let failures = 0;

  // Fetch held symbols from DB
  const symbols = await getHeldSymbols();
  const coins = await getHeldCoins();

  // Add default coins if user has none (so prices are ready for when they add crypto)
  const defaultCoins = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'USDT'];
  const allCoins = [...new Set([...coins, ...defaultCoins])];

  // Sync equity (only if we have symbols to sync)
  if (symbols.length) {
    try { await syncEquityPrices(symbols); }
    catch (e) { failures++; console.error('sync-equity-ltp: equity sync FAILED:', e.message); }
  }

  // Sync crypto (always)
  try { await syncCryptoPrices(allCoins); }
  catch (e) { failures++; console.error('sync-equity-ltp: crypto sync FAILED:', e.message); }

  if (failures) process.exit(1);
  console.log('sync-equity-ltp: done');
}

main().catch(e => { console.error(`sync-equity-ltp: fatal — ${e.message}`); process.exit(1); });
