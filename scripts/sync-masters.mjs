#!/usr/bin/env node
/* ============================================================
   WealthForge AI — security-master ingestion
   Refreshes public.equity_master and public.mf_master from the
   complete official sources:
   - NSE: the full equity securities list (EQUITY_L.csv)
   - BSE: the active equity scrip master (JSON API)
   - AMFI: the full NAVAll scheme/NAV dump (also refreshes NAVs)
   Run daily by .github/workflows/masters-sync.yml.

   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
   ============================================================ */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('sync-masters: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function fetchText(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

// minimal CSV split with quote support (NSE names contain commas)
function splitCsvLine(line) {
  const out = [];
  let field = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) { if (ch === '"') { if (line[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(field.trim()); field = ''; }
    else field += ch;
  }
  out.push(field.trim());
  return out;
}

async function upsertBatched(table, rows, conflict) {
  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows.slice(i, i + 1000);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflict}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`upsert ${table} batch ${i / 1000} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

const now = new Date().toISOString();

// ---- NSE ----
async function syncNse() {
  const csv = await fetchText('https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv', { Accept: 'text/csv,*/*' });
  const lines = csv.split(/\r?\n/).filter(l => l.trim());
  const header = splitCsvLine(lines[0]).map(h => h.toUpperCase());
  const idx = k => header.findIndex(h => h.includes(k));
  const iSym = idx('SYMBOL'), iName = idx('NAME'), iSeries = idx('SERIES'), iIsin = idx('ISIN');
  if (iSym < 0 || iName < 0 || iIsin < 0) throw new Error('NSE header format changed: ' + lines[0]);
  const rows = lines.slice(1).map(splitCsvLine).filter(c => c[iSym]).map(c => ({
    exchange: 'NSE', symbol: c[iSym], name: c[iName], isin: c[iIsin] || null,
    series: c[iSeries] || null, status: 'active', updated_at: now,
  }));
  if (rows.length < 1500) throw new Error(`NSE list suspiciously small (${rows.length} rows) — refusing to ingest`);
  await upsertBatched('equity_master', rows, 'exchange,symbol');
  return rows.length;
}

// ---- BSE ----
async function syncBse() {
  const json = await fetchText(
    'https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Group=&Scripcode=&industry=&segment=Equity&status=Active',
    { Referer: 'https://www.bseindia.com/', Accept: 'application/json' });
  const list = JSON.parse(json);
  if (!Array.isArray(list)) throw new Error('BSE scrip master: unexpected payload');
  const rows = list.filter(s => s.scrip_id || s.SCRIP_CD).map(s => ({
    exchange: 'BSE', symbol: String(s.scrip_id || s.SCRIP_CD), name: s.Issuer_Name || s.Scrip_Name || String(s.scrip_id),
    isin: s.ISIN_NUMBER || null, series: s.GROUP || null, scrip_code: String(s.SCRIP_CD || ''),
    status: 'active', updated_at: now,
  }));
  if (rows.length < 3000) throw new Error(`BSE list suspiciously small (${rows.length} rows) — refusing to ingest`);
  // the API can repeat scrips; last one wins within a batch conflict target
  const seen = new Map();
  rows.forEach(r => seen.set(r.symbol, r));
  await upsertBatched('equity_master', [...seen.values()], 'exchange,symbol');
  return seen.size;
}

// ---- AMFI ----
function mfCategory(header) {
  const h = (header || '').toLowerCase();
  if (/liquid|overnight|money market/.test(h)) return 'liquid';
  if (/debt|gilt|bond|duration|floater/.test(h)) return 'debt';
  if (/hybrid|balanced|arbitrage|multi asset/.test(h)) return 'hybrid';
  if (/equity|elss|index|etf|fof/.test(h)) return 'equity';
  return 'other';
}

async function syncAmfi() {
  const txt = await fetchText('https://portal.amfiindia.com/spages/NAVAll.txt');
  const lines = txt.split(/\r?\n/);
  let subCategory = null, amc = null;
  const rows = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.includes(';')) {
      const [code, isin1, isin2, name, nav, date] = line.split(';').map(x => x.trim());
      if (!/^\d+$/.test(code)) continue; // header line of the dump
      const navNum = parseFloat(nav);
      // AMFI dates: DD-Mon-YYYY
      const m = date && date.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
      const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
      const navDate = m ? `${m[3]}-${String(months[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
      rows.push({
        scheme_code: code, name,
        amc, category: mfCategory(subCategory), sub_category: subCategory,
        plan: /\bdirect\b/i.test(name) ? 'Direct' : 'Regular',
        option: /idcw|dividend|income distribution|payout/i.test(name) ? 'IDCW' : 'Growth',
        isin: isin1 && isin1 !== '-' ? isin1 : null,
        isin_reinvest: isin2 && isin2 !== '-' ? isin2 : null,
        nav: isFinite(navNum) ? navNum : null, nav_date: navDate,
        updated_at: now,
      });
    } else if (/schemes?\s*\(/i.test(line)) {
      subCategory = line;
    } else {
      amc = line; // AMC section header
    }
  }
  if (rows.length < 8000) throw new Error(`AMFI dump suspiciously small (${rows.length} rows) — refusing to ingest`);
  // dedupe on scheme_code (a code can repeat across dump sections)
  const seen = new Map();
  rows.forEach(r => seen.set(r.scheme_code, r));
  await upsertBatched('mf_master', [...seen.values()], 'scheme_code');
  return seen.size;
}

let failures = 0;
for (const [label, job] of [['NSE', syncNse], ['BSE', syncBse], ['AMFI', syncAmfi]]) {
  try {
    const n = await job();
    console.log(`sync-masters: ${label} ingested ${n} rows`);
  } catch (e) {
    failures++;
    console.error(`sync-masters: ${label} FAILED — existing master rows stay in place: ${e.message}`);
  }
}
if (failures) process.exit(1);
