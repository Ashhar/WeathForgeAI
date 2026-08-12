-- ============================================================
-- 0005 — equity_prices: live LTP for held equities + crypto
--
-- Written by scripts/sync-equity-ltp.mjs every 15 min during
-- market hours (equity) and 24/7 (crypto). The client reads
-- these at boot via loadHeldPrices() and populates the in-memory
-- stock/coin objects with live prices + day change %.
--
-- Additive only: new table, no changes to existing objects.
-- ============================================================

create table if not exists public.equity_prices (
  symbol      text primary key,            -- NSE/BSE symbol (e.g. 'RELIANCE') or 'crypto:BTC'
  price       numeric not null,            -- LTP (₹ for equity, USD for crypto)
  change_pct  numeric,                     -- day change % (e.g. 1.23 means +1.23%)
  prev_close  numeric,                     -- previous closing price
  currency    text not null default 'INR', -- 'INR' for equity, 'USD' for crypto
  source      text,                        -- 'yahoo-finance2' | 'coingecko' | 'coincap'
  fetched_at  timestamptz not null default now()
);

comment on table public.equity_prices is
  'Live equity LTP and crypto prices written by the scheduled sync job; public read-only.';

alter table public.equity_prices enable row level security;

create policy "equity_prices_public_read" on public.equity_prices
  for select using (true);
