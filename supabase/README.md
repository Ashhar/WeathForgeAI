# Supabase setup

The app runs in two modes:

- **Local mode** (no env vars): data lives in `localStorage`, exactly like the
  original zero-backend app. Auth pages explain the situation instead of breaking.
- **Cloud mode** (`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` set): signup /
  login / demo account, per-user data with Row Level Security, snapshots, goals.

## One-time project setup

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. SQL editor → run `migrations/0001_init.sql` (schema, RLS, triggers).
3. SQL editor → run `seed.sql` (creates `demo@wealthforge.ai` / `wealthforge-demo`
   with the sample portfolio, 12 months of snapshots and two goals).
4. Authentication → Providers → Email: enable. For a friction-free start you can
   disable "Confirm email"; the app supports either setting.
5. Copy the project URL + anon key into `.env` (see `.env.example`) locally, and
   into Vercel → Project → Settings → Environment Variables for deploys.

## Notes

- The anon key is safe to ship in the client bundle **because RLS is enabled on
  every table** — a user can only read/write rows where `user_id = auth.uid()`.
- The demo account is enforced read-only in the database (`is_demo_user()` guards
  every insert/update/delete policy), so nobody can vandalize shared demo data.
- Snapshots are written client-side when a user opens their dashboard (valuations
  need the client's pricing engine); `carry_forward_snapshots()` + pg_cron
  (optional, see the bottom of the migration) keeps charts continuous for users
  who don't visit daily.
- Account deletion uses the `delete_own_account()` RPC (security definer) so the
  client never needs the service-role key.
