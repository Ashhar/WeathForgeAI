# WealthForge AI

Track, grow and project your whole net worth — every asset you *already own* in one place:
equity, mutual funds, fixed deposits, gold & silver, real estate, crypto and everything else.

**Zero build step.** Vanilla HTML/CSS/JS single-page app. Open `index.html` (or serve the folder)
and it runs, seeded with a demo portfolio persisted to `localStorage`.

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

## Screens & navigation

| Route | Screen |
|---|---|
| `#/dashboard` | Net worth hero, day change, allocation donut, 10-year outlook, asset-class cards, movers & best performers |
| `#/holdings/:type` | Holdings tabs (Equity / Mutual Funds / FDs / Gold & Silver / Real Estate / Crypto / Others) with type-specific columns; new/edited rows highlight |
| `#/asset/:id` | Asset detail — current value, invested, absolute + annualized return (XIRR/CAGR), mode-appropriate chart, 10-year projection, full facts, edit/delete |
| `#/add` → `#/add/:type` | Add flow — step 1 type picker, then a dynamic type-driven form |
| `#/edit/:id` | Same form, pre-filled (revalue a property, mark an FD matured, update after a fresh buy) |
| `#/projections/:years?` | Whole-portfolio fan (1/3/5/10/20y horizons) + per-asset projection table |

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

**Shared:** label/nickname, acquisition date, tags/notes, single/joint ownership with share % (net worth counts your share only), currency + FX note. **Quick path** (quantity + avg cost + date) is the default; identity/advanced fields sit behind "Add more details" expanders; lots support **CSV paste**; "Import statement" affordance is stubbed per type.

## Code map

```
index.html        app shell + sidebar navigation
styles.css        design system (dark fintech theme, gold brand accent)
js/market.js      mock market service — stocks, MF NAVs, coins, metal rates, FX,
                  deterministic simulated price histories (swap for real APIs)
js/finance.js     FD compounding, CAGR, XIRR (Newton + bisection), lognormal
                  Monte Carlo bands, deterministic/contractual curves, ₹ formatting
js/store.js       asset model, per-type valuation dispatcher, projections,
                  portfolio aggregation, localStorage persistence, demo seed
js/charts.js      dependency-free SVG charts — fan, line, donut, sparkline
js/forms.js       dynamic type-driven add/edit forms, validation, smart derivation
js/views.js       Dashboard / Holdings / Asset detail / Projections renderers
js/app.js         hash router, add-edit flow, modals, toasts, boot
```

## Notes

- Prices/NAVs are a **deterministic simulation** so the app is fully self-contained; `js/market.js` is the single integration point for real feeds (AMFI NAVs, exchange LTPs, metal spot, crypto, FX).
- Projections aggregate per-asset bands (p10/p50/p90 summed) into the portfolio fan.
- "Reset demo data" in the sidebar restores the sample portfolio.
