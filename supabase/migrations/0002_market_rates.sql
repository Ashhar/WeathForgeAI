-- ============================================================
-- 0002 — market_rates: server-synced spot rates with as-of times
--
-- Live gold/silver (₹/gram) and USD/INR rates written by the
-- scheduled sync job (.github/workflows/market-data-sync.yml →
-- scripts/sync-rates.mjs) using the service-role key. The client
-- reads these at boot and falls back to its built-in simulated
-- rates when the table is empty or unreachable.
--
-- Additive only: new table, no changes to existing objects.
-- ============================================================

create table if not exists public.market_rates (
  id         text primary key,          -- 'gold' | 'silver' | 'USDINR' (extensible)
  rate       numeric not null,          -- metals: ₹ per gram (24K/999 basis); FX: ₹ per USD
  unit       text not null,             -- 'INR_PER_GRAM' | 'INR_PER_USD'
  source     text,                      -- provider that produced the value
  fetched_at timestamptz not null default now(),  -- when the provider quoted it
  updated_at timestamptz not null default now()
);

comment on table public.market_rates is
  'Spot reference rates written by the scheduled market-data sync job; public read-only reference data.';

alter table public.market_rates enable row level security;

-- Reference data: readable by everyone (anon + authenticated).
-- No insert/update/delete policies — only the service role (which
-- bypasses RLS) can write, i.e. the scheduled sync job.
create policy "market_rates_public_read" on public.market_rates
  for select using (true);

create trigger market_rates_touch before update on public.market_rates
  for each row execute function public.touch_updated_at();
