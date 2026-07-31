-- ============================================================
-- WealthForge AI — initial schema
-- Run in the Supabase SQL editor (or `supabase db push`).
-- Every user-data table has Row Level Security: users only see
-- their own rows; demo accounts (profiles.is_demo) are read-only
-- at the database level, not just in the UI.
-- ============================================================

-- ---------- profiles (1:1 with auth.users) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  base_currency text default 'INR',
  is_demo boolean default false,
  created_at timestamptz default now()
);

-- ---------- assets ----------
-- category holds the app's native asset type:
--   equity | mf | esop | crypto | fd | smallsavings | epf | ppf | nps |
--   gold | realestate | other
-- metadata holds the full rich asset model the client uses
-- (acquiredOn, ownership/sharePct, per-type `data` such as lots,
-- vesting schedules, FD terms…). `value` is a denormalized current
-- value in the base currency, refreshed by the client on write.
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  category text not null,
  value numeric not null default 0,
  quantity numeric,
  valuation_mode text default 'manual', -- live | computed | manual
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists assets_user_idx on public.assets (user_id);

-- ---------- liabilities ----------
create table if not exists public.liabilities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  type text not null, -- homeloan | carloan | personal | education | creditcard | otherloan
  balance numeric not null default 0,
  interest_rate numeric,
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists liabilities_user_idx on public.liabilities (user_id);

-- ---------- net worth snapshots (historical chart) ----------
-- breakdown: optional per-asset-class totals for allocation insights
create table if not exists public.net_worth_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  snapshot_date date not null,
  total_assets numeric not null,
  total_liabilities numeric not null,
  net_worth numeric not null,
  breakdown jsonb default '{}',
  created_at timestamptz default now(),
  unique (user_id, snapshot_date)
);
create index if not exists snapshots_user_date_idx on public.net_worth_snapshots (user_id, snapshot_date);

-- ---------- goals ----------
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text not null,
  target_amount numeric not null,
  target_date date,
  achieved boolean default false,
  achieved_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists goals_user_idx on public.goals (user_id);

-- ============================================================
-- helpers & triggers
-- ============================================================

-- auto-create a profile row on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at maintenance
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists assets_touch on public.assets;
create trigger assets_touch before update on public.assets
  for each row execute function public.touch_updated_at();
drop trigger if exists liabilities_touch on public.liabilities;
create trigger liabilities_touch before update on public.liabilities
  for each row execute function public.touch_updated_at();

-- demo detection (used in RLS so demo data is read-only server-side)
create or replace function public.is_demo_user(uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select is_demo from public.profiles where id = uid), false);
$$;

-- account self-deletion (cascades wipe all user data)
create or replace function public.delete_own_account()
returns void
language plpgsql security definer set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if public.is_demo_user(auth.uid()) then
    raise exception 'The shared demo account cannot be deleted';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;

-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.profiles enable row level security;
create policy "own profile - select" on public.profiles
  for select using (auth.uid() = id);
create policy "own profile - update" on public.profiles
  for update using (auth.uid() = id and not public.is_demo_user(auth.uid()));

alter table public.assets enable row level security;
create policy "own rows - select" on public.assets
  for select using (auth.uid() = user_id);
create policy "own rows - insert" on public.assets
  for insert with check (auth.uid() = user_id and not public.is_demo_user(auth.uid()));
create policy "own rows - update" on public.assets
  for update using (auth.uid() = user_id and not public.is_demo_user(auth.uid()));
create policy "own rows - delete" on public.assets
  for delete using (auth.uid() = user_id and not public.is_demo_user(auth.uid()));

alter table public.liabilities enable row level security;
create policy "own rows - select" on public.liabilities
  for select using (auth.uid() = user_id);
create policy "own rows - insert" on public.liabilities
  for insert with check (auth.uid() = user_id and not public.is_demo_user(auth.uid()));
create policy "own rows - update" on public.liabilities
  for update using (auth.uid() = user_id and not public.is_demo_user(auth.uid()));
create policy "own rows - delete" on public.liabilities
  for delete using (auth.uid() = user_id and not public.is_demo_user(auth.uid()));

alter table public.net_worth_snapshots enable row level security;
create policy "own rows - select" on public.net_worth_snapshots
  for select using (auth.uid() = user_id);
create policy "own rows - insert" on public.net_worth_snapshots
  for insert with check (auth.uid() = user_id and not public.is_demo_user(auth.uid()));
create policy "own rows - update" on public.net_worth_snapshots
  for update using (auth.uid() = user_id and not public.is_demo_user(auth.uid()));
create policy "own rows - delete" on public.net_worth_snapshots
  for delete using (auth.uid() = user_id and not public.is_demo_user(auth.uid()));

alter table public.goals enable row level security;
create policy "own rows - select" on public.goals
  for select using (auth.uid() = user_id);
create policy "own rows - insert" on public.goals
  for insert with check (auth.uid() = user_id and not public.is_demo_user(auth.uid()));
create policy "own rows - update" on public.goals
  for update using (auth.uid() = user_id and not public.is_demo_user(auth.uid()));
create policy "own rows - delete" on public.goals
  for delete using (auth.uid() = user_id and not public.is_demo_user(auth.uid()));

-- ============================================================
-- snapshot generation
-- ============================================================
-- Valuations (live prices, FD accrual, vesting) are computed by the
-- client, so the authoritative snapshot is written client-side when a
-- user opens the dashboard (deduped by the unique constraint). This
-- server-side function carries the last snapshot forward daily for
-- users who don't open the app, keeping charts continuous.
create or replace function public.carry_forward_snapshots()
returns void
language sql security definer set search_path = public
as $$
  insert into public.net_worth_snapshots
    (user_id, snapshot_date, total_assets, total_liabilities, net_worth, breakdown)
  select distinct on (user_id)
    user_id, current_date, total_assets, total_liabilities, net_worth, breakdown
  from public.net_worth_snapshots
  order by user_id, snapshot_date desc
  on conflict (user_id, snapshot_date) do nothing;
$$;

-- Optional: schedule it daily with pg_cron (enable the extension in
-- Dashboard → Database → Extensions first):
--   select cron.schedule('daily-networth-snapshot', '30 0 * * *',
--     $$select public.carry_forward_snapshots()$$);
