#!/usr/bin/env node
/* ============================================================
   WealthForge AI — scheduled market-rate sync
   Fetches gold/silver spot (₹/gram, 24K/999 basis) and USD/INR,
   then upserts them into public.market_rates with a fetched_at
   timestamp. Run by .github/workflows/market-data-sync.yml every
   20 minutes (metals target: 15–30 min, FX target: hourly).

   Providers
   - FX (USD/INR): open.er-api.com (keyless, hourly refresh),
     falling back to frankfurter.dev (ECB daily).
   - Metals: metals.dev when METALS_API_KEY is set (INR-native,
     recommended for Indian pricing); otherwise the keyless
     gold-api.com XAU/XAG spot (USD/oz) converted via the fetched
     USD/INR rate.

   Failure semantics: a failed fetch leaves the previous row in
   place (the client shows "last known rate from <fetched_at>").
   Failures are logged and the process exits non-zero so the
   Actions run is visibly red.

   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, [METALS_API_KEY]
   ============================================================ */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const METALS_API_KEY = process.env.METALS_API_KEY || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('sync-rates: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const TROY_OUNCE_GRAMS = 31.1034768;

async function getJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

// ---- FX: ₹ per USD ----
async function fetchUsdInr() {
  try {
    const j = await getJson('https://open.er-api.com/v6/latest/USD');
    const inr = j && j.rates && j.rates.INR;
    if (!(inr > 0)) throw new Error('open.er-api.com returned no INR rate');
    return { rate: inr, source: 'open.er-api.com' };
  } catch (e) {
    console.error(`sync-rates: primary FX provider failed (${e.message}); trying fallback`);
    const j = await getJson('https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR');
    const inr = j && j.rates && j.rates.INR;
    if (!(inr > 0)) throw new Error('frankfurter.dev returned no INR rate');
    return { rate: inr, source: 'frankfurter.dev (ECB)' };
  }
}

// ---- Metals: ₹ per gram, 24K/999 basis ----
async function fetchMetalsViaMetalsDev() {
  const j = await getJson(`https://api.metals.dev/v1/latest?api_key=${METALS_API_KEY}&currency=INR&unit=g`);
  const gold = j && j.metals && j.metals.gold;
  const silver = j && j.metals && j.metals.silver;
  if (!(gold > 0) || !(silver > 0)) throw new Error('metals.dev returned no gold/silver rate');
  return { gold, silver, source: 'metals.dev' };
}

async function fetchMetalsViaGoldApi(usdInr) {
  const [xau, xag] = await Promise.all([
    getJson('https://api.gold-api.com/price/XAU'),
    getJson('https://api.gold-api.com/price/XAG'),
  ]);
  if (!(xau && xau.price > 0) || !(xag && xag.price > 0)) throw new Error('gold-api.com returned no XAU/XAG price');
  const toInrPerGram = usdOz => (usdOz * usdInr) / TROY_OUNCE_GRAMS;
  return { gold: toInrPerGram(xau.price), silver: toInrPerGram(xag.price), source: 'gold-api.com (spot, FX-converted)' };
}

async function upsertRate(id, rate, unit, source, fetchedAt) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/market_rates?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify([{ id, rate, unit, source, fetched_at: fetchedAt }]),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`upsert ${id} → HTTP ${res.status}: ${await res.text()}`);
}

async function main() {
  const now = new Date().toISOString();
  let failures = 0;

  let fx = null;
  try {
    fx = await fetchUsdInr();
    await upsertRate('USDINR', fx.rate, 'INR_PER_USD', fx.source, now);
    console.log(`sync-rates: USDINR ₹${fx.rate.toFixed(4)}/$ (${fx.source})`);
  } catch (e) {
    failures++;
    console.error(`sync-rates: FX sync FAILED — last known rate stays live: ${e.message}`);
  }

  try {
    let metals;
    if (METALS_API_KEY) {
      metals = await fetchMetalsViaMetalsDev();
    } else {
      if (!fx) throw new Error('no USD/INR rate available to convert spot metals');
      metals = await fetchMetalsViaGoldApi(fx.rate);
    }
    await upsertRate('gold', metals.gold, 'INR_PER_GRAM', metals.source, now);
    await upsertRate('silver', metals.silver, 'INR_PER_GRAM', metals.source, now);
    console.log(`sync-rates: gold ₹${metals.gold.toFixed(2)}/g, silver ₹${metals.silver.toFixed(2)}/g (${metals.source})`);
  } catch (e) {
    failures++;
    console.error(`sync-rates: metals sync FAILED — last known rates stay live: ${e.message}`);
  }

  if (failures) process.exit(1);
}

main().catch(e => { console.error(`sync-rates: fatal — ${e.message}`); process.exit(1); });
