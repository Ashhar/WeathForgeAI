-- ============================================================
-- 0003 — equity_master + mf_master: full NSE/BSE/AMFI universe
--
-- Reference tables refreshed daily by scripts/sync-masters.mjs
-- (.github/workflows/masters-sync.yml) from the official sources:
-- NSE EQUITY_L.csv, the BSE active scrip master, and the AMFI
-- NAVAll scheme/NAV dump. Client search reads these through the
-- search_equity / search_mf functions (fuzzy + partial matching,
-- ISIN-deduped across exchanges).
--
-- Additive only: new extension, tables, indexes and functions.
-- ============================================================

create extension if not exists pg_trgm;

-- ---- listed equities (one row per exchange listing) ----
create table if not exists public.equity_master (
  exchange   text not null,              -- 'NSE' | 'BSE'
  symbol     text not null,              -- trading symbol (BSE: scrip_id)
  name       text not null,              -- company name
  isin       text,                       -- dedupe key across exchanges
  series     text,                       -- NSE series / BSE group
  scrip_code text,                       -- BSE numeric scrip code
  status     text not null default 'active',
  updated_at timestamptz not null default now(),
  primary key (exchange, symbol)
);

create index if not exists equity_master_name_trgm on public.equity_master using gin (name gin_trgm_ops);
create index if not exists equity_master_symbol_trgm on public.equity_master using gin (symbol gin_trgm_ops);
create index if not exists equity_master_isin_idx on public.equity_master (isin);

-- ---- mutual fund schemes (one row per AMFI scheme code) ----
create table if not exists public.mf_master (
  scheme_code   text primary key,        -- AMFI scheme code
  name          text not null,           -- full scheme name (incl. plan/option)
  amc           text,                    -- fund house (AMFI section header)
  category      text,                    -- equity | debt | hybrid | liquid | other
  sub_category  text,                    -- AMFI scheme-category header text
  plan          text,                    -- 'Direct' | 'Regular' (parsed from name)
  option        text,                    -- 'Growth' | 'IDCW' (parsed from name)
  isin          text,                    -- ISIN (div payout / growth)
  isin_reinvest text,                    -- ISIN (div reinvestment)
  nav           numeric,                 -- latest NAV from NAVAll
  nav_date      date,
  updated_at    timestamptz not null default now()
);

create index if not exists mf_master_name_trgm on public.mf_master using gin (name gin_trgm_ops);
create index if not exists mf_master_isin_idx on public.mf_master (isin);
create index if not exists mf_master_amc_idx on public.mf_master (amc);

-- Reference data: readable by everyone; writable only by the service
-- role (no insert/update/delete policies).
alter table public.equity_master enable row level security;
alter table public.mf_master enable row level security;
create policy "equity_master_public_read" on public.equity_master for select using (true);
create policy "mf_master_public_read" on public.mf_master for select using (true);

-- ---- search: fuzzy + partial, ISIN-deduped across exchanges ----
create or replace function public.search_equity(q text, max_results int default 10)
returns table (isin text, symbol text, name text, exchanges text[], series text)
language sql stable as $$
  with matches as (
    select em.*,
      greatest(similarity(em.name, q), similarity(em.symbol, q), word_similarity(q, em.name)) as sim,
      (em.symbol ilike q || '%')::int as sym_prefix,
      (em.exchange = 'NSE')::int as nse_first
    from public.equity_master em
    where em.status = 'active'
      and (em.symbol ilike '%' || q || '%'
        or em.name ilike '%' || q || '%'
        or em.name % q
        or q <% em.name)
  ), grouped as (
    select
      coalesce(nullif(m.isin, ''), m.exchange || ':' || m.symbol) as grp,
      (array_agg(m.isin order by m.nse_first desc, m.exchange))[1] as isin,
      (array_agg(m.symbol order by m.nse_first desc, m.exchange))[1] as symbol,
      (array_agg(m.name order by m.nse_first desc, m.exchange))[1] as name,
      array_agg(distinct m.exchange order by m.exchange) as exchanges,
      (array_agg(m.series order by m.nse_first desc, m.exchange))[1] as series,
      max(m.sim) as sim,
      max(m.sym_prefix) as sym_prefix
    from matches m
    group by 1
  )
  select g.isin, g.symbol, g.name, g.exchanges, g.series
  from grouped g
  order by g.sym_prefix desc, g.sim desc, g.name
  limit greatest(1, least(max_results, 50));
$$;

create or replace function public.search_mf(q text, max_results int default 10)
returns table (scheme_code text, name text, amc text, category text,
               plan text, option text, isin text, nav numeric, nav_date date)
language sql stable as $$
  select mm.scheme_code, mm.name, mm.amc, mm.category, mm.plan, mm.option,
         mm.isin, mm.nav, mm.nav_date
  from public.mf_master mm
  where mm.scheme_code like q || '%'
     or mm.name ilike '%' || q || '%'
     or mm.amc ilike '%' || q || '%'
     or mm.name % q
     or q <% mm.name
  order by (mm.scheme_code = q) desc,
           (mm.name ilike q || '%')::int desc,
           greatest(similarity(mm.name, q), word_similarity(q, mm.name)) desc,
           mm.name
  limit greatest(1, least(max_results, 50));
$$;
