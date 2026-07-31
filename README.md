# WealthForge AI

Track, grow and project your whole net worth — every asset you *already own* in one place:
equity, mutual funds, fixed deposits, EPF/PPF/NPS, small savings, ESOPs/RSUs, gold & silver,
real estate, crypto — plus your loans, so net worth is honest: **assets − liabilities**.

Vanilla HTML/CSS/JS single-page app (no framework), built with Vite so environment
variables and npm packages work. Without Supabase env vars it runs fully offline,
seeded with a demo portfolio persisted to `localStorage`; with them (see
`supabase/README.md`) you get signup/login, a shared read-only demo account and
per-user cloud data behind Row Level Security.

```bash
npm install
npm run dev        # → http://localhost:8000
npm run build      # production bundle in dist/ (Vercel: SPA rewrite in vercel.json)
```

## Screens & navigation

| Route | Screen |
|---|---|
| `#/dashboard` | Net worth hero (assets − liabilities), rule-based insights with cited sources, allocation donut, 10-year net-worth outlook, asset-class cards, movers & best performers |
| `#/holdings/:type` | 12 holdings tabs (Equity / MFs / ESOPs / Crypto / FDs / Small Savings / EPF / PPF / NPS / Gold / Real Estate / Others) with type-specific columns + footer totals |
| `#/liabilities` | Loans & card balances — amortized outstanding, EMI split (P/I), payoff date, interest remaining, footer total |
| `#/asset/:id` | Asset detail — value, growth (XIRR/CAGR/contract rate), mode-appropriate chart, vesting timeline for grants, statement-freshness panel, 10-year projection |
| `#/add` → `#/add/:type` | Add flow — grouped type picker (Market-linked · Deposits & small savings · Retirement · Property & physical · Liabilities · Other), then a dynamic type-driven form |
| `#/add-liability`, `#/edit-liability/:id` | Liability capture with live payoff/interest preview and asset linking (home loan ↔ property) |
| `#/edit/:id` | Same form, pre-filled (revalue a property, update EPF from a statement, mark an FD matured) |
| `#/projections/:years?/:mode?` | Whole-portfolio fan (1/3/5/10/20y), **net worth vs assets-only** toggle, per-asset table with the liability payoff row |
| `#/settings` | Light/dark theme toggle + data-sources table (every feed with its Live/Computed/Manual tag) |

## The three outputs every asset produces (spec §C)

1. **Current holding value** — value driver differs per type (live price/NAV, contractual accrual, or manual estimate).
2. **Growth %** — absolute return (₹ and %) plus **annualized**: **XIRR** when transaction lots exist (staggered buys/SIPs), CAGR for single lump sums, simple return under 1 year.
3. **Future projection** — method chosen automatically from the valuation mode, always framed as *illustrative, not financial advice*.

## Three valuation modes (spec §B)

| Mode | Current value | Projection | Types |
|---|---|---|---|
| **Live-priced** 🔵 | market feed (price/NAV) | Monte Carlo band (lognormal, historical μ/σ; band width scales with volatility) | equity, MFs, gold/SGB/ETF, crypto |
| **Computed** 🟣 | deterministic compounding of locked terms | single contractual curve (honours maturity + auto-renew) | FDs, PPF/EPF/NPS/bonds ("Others → fixed-income") |
| **Manual** 🟠 | user estimate (or size × rate) | deterministic curve at assumed rate (can be negative), flexed ±2pp band | real estate, jewellery resale, vehicles, art |

Every holding shows its mode tag in the UI. Debt/liquid funds get far narrower bands than equity; crypto bands are widest by design; stablecoins project ≈ flat.

## Per-type capture (spec §E)

- **FD** — per-record locked terms (principal, rate, start, tenure **↔** maturity auto-derived, compounding default quarterly, cumulative vs payout), bank/NBFC/post-office, auto-renewal, tax-saver 80C, TDS note, status; computes accrued value `P·(1+r/n)^(n·t)` and maturity value.
- **Equity** — scrip search w/ autocomplete (drives LTP), qty, avg price **↔** total invested derived, lots for XIRR, dividends, charges into cost basis, corporate-action prompt, FX for US stocks.
- **Mutual fund** — scheme search (name/AMFI code), Direct/Regular + Growth/IDCW, units **↔** amount via NAV, SIP details (feeds XIRR + projected contributions), folio, category-driven band width, ELSS lock-in note.
- **Gold/silver** — form first (physical/digital/SGB/ETF) since it decides valuation; grams × purity-adjusted spot rate or units × price; making charges captured as **non-recoverable**; SGB layers fixed 2.5% interest over the metal path.
- **Real estate** — purchase price/date, current estimate + last-revalued date, assumed appreciation, size × rate alternate estimate, **net equity (value − loan) × ownership share** into net worth, rent yield, acquisition costs into basis.
- **Crypto** — coin search, 8-dp quantities, USD/INR purchase currency with FX note, DCA lots → XIRR, staking, stablecoin flag, extra-wide band + explicit caveat.
- **Others** — appreciating / depreciating (negative rates) / fixed-income-like sub-patterns; manual or rate-based valuation.
- **EPF/PF** — statement balance + monthly employee/employer/VPF contributions at the statutory rate; projects the corpus at your retirement age.
- **PPF** — balance + annual contribution (₹1.5L cap validated inline), 15-year maturity auto-derived from open date, extension in 5-year blocks.
- **NPS** — corpus + monthly contribution + E/C/G allocation (validated to 100) → blended μ/σ feeds the existing Monte Carlo engine; tagged Live with a market-linked note.
- **Small savings** — RD (recurring monthly compounding), SSY (annual contributions, cap validated), KVP/NSC/PO TD (lump-sum compounding), PO MIS (payout scheme with monthly income).
- **ESOPs/RSUs** — grant type (RSU/ISO/NSO), vesting schedule (cliff + monthly/quarterly/annual), vested vs unvested split, option intrinsic value (price − strike, floored at 0), vesting-timeline visual; listed tickers use the equity Monte Carlo band, private companies are tagged illiquid/assumption-based.

## Liabilities

Home / car / personal / education loans, credit cards and other loans live in a parallel
collection. Each stores outstanding balance (as of a statement date), rate, EMI, lender and an
optional link to an asset. The app amortizes the balance forward, computes the payoff date, the
EMI principal/interest split and total interest remaining. A home loan linked to a property is
counted once (under liabilities) while the property shows gross value + net equity — no
double-counting. Projections subtract the deterministic payoff curve from the assets fan for the
net-worth view. Liabilities get a neutral "owed" treatment, not the P&L loss palette.

**Shared:** label/nickname, acquisition date, tags/notes, single/joint ownership with share % (net worth counts your share only), currency + FX note. **Quick path** (quantity + avg cost + date) is the default; identity/advanced fields sit behind "Add more details" expanders; lots support **CSV paste**; "Import statement" affordance is stubbed per type.

## Code map

```
index.html        app shell + sidebar navigation
styles.css        design system (dark fintech theme, gold brand accent)
js/market.js      mock market service — stocks, MF NAVs, coins, metal rates, FX,
                  deterministic simulated price histories (swap for real APIs)
js/finance.js     FD compounding, CAGR, XIRR (Newton + bisection), lognormal
                  Monte Carlo bands, deterministic/contractual curves, ₹ formatting
js/store.js       asset + liability model, per-type valuation dispatcher,
                  amortization, projections, net-worth aggregation, demo seed
js/insights.js    rule-based insights over assets + liabilities (cited sources,
                  informational-not-advice framing)
js/charts.js      dependency-free SVG charts — fan, line, donut, sparkline
js/forms.js       dynamic type-driven add/edit forms, validation, smart derivation
js/views.js       Dashboard / Holdings / Asset detail / Projections renderers
js/app.js         hash router, add/edit flows, grouped type picker,
                  theme toggle, modals, toasts, boot
tests/run-tests.js unit tests for all financial math (node tests/run-tests.js)
```

## Tests

```bash
node tests/run-tests.js
```

51 assertions cover FD compounding, XIRR, EPF/PPF/RD/annuity math, NPS blended μ/σ, loan
amortization (EMI, balance, payoff date, interest remaining, EMI split), RSU/option vesting and
intrinsic value, small-savings maturity math, and net-worth-with-liabilities invariants
(including the linked home-loan no-double-count rule).

## Notes

- Prices/NAVs are a **deterministic simulation** so the app is fully self-contained; `js/market.js` is the single integration point for real feeds (AMFI NAVs, exchange LTPs, metal spot, crypto, FX).
- Projections aggregate per-asset bands (p10/p50/p90 summed) into the portfolio fan.
- Light + dark themes (Settings → Appearance); charts re-tint from CSS tokens. Mobile gets a bottom tab bar.
- "Reset demo data" (Settings → Data) restores the sample portfolio.
