# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**WealthForge AI** is a single-page app (SPA) for tracking net worth across 12+ asset classes and liabilities, with projections, goals tracking, and insights. Built with vanilla HTML/CSS/JS (no framework) on Vite for a fully self-contained experience. Optionally integrates Supabase for cloud persistence, signup/login, and row-level security.

The app runs in two modes:
- **Local mode** (no env vars): uses `localStorage`, demo-seeded portfolio, fully offline.
- **Cloud mode** (with `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`): per-user data, auth, snapshots, goals, RLS-protected.

## Commands

```bash
npm install           # install dependencies
npm run dev           # start dev server at http://localhost:8000
npm run build         # production build to dist/
npm run preview       # serve the production build locally
npm test              # run unit tests (node tests/run-tests.js)
```

Single test execution uses Node's CommonJS test runner directly:
```bash
node tests/run-tests.js
```

## Architecture

### Code Organization (`js/`)

| Module | Purpose |
|--------|---------|
| **router.js** | HTML5 history routing (`/dashboard`, `/holdings/:type`, `/add/:id`, etc.), legacy `#/x` redirect support. |
| **market.js** | Mock market data service (stocks LTP, MF NAVs, gold/crypto spot, FX rates). Single integration point for real API feeds; currently deterministic simulation so the app is fully self-contained. |
| **finance.js** | Core financial calculations: FD compounding, XIRR (Newton + bisection), CAGR, lognormal Monte Carlo bands, loan amortization, currency formatting. |
| **store.js** | Asset, liability, snapshot, goal models. Valuation dispatcher (per-asset mode override: live-priced/computed/manual). Aggregates net worth, projections, and demo seed data. |
| **cloud.js** | Supabase ↔ Store sync: load all user data, write-through upserts, handles local vs. cloud mode. |
| **auth.js** | Session handling, login/signup/forgot/reset, account pages, demo-read-only enforcement, auth guard plumbing. |
| **insights.js** | Rule-based insights over assets, liabilities, snapshots, and goals. |
| **charts.js** | Dependency-free SVG charts (fan, line, area, donut, hover). |
| **forms.js** | Dynamic type-driven add/edit forms (12 asset types + liabilities). Validation, smart derivation of totals/rates. CSV paste for bulk lots/SIPs. |
| **import.js** | Bulk CSV import per asset type. RFC-ish parser, date/number normalization, per-type schema mapping, preview/confirm modal. Valid rows import; invalid rows reported per row. |
| **views.js** | Dashboard, holdings tabs, asset detail, projections, goals views. |
| **export.js** | CSV backup + jsPDF portfolio snapshot (Noto Sans for ₹). |
| **app.js** | Route handling, add/edit flows, modals (goals/export/share), theme toggle, boot sequence. |
| **supabase.js** | Supabase client initialization from `VITE_*` env vars. Returns null in local mode. |

### Asset Valuation (Three Modes)

Each asset produces three outputs: **current value**, **annualized growth %**, and **future projection**. Valuation mode determines calculation:

1. **Live-priced** (🔵 equity, MFs, gold/crypto):
   - Current: market feed (price/NAV)
   - Projection: Monte Carlo band (lognormal, historical μ/σ; band width scales with volatility)

2. **Computed** (🟣 FDs, EPF/PPF/NPS, fixed-income):
   - Current: deterministic compounding of locked terms
   - Projection: single contractual curve (honours maturity + auto-renewal)

3. **Manual** (🟠 real estate, jewellery, vehicles, art):
   - Current: user estimate or size × rate
   - Projection: deterministic curve at assumed rate (±2pp band)

Debt/liquid funds get narrow bands; crypto bands are widest. Stablecoins project flat.

### Snapshots & Projections

- **Snapshots**: written client-side when dashboard loads (valuations need the client's pricing engine). Optionally carry-forwarded by pg_cron for daily continuity.
- **Projections**: per-asset bands aggregated (p10/p50/p90 summed) into portfolio fan. Liabilities are deterministic curves subtracted from assets for net-worth view.

### Supabase Integration

- **Schema**: schema + RLS + triggers in `supabase/migrations/0001_init.sql`.
- **Security masters** (`0003_security_masters.sql`): `equity_master` (NSE/BSE full listings) and `mf_master` (AMFI full scheme/NAV dump) reference tables with `pg_trgm`-indexed fuzzy search functions (`search_equity`, `search_mf`). Public-readable, service-writable only. Daily sync by `scripts/sync-masters.mjs` via GitHub Actions (`.github/workflows/masters-sync.yml`, 01:30 UTC).
- **Security**: anon key is safe in the client because RLS is enforced on every table (`user_id = auth.uid()`). Demo account is read-only via `is_demo_user()` guards.
- **Account deletion**: uses `delete_own_account()` RPC (security definer) so the client never needs the service-role key.

See `supabase/README.md` for setup instructions (create project, run migrations, seed demo account, configure email auth, set env vars).

## Testing

Unit tests in `tests/run-tests.js` (66 assertions) cover:
- Financial math: FD compounding, XIRR, EPF/PPF/RD/annuity, NPS blended μ/σ, loan amortization (EMI, balance, payoff, interest split)
- Snapshots, goal progress/achievement, valuation-mode override
- Net-worth invariants (linked home-loan no-double-count rule)

Run with `npm test` or `node tests/run-tests.js`.

## Key Decisions & Constraints

- **No framework**: vanilla JS for simplicity and full offline capability.
- **Vite** for environment variables and npm packages.
- **Deterministic pricing** (`js/market.js`): fully self-contained; swap with real APIs as a single integration point.
- **RLS-first security**: client-side anon key safe because every table enforces `user_id = auth.uid()`.
- **HTML5 history routing** with SPA rewrite in `vercel.json` for Vercel deployments; legacy `#/x` links redirect.
- **Charts**: dependency-free SVG; tint from CSS design tokens for light/dark theme support.
- **Bulk import** (`js/import.js`): per-type CSV schema with RFC-ish parser, date/number normalization, preview/confirm modal. Valid rows import; invalid rows reported per row (number + reason).
- **Security masters**: daily sync of NSE/BSE equity listings + AMFI MF schemes/NAVs via GitHub Actions. `pg_trgm`-indexed fuzzy search for autocomplete.

## Screens & Routing

| Route | Screen | Notes |
|-------|--------|-------|
| `/dashboard` | Net worth hero, 3M/6M/1Y/All history chart, AI insights, allocation donut, 10-year outlook, asset-class cards, goals, movers, share/export. | Writes a snapshot on load (in cloud mode). |
| `/holdings/:type` | 12 tabs: Equity, MFs, ESOPs, Crypto, FDs, Small Savings, EPF, PPF, NPS, Gold, Real Estate, Others. Type-specific columns, footer totals. | — |
| `/liabilities` | Loans and card balances. Shows outstanding, amortized payoff date, EMI split, interest remaining. | Linked home loans affect property net equity. |
| `/asset/:id` | Detail: value, growth (XIRR/CAGR/contract rate), valuation-mode toggle, type-specific chart, vesting timeline (grants), 10-year projection. | — |
| `/add/:type` or `/edit/:id` | Dynamic type-driven form. Quick path (qty + cost + date) default; advanced fields behind expanders. CSV paste for lots. | Form varies per asset type (e.g., equity ≠ FD). |
| `/add-liability` or `/edit-liability/:id` | Capture loans/cards, linked to assets (home loan ↔ property). Live payoff/interest preview. | — |
| `/projections/:years?/:mode?` | Portfolio fan (1/3/5/10/20y), net-worth vs. assets-only toggle, per-asset table with liability payoff row. | — |
| `/goals` | Net-worth goals with progress bars, projected achievement dates, toast + optional Web Notification on hit. | — |
| `/settings` | Theme toggle (light/dark), data-sources table. | — |
| `/account` | Profile (display name, currency), change password, CSV/PDF export, delete account. | Account deletion uses RPC. |
| `/login`, `/signup`, `/forgot`, `/reset` | Email+password auth (Supabase), one-click read-only demo account. | Pages explain local mode if no env vars. |

## Environment Variables

**Client** (Vite, prefix with `VITE_`):
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

**Server** (GitHub Actions for security masters sync):
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Create `.env` file locally; set in Vercel for client deployments and GitHub Actions secrets for the sync workflow. Without client env vars, the app runs in local mode with `localStorage`.

See `.env.example` for template.

## Common Workflows

### Adding a new asset type

1. Update `js/store.js` → `ASSET_TYPES` and `validateAsset()`.
2. Add form schema to `js/forms.js` → type-specific fields.
3. Implement valuation in `js/store.js` → `valuate()`.
4. Add projection logic (Monte Carlo, compounding, or manual curve).
5. Add columns to `js/views.js` → holdings table.
6. Add test in `tests/run-tests.js`.

### Integrating a real market feed

Replace deterministic logic in `js/market.js`:
- `getStockPrice(ticker)` → call your stock API (or query `equity_master` + fetch live price)
- `getMFNav(amfiCode)` → call MF NAV service (or read `mf_master.nav` column — daily sync keeps NAVs fresh)
- `getMetalSpot()` → call metal price service
- `getCryptoPrices()` → call crypto API
- `getFXRates()` → call FX service

The rest of the app (XIRR, projections, etc.) is independent of pricing source.

**Security masters**: `search_equity(q text, max_results int)` and `search_mf(q text, max_results int)` SQL functions provide fuzzy + partial matching over the full NSE/BSE/AMFI universe. Client-side autocomplete can call these via Supabase RPC.

### Testing locally with Supabase

1. Create a Supabase project (free tier OK).
2. Run migrations in order: SQL editor → paste `supabase/migrations/0001_init.sql`, then `0003_security_masters.sql`.
3. Run seed: SQL editor → paste `supabase/seed.sql` (demo account + sample portfolio).
4. Copy URL + anon key to `.env`.
5. `npm run dev` and test signup/login locally.

Snapshots and goals are cloud-only; they won't sync in local mode.

**Security masters sync** (optional): set GitHub Actions secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) to enable daily NSE/BSE/AMFI refresh. Run manually: `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/sync-masters.mjs`.
