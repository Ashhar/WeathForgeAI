# Phase 3: Differentiation (4-7 months)

## Context

You are working on **WealthForge AI** — a single-page app (SPA) for tracking net worth across 12+ asset classes and liabilities, with projections, goals tracking, and AI-powered insights. Built with vanilla HTML/CSS/JS (no framework) on Vite, with optional Supabase cloud persistence.

### What's Already Built (Phases 1-2 completed)
- PWA with service worker, installable, push notifications
- 2FA/MFA with TOTP via Supabase
- Session management with idle timeout and device tracking
- AI import via Edge Function (Gemini key server-side)
- Onboarding wizard for new users
- CAS PDF dedicated parser for instant MF import
- Privacy mode (blur amounts)
- CSP headers, audit log
- **Conversational AI assistant** (chat panel with function-calling)
- **AI-generated personalized insights** (cached, refreshed daily)
- **Natural language data entry** ("bought 100 Infosys at 1450")
- **Capital gains computation** (LTCG/STCG per Indian tax law)
- **Tax-loss harvesting suggestions**
- **80C/80D utilization tracker**
- **Tax planning assistant** (AI-powered)
- **Monthly AI digest** (narrative portfolio summary)
- **Financial calculators** (retirement, prepayment advisor, emergency fund)

### Architecture Recap
- **Client:** Vanilla JS modules in `js/`, Vite bundled
- **Data:** `js/store.js` → localStorage (local) or Supabase (cloud)
- **AI:** All LLM calls via Supabase Edge Functions (Gemini or Anthropic)
- **Auth:** Supabase Auth with MFA
- **Finance:** `js/finance.js` (XIRR, Monte Carlo, amortization, FD, PPF, EPF, NPS)
- **Tax:** `js/tax.js` (capital gains, 80C, tax rules)
- **Chat:** `js/ai-chat.js` (slide-out panel with history)
- **Routes:** `/dashboard`, `/holdings/:type`, `/asset/:id`, `/projections`, `/goals`, `/tax`, `/tools`, `/chat`, `/settings`, `/account`

---

## Feature 1: What-If Scenario Planner

### Goal
Let users model hypothetical changes to their portfolio and see the projected impact on net worth, goals, and allocation — without actually making changes.

### Implementation

#### 1.1 Route & UI (new route: `/scenarios`)

```
/scenarios
├── Scenario library (saved scenarios)
├── [+ New Scenario] button
└── Active scenario editor
```

#### 1.2 Scenario Engine (`js/scenarios.js`)

```js
// A scenario is a set of hypothetical changes applied on top of the real portfolio
const SCENARIO_ACTIONS = {
  ADD_ASSET: 'add_asset',
  REMOVE_ASSET: 'remove_asset',
  MODIFY_ASSET: 'modify_asset',
  ADD_LIABILITY: 'add_liability',
  REMOVE_LIABILITY: 'remove_liability',
  MARKET_CHANGE: 'market_change',      // e.g., equity drops 20%
  INCOME_CHANGE: 'income_change',      // e.g., salary hike → higher SIPs
  SIP_CHANGE: 'sip_change',           // increase/decrease/stop SIP
  LUMPSUM_INVEST: 'lumpsum_invest',
  PREPAY_LOAN: 'prepay_loan',
  LIFE_EVENT: 'life_event'            // buy house, child education, etc.
};

// Scenario data model
class Scenario {
  constructor(name, description) {
    this.id = crypto.randomUUID();
    this.name = name;
    this.description = description;
    this.actions = []; // ordered list of changes
    this.createdAt = new Date().toISOString();
  }

  addAction(type, params) {
    this.actions.push({ type, params, id: crypto.randomUUID() });
  }

  // Apply scenario to a copy of the portfolio and compute projections
  apply(portfolio) {
    const modified = structuredClone(portfolio);

    for (const action of this.actions) {
      switch (action.type) {
        case 'ADD_ASSET':
          modified.assets.push(createAssetFromParams(action.params));
          break;
        case 'REMOVE_ASSET':
          modified.assets = modified.assets.filter(a => a.id !== action.params.assetId);
          break;
        case 'MARKET_CHANGE':
          applyMarketChange(modified, action.params);
          break;
        case 'PREPAY_LOAN':
          applyPrepayment(modified, action.params);
          break;
        case 'SIP_CHANGE':
          applySIPChange(modified, action.params);
          break;
        case 'LIFE_EVENT':
          applyLifeEvent(modified, action.params);
          break;
        // ... other actions
      }
    }

    return modified;
  }
}

function applyMarketChange(portfolio, params) {
  // params: { assetType: 'equity', changePct: -20 }
  portfolio.assets
    .filter(a => a.type === params.assetType || params.assetType === 'all')
    .forEach(a => {
      const currentVal = valuate(a).currentValue;
      a._scenarioValue = currentVal * (1 + params.changePct / 100);
    });
}

function applyLifeEvent(portfolio, params) {
  // params: { event: 'buy_house', cost: 10000000, downPayment: 2000000, loanAmount: 8000000, loanRate: 8.5, loanTenure: 240 }
  switch (params.event) {
    case 'buy_house':
      // Add real estate asset
      portfolio.assets.push({
        type: 'realestate', name: 'New Property',
        data: { currentValue: params.cost, purchasePrice: params.cost }
      });
      // Add home loan liability
      portfolio.liabilities.push({
        type: 'homeloan', name: 'Home Loan',
        data: { principal: params.loanAmount, rate: params.loanRate, tenureMonths: params.loanTenure }
      });
      // Reduce liquid assets by down payment
      deductFromLiquid(portfolio, params.downPayment);
      break;
    case 'child_education':
      deductFromLiquid(portfolio, params.cost);
      break;
    case 'salary_hike':
      // Increase all SIPs proportionally
      const factor = 1 + params.hikePct / 100;
      portfolio.assets.filter(a => a.data.sipAmount).forEach(a => {
        a.data.sipAmount = Math.round(a.data.sipAmount * factor);
      });
      break;
  }
}
```

#### 1.3 Scenario Comparison View

Show side-by-side:
```
┌─────────────────────┬─────────────────────┐
│   Current Reality    │   With Scenario     │
├─────────────────────┼─────────────────────┤
│ Net Worth: ₹95.1L   │ Net Worth: ₹88.3L   │
│ Assets: ₹1.25Cr     │ Assets: ₹1.45Cr     │
│ Liabilities: ₹30L   │ Liabilities: ₹1.10Cr│
│ Equity: 42%         │ Equity: 28%         │
│ Debt: 25%           │ Real Estate: 45%    │
│                     │                     │
│ [10-year projection fan chart - overlay]  │
│ Blue line: current path                   │
│ Orange line: scenario path                │
│                     │                     │
│ Goal Impact:                              │
│ Retirement 2035: On track → Delayed 2yr   │
│ House Fund: 67% → Achieved ✓             │
└─────────────────────┴─────────────────────┘
```

#### 1.4 Pre-built Scenario Templates

```js
const SCENARIO_TEMPLATES = [
  {
    name: 'Market Crash (-20%)',
    description: 'What if equity markets correct 20%?',
    actions: [{ type: 'MARKET_CHANGE', params: { assetType: 'equity', changePct: -20 } },
              { type: 'MARKET_CHANGE', params: { assetType: 'mf', changePct: -15 } }]
  },
  {
    name: 'Buy a House',
    description: 'Model buying a property with a home loan',
    actions: [{ type: 'LIFE_EVENT', params: { event: 'buy_house', cost: null, downPayment: null, loanAmount: null, loanRate: 8.5, loanTenure: 240 } }]
  },
  {
    name: 'Career Break (1 year)',
    description: 'Stop all SIPs, draw from liquid assets for expenses',
    actions: [{ type: 'SIP_CHANGE', params: { change: 'stop_all', duration: 12 } },
              { type: 'REMOVE_ASSET', params: { deductMonthly: true, amount: null, months: 12 } }]
  },
  {
    name: 'Salary Hike + Step-Up SIPs',
    description: 'Model a salary increase with proportional SIP increase',
    actions: [{ type: 'LIFE_EVENT', params: { event: 'salary_hike', hikePct: 20 } }]
  },
  {
    name: 'Early Retirement at 45',
    description: 'Stop contributions at 45, start drawing from corpus',
    actions: [{ type: 'LIFE_EVENT', params: { event: 'early_retirement', age: 45 } }]
  }
];
```

#### 1.5 AI Scenario Analysis

After building a scenario, send to AI for plain-English impact assessment:

```
Analyze this scenario's impact on the user's financial health:

Current state: [portfolio summary]
Scenario: "Buy a House" — ₹1.2Cr property, ₹30L down, ₹90L loan at 8.5% for 20yrs

Changes:
- Net worth drops from ₹95L to ₹88L immediately (down payment + closing costs)
- Monthly outflow increases by ₹78K (EMI) 
- Real estate now 45% of portfolio (concentration risk)
- Emergency fund covers only 3.2 months of new expenses (was 6.8)

Provide:
1. Overall verdict (safe / risky / dangerous)
2. What breaks (goals delayed, emergency fund inadequate, etc.)
3. What to do before executing (build emergency buffer, reduce other EMIs, etc.)
4. Timeline: when does this scenario converge back to the current trajectory?
```

#### 1.6 Persistence

```sql
-- supabase/migrations/0008_scenarios.sql
CREATE TABLE scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  actions JSONB NOT NULL DEFAULT '[]',
  result_cache JSONB, -- cached projection result
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own scenarios" ON scenarios FOR ALL USING (user_id = auth.uid());
```

---

## Feature 2: Family/Household View

### Goal
Support multiple portfolios (spouse, parents, children) with consolidated family net worth and individual views.

### Implementation

#### 2.1 Data Model

```sql
-- supabase/migrations/0008_family.sql (or combine with above)
CREATE TABLE family_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  relationship TEXT NOT NULL, -- 'self', 'spouse', 'parent', 'child', 'sibling', 'other'
  color TEXT, -- for chart differentiation
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add family_member_id to assets and liabilities
ALTER TABLE assets ADD COLUMN family_member_id UUID REFERENCES family_members(id) ON DELETE SET NULL;
ALTER TABLE liabilities ADD COLUMN family_member_id UUID REFERENCES family_members(id) ON DELETE SET NULL;

ALTER TABLE family_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own family" ON family_members FOR ALL USING (owner_id = auth.uid());
```

#### 2.2 Client Data Model Update (`js/store.js`)

```js
// Extended asset with optional family member
{
  id: 'uuid',
  type: 'equity',
  name: 'TCS',
  familyMemberId: 'uuid-of-spouse', // null = self
  data: { ... }
}

// Family member
{
  id: 'uuid',
  name: 'Priya',
  relationship: 'spouse',
  color: '#ec4899' // pink for charts
}
```

#### 2.3 Family Dashboard View

```js
function renderFamilyDashboard() {
  const members = store.getFamilyMembers(); // includes 'self'
  const portfolioByMember = members.map(m => ({
    member: m,
    assets: store.getAssets().filter(a => a.familyMemberId === m.id || (!a.familyMemberId && m.relationship === 'self')),
    liabilities: store.getLiabilities().filter(l => l.familyMemberId === m.id || (!l.familyMemberId && m.relationship === 'self'))
  }));

  const familyNetWorth = portfolioByMember.reduce((sum, p) => sum + netWorth(p.assets, p.liabilities), 0);

  return `
    <div class="family-dashboard">
      <div class="family-hero">
        <h2>Family Net Worth</h2>
        <span class="family-net-worth amount">${fmt(familyNetWorth)}</span>
      </div>

      <!-- Stacked bar or donut: contribution by member -->
      <div class="family-allocation-chart">
        ${renderFamilyDonut(portfolioByMember)}
      </div>

      <!-- Per-member cards -->
      <div class="family-member-grid">
        ${portfolioByMember.map(p => `
          <div class="member-card" style="border-left: 4px solid ${p.member.color}">
            <h4>${p.member.name} <small>(${p.member.relationship})</small></h4>
            <div class="member-stats">
              <span>Assets: ${fmt(totalAssets(p.assets))}</span>
              <span>Liabilities: ${fmt(totalLiabilities(p.liabilities))}</span>
              <span class="member-net-worth">Net Worth: ${fmt(netWorth(p.assets, p.liabilities))}</span>
            </div>
            <div class="member-allocation-mini">
              ${renderMiniAllocation(p.assets)}
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Combined projection fan -->
      <div class="family-projection">
        <h3>Family 10-Year Outlook</h3>
        ${renderFamilyFanChart(portfolioByMember)}
      </div>
    </div>
  `;
}
```

#### 2.4 Asset Assignment UI

When adding/editing an asset, add a "Who owns this?" selector:
```html
<label>Owner</label>
<select name="familyMemberId">
  <option value="">Myself</option>
  <option value="uuid-spouse">Priya (Spouse)</option>
  <option value="uuid-father">Ramesh (Father)</option>
</select>
```

#### 2.5 Family Member Management (in `/settings`)

```
Family Members
─────────────
You (Self)                    [default, can't remove]
Priya (Spouse)    🟣          [Edit] [Remove]
Ramesh (Father)   🟢          [Edit] [Remove]

[+ Add Family Member]
```

#### 2.6 Filtering Across Views

All existing views (dashboard, holdings, projections) get a family member filter:
```html
<div class="family-filter">
  <button class="filter-chip active" data-member="all">Everyone</button>
  <button class="filter-chip" data-member="self">Just Me</button>
  <button class="filter-chip" data-member="uuid-spouse">Priya</button>
</div>
```

When filtered, all calculations (net worth, allocation, projections) scope to that member only.

---

## Feature 3: Rebalancing Alerts & Model Portfolios

### Goal
Let users define target allocation, detect drift, and get specific trade suggestions to rebalance.

### Implementation

#### 3.1 Target Allocation Model

```js
// Stored in user profile or separate table
const targetAllocation = {
  equity: 40,      // %
  mf: 25,
  fd: 15,
  ppf_epf: 10,
  gold: 5,
  crypto: 3,
  other: 2
};
```

#### 3.2 Migration

```sql
-- Add target allocation to profiles
ALTER TABLE profiles ADD COLUMN target_allocation JSONB DEFAULT NULL;
-- Example: {"equity": 40, "mf": 25, "fd": 15, "ppf_epf": 10, "gold": 5, "crypto": 3, "other": 2}
```

#### 3.3 Drift Detection (`js/rebalance.js`)

```js
export function calculateDrift(currentAllocation, targetAllocation) {
  const drift = {};
  let totalDrift = 0;

  for (const [type, target] of Object.entries(targetAllocation)) {
    const current = (currentAllocation[type] || 0) * 100; // convert to %
    const diff = current - target;
    drift[type] = {
      target,
      current: current.toFixed(1),
      diff: diff.toFixed(1),
      overweight: diff > 0,
      significant: Math.abs(diff) > 3 // >3% drift is significant
    };
    totalDrift += Math.abs(diff);
  }

  return {
    drift,
    totalDrift: totalDrift.toFixed(1),
    needsRebalance: totalDrift > 10, // total drift > 10% = rebalance needed
    lastRebalanced: null // track from snapshots
  };
}

export function suggestRebalanceTrades(assets, currentAllocation, targetAllocation, totalPortfolioValue) {
  const trades = [];

  for (const [type, target] of Object.entries(targetAllocation)) {
    const current = (currentAllocation[type] || 0) * 100;
    const diff = current - target;
    const amountDiff = (diff / 100) * totalPortfolioValue;

    if (Math.abs(diff) < 2) continue; // ignore tiny drifts

    if (diff > 0) {
      // Overweight — suggest selling
      trades.push({
        action: 'SELL',
        type,
        amount: Math.abs(amountDiff),
        reason: `${type} is ${diff.toFixed(1)}% overweight`,
        suggestion: `Reduce ${type} by ~${fmt(Math.abs(amountDiff))}`
      });
    } else {
      // Underweight — suggest buying
      trades.push({
        action: 'BUY',
        type,
        amount: Math.abs(amountDiff),
        reason: `${type} is ${Math.abs(diff).toFixed(1)}% underweight`,
        suggestion: `Add ~${fmt(Math.abs(amountDiff))} to ${type}`
      });
    }
  }

  return trades.sort((a, b) => b.amount - a.amount);
}
```

#### 3.4 Model Portfolio Templates

```js
const MODEL_PORTFOLIOS = [
  {
    name: 'Aggressive Growth (Age 25-35)',
    allocation: { equity: 50, mf: 20, crypto: 5, gold: 5, ppf_epf: 15, fd: 5 }
  },
  {
    name: 'Balanced (Age 35-45)',
    allocation: { equity: 35, mf: 25, gold: 5, ppf_epf: 15, fd: 15, realestate: 5 }
  },
  {
    name: 'Conservative (Age 45-55)',
    allocation: { equity: 20, mf: 20, gold: 10, ppf_epf: 20, fd: 25, other: 5 }
  },
  {
    name: 'Retirement Income (Age 55+)',
    allocation: { equity: 10, mf: 15, gold: 10, ppf_epf: 25, fd: 35, other: 5 }
  },
  {
    name: 'Custom',
    allocation: null // user defines
  }
];
```

#### 3.5 Rebalancing UI (in `/settings` or dedicated `/rebalance` route)

```
Current vs Target Allocation
─────────────────────────────

                Current    Target    Drift
Equity          44.2%      40.0%    +4.2% ⚠️
Mutual Funds    23.1%      25.0%    -1.9%
Fixed Deposits  12.8%      15.0%    -2.2%
PPF/EPF         11.5%      10.0%    +1.5%
Gold             4.1%       5.0%    -0.9%
Crypto           3.8%       3.0%    +0.8%
Other            0.5%       2.0%    -1.5%

Total Drift: 13.0% — Rebalance recommended

Suggested Trades:
━━━━━━━━━━━━━━━━
🔴 SELL ₹4.9L of Equity (reduce to 40%)
🟢 BUY  ₹2.6L of Fixed Deposits (increase to 15%)
🟢 BUY  ₹1.8L of Mutual Funds (increase to 25%)
🟢 BUY  ₹1.0L of Gold (increase to 5%)

[🤖 AI: Analyze tax impact of rebalancing]
```

#### 3.6 Drift Alert (proactive)

In `js/insights.js` or AI insights, check drift daily:
```js
function checkRebalanceAlert() {
  const target = store.getProfile().targetAllocation;
  if (!target) return null;

  const current = store.getPortfolio().allocation;
  const { needsRebalance, totalDrift } = calculateDrift(current, target);

  if (needsRebalance) {
    return {
      severity: 'medium',
      title: `Portfolio drift: ${totalDrift}% from target`,
      body: `Your allocation has drifted significantly. Consider rebalancing.`,
      action: 'View rebalance suggestions →',
      route: '/rebalance'
    };
  }
}
```

---

## Feature 4: Multi-Currency Support

### Goal
Support assets denominated in multiple currencies (USD, SGD, AED, GBP, EUR, etc.) with real-time FX conversion to the user's base currency.

### Implementation

#### 4.1 Currency Configuration

```js
const SUPPORTED_CURRENCIES = {
  INR: { symbol: '₹', name: 'Indian Rupee', locale: 'en-IN' },
  USD: { symbol: '$', name: 'US Dollar', locale: 'en-US' },
  EUR: { symbol: '€', name: 'Euro', locale: 'en-IE' },
  GBP: { symbol: '£', name: 'British Pound', locale: 'en-GB' },
  SGD: { symbol: 'S$', name: 'Singapore Dollar', locale: 'en-SG' },
  AED: { symbol: 'د.إ', name: 'UAE Dirham', locale: 'ar-AE' },
  JPY: { symbol: '¥', name: 'Japanese Yen', locale: 'ja-JP' },
  AUD: { symbol: 'A$', name: 'Australian Dollar', locale: 'en-AU' },
  CAD: { symbol: 'C$', name: 'Canadian Dollar', locale: 'en-CA' }
};
```

#### 4.2 Asset Currency Field

Add `currency` to the asset data model:
```js
{
  id: 'uuid',
  type: 'equity',
  name: 'Apple Inc',
  currency: 'USD', // NEW — defaults to user's base currency if omitted
  data: { ticker: 'AAPL', units: 10, avgCost: 150 }
}
```

#### 4.3 FX Rate Service

```js
// js/fx.js (new file)

const FX_CACHE = {}; // { 'USD/INR': { rate: 83.5, timestamp: ... } }
const FX_CACHE_TTL = 3600000; // 1 hour

export async function getFXRate(from, to) {
  if (from === to) return 1;

  const key = `${from}/${to}`;
  const cached = FX_CACHE[key];
  if (cached && Date.now() - cached.timestamp < FX_CACHE_TTL) return cached.rate;

  // Try Supabase market_rates table first
  if (supabase) {
    const { data } = await supabase.from('market_rates')
      .select('rate')
      .eq('pair', key)
      .single();
    if (data) {
      FX_CACHE[key] = { rate: data.rate, timestamp: Date.now() };
      return data.rate;
    }
  }

  // Fallback: fetch from free API
  // (or use stored rates from daily sync)
  return getFallbackFXRate(from, to);
}

export function convertToBase(amount, assetCurrency, baseCurrency) {
  const rate = FX_CACHE[`${assetCurrency}/${baseCurrency}`]?.rate || 1;
  return amount * rate;
}
```

#### 4.4 FX Rate Sync (extend `market_rates` table)

```sql
-- Add FX pairs to market_rates or create dedicated table
INSERT INTO market_rates (symbol, rate, updated_at) VALUES
  ('USD/INR', 83.50, now()),
  ('EUR/INR', 91.20, now()),
  ('GBP/INR', 106.30, now()),
  ('SGD/INR', 62.10, now()),
  ('AED/INR', 22.73, now());
```

Add to the daily sync script (`scripts/sync-masters.mjs`) to fetch FX rates from a free API (ExchangeRate-API, Open Exchange Rates, or ECB reference rates).

#### 4.5 Display Logic

```js
function formatAmount(amount, currency = null, baseCurrency = 'INR') {
  const displayCurrency = currency || baseCurrency;

  if (displayCurrency === baseCurrency) {
    return formatIndian(amount); // existing INR formatter
  }

  // Show in original currency + base equivalent
  const config = SUPPORTED_CURRENCIES[displayCurrency];
  const formatted = new Intl.NumberFormat(config.locale, {
    style: 'currency',
    currency: displayCurrency,
    maximumFractionDigits: 0
  }).format(amount);

  const baseEquiv = convertToBase(amount, displayCurrency, baseCurrency);
  return `${formatted} <small>(${formatIndian(baseEquiv)})</small>`;
}
```

#### 4.6 Portfolio Aggregation Update

In `js/store.js`, the portfolio aggregator must convert all assets to base currency before summing:

```js
function getPortfolioValue() {
  const baseCurrency = getProfile().currency || 'INR';
  let total = 0;

  for (const asset of assets) {
    const value = valuate(asset).currentValue;
    const currency = asset.currency || baseCurrency;
    total += convertToBase(value, currency, baseCurrency);
  }

  return total;
}
```

#### 4.7 UI: Currency Selector on Forms

In add/edit forms, add currency dropdown (default to base, allow override):
```html
<label>Currency</label>
<select name="currency">
  <option value="INR" selected>₹ INR</option>
  <option value="USD">$ USD</option>
  <option value="EUR">€ EUR</option>
  <!-- etc -->
</select>
```

Only show for asset types where multi-currency makes sense (equity, crypto, FDs). Don't show for PPF/EPF/NPS (always INR).

---

## Feature 5: Document Vault

### Goal
Let users attach documents (PDFs, images) to assets — property deeds, insurance policies, FD receipts, account statements — for safekeeping and estate planning.

### Implementation

#### 5.1 Storage

Use Supabase Storage (object storage with RLS):

```sql
-- Create bucket for user documents
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false);

-- RLS: users can only access their own folder
CREATE POLICY "Users access own documents"
ON storage.objects FOR ALL
USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text);
```

#### 5.2 Document Metadata Table

```sql
-- supabase/migrations/0008_documents.sql
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
  liability_id UUID REFERENCES liabilities(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL, -- storage path
  file_type TEXT, -- mime type
  file_size INTEGER, -- bytes
  category TEXT, -- 'deed', 'policy', 'receipt', 'statement', 'certificate', 'other'
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own documents" ON documents FOR ALL USING (user_id = auth.uid());
```

#### 5.3 Upload UI (`js/documents.js`)

```js
async function uploadDocument(file, assetId, category) {
  const user = (await supabase.auth.getUser()).data.user;
  const path = `${user.id}/${crypto.randomUUID()}-${file.name}`;

  // Upload to storage
  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(path, file, { contentType: file.type });

  if (uploadError) throw uploadError;

  // Save metadata
  const { error: metaError } = await supabase.from('documents').insert({
    user_id: user.id,
    asset_id: assetId,
    name: file.name,
    file_path: path,
    file_type: file.type,
    file_size: file.size,
    category
  });

  if (metaError) throw metaError;
  showToast('Document uploaded successfully', 'success');
}
```

#### 5.4 Asset Detail Page Enhancement

On the asset detail page (`/asset/:id`), add a "Documents" section:

```
Documents (2)
─────────────
📄 Property Registration Deed.pdf   [deed]     2.3 MB   [View] [Delete]
🖼️ Agreement Photo.jpg              [receipt]  450 KB   [View] [Delete]

[+ Upload Document]

Upload accepts: PDF, JPG, PNG, HEIC (max 10MB per file, 100MB total per user)
```

#### 5.5 Document Categories

```js
const DOCUMENT_CATEGORIES = [
  { key: 'deed', label: 'Property Deed / Title', icon: '🏠' },
  { key: 'policy', label: 'Insurance Policy', icon: '🛡️' },
  { key: 'receipt', label: 'Receipt / Certificate', icon: '🧾' },
  { key: 'statement', label: 'Account Statement', icon: '📊' },
  { key: 'certificate', label: 'Share Certificate', icon: '📜' },
  { key: 'agreement', label: 'Loan Agreement', icon: '📝' },
  { key: 'nomination', label: 'Nomination Form', icon: '👤' },
  { key: 'tax', label: 'Tax Document', icon: '🏛️' },
  { key: 'other', label: 'Other', icon: '📎' }
];
```

#### 5.6 Storage Limits

- Free tier: 50MB total, 5MB per file
- Pro tier: 500MB total, 25MB per file
- Track usage: `SELECT SUM(file_size) FROM documents WHERE user_id = auth.uid()`

---

## Feature 6: SIP Tracker with Step-Up Modeling

### Goal
Dedicated SIP tracking view showing active SIPs, performance per SIP, and step-up modeling.

### Implementation

#### 6.1 SIP Extraction from Assets

SIPs are already modeled in MF/equity assets via `data.sipAmount` and `data.sipStartDate`. Extract and aggregate:

```js
function getActiveSIPs() {
  return store.getAssets()
    .filter(a => a.data.sipAmount && a.data.sipAmount > 0)
    .map(a => ({
      asset: a,
      amount: a.data.sipAmount,
      startDate: a.data.sipStartDate,
      frequency: a.data.sipFrequency || 'monthly',
      totalInvested: calculateTotalSIPInvested(a),
      currentValue: valuate(a).currentValue,
      xirr: calculateXIRR(a),
      monthsActive: monthsBetween(a.data.sipStartDate, new Date())
    }));
}
```

#### 6.2 SIP Dashboard (sub-route of holdings or dedicated `/sips`)

```
Active SIPs (Monthly Total: ₹45,000)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

| Fund Name              | SIP Amount | Since    | Invested | Current | XIRR   |
|------------------------|-----------|----------|----------|---------|--------|
| Axis Bluechip Fund     | ₹15,000   | Jan 2022 | ₹2.85L   | ₹3.42L  | 14.2%  |
| Parag Parikh Flexicap  | ₹10,000   | Mar 2021 | ₹3.40L   | ₹4.15L  | 16.8%  |
| Nippon India Small Cap | ₹10,000   | Jun 2023 | ₹1.50L   | ₹1.72L  | 22.1%  |
| HDFC Mid Cap Opp       | ₹10,000   | Jan 2024 | ₹0.80L   | ₹0.89L  | 18.5%  |

Total Invested: ₹8.55L → Current: ₹10.18L (+₹1.63L, XIRR 16.1%)
```

#### 6.3 Step-Up Modeler

```js
function modelSIPStepUp(currentSIP, stepUpPct, years, expectedReturn) {
  const results = [];
  let annualSIP = currentSIP * 12;
  let corpus = 0;
  const monthlyReturn = expectedReturn / 100 / 12;

  for (let year = 1; year <= years; year++) {
    const monthlySIP = annualSIP / 12;
    // Each month's SIP compounds for remaining months
    for (let m = 0; m < 12; m++) {
      corpus = (corpus + monthlySIP) * (1 + monthlyReturn);
    }
    results.push({
      year,
      annualSIP,
      monthlySIP: annualSIP / 12,
      totalInvested: results.reduce((s, r) => s + r.annualSIP, 0) + annualSIP,
      corpus: Math.round(corpus)
    });
    annualSIP *= (1 + stepUpPct / 100); // step up next year
  }

  return results;
}
```

#### 6.4 Step-Up UI

```
SIP Step-Up Planner
━━━━━━━━━━━━━━━━━━

Current monthly SIP: ₹45,000
Annual step-up:      [10]% ← slider (5%, 10%, 15%, 20%)
Expected return:     [12]% ← slider (8%, 10%, 12%, 15%)
Time horizon:        [20] years ← slider

Results:
┌──────┬────────────┬───────────┬────────────┐
│ Year │ Monthly SIP│ Invested  │ Corpus     │
├──────┼────────────┼───────────┼────────────┤
│  5   │ ₹65,612    │ ₹33.3L    │ ₹44.8L     │
│ 10   │ ₹1,05,623  │ ₹90.6L    │ ₹1.63Cr    │
│ 15   │ ₹1,70,131  │ ₹1.90Cr   │ ₹4.52Cr    │
│ 20   │ ₹2,74,048  │ ₹3.63Cr   │ ₹10.8Cr    │
└──────┴────────────┴───────────┴────────────┘

Without step-up (flat ₹45K): ₹4.49Cr in 20 years
With 10% step-up:             ₹10.8Cr in 20 years (+₹6.31Cr)

[Chart: two growth curves overlaid — flat vs step-up]
```

---

## Feature 7: Expense Ratio Optimizer

### Goal
For mutual fund holdings, identify expensive regular plans and suggest cheaper direct plan alternatives using the existing `mf_master` data.

### Implementation

#### 7.1 Expense Ratio Lookup

The `mf_master` table already has scheme data. Add expense ratio to the sync:

```sql
ALTER TABLE mf_master ADD COLUMN IF NOT EXISTS expense_ratio DECIMAL(5,2);
ALTER TABLE mf_master ADD COLUMN IF NOT EXISTS plan_type TEXT; -- 'Direct' or 'Regular'
ALTER TABLE mf_master ADD COLUMN IF NOT EXISTS direct_scheme_code TEXT; -- link to direct equivalent
```

#### 7.2 Optimizer Logic (`js/expense-optimizer.js`)

```js
export function findCheaperAlternatives(mfAssets, mfMaster) {
  const suggestions = [];

  for (const asset of mfAssets) {
    const scheme = mfMaster.find(s => s.code === asset.data.amfiCode);
    if (!scheme || scheme.plan_type === 'Direct') continue; // already direct

    // Find direct plan equivalent
    const directEquivalent = mfMaster.find(s =>
      s.amc === scheme.amc &&
      s.scheme_name_base === scheme.scheme_name_base &&
      s.plan_type === 'Direct'
    );

    if (!directEquivalent) continue;

    const expenseGap = scheme.expense_ratio - directEquivalent.expense_ratio;
    if (expenseGap < 0.1) continue; // insignificant

    const currentValue = valuate(asset).currentValue;
    const yearlySaving = currentValue * (expenseGap / 100);
    const tenYearSaving = projectedSavings(currentValue, expenseGap, asset.data.sipAmount, 10);

    suggestions.push({
      asset,
      currentScheme: scheme,
      directScheme: directEquivalent,
      expenseRatioCurrent: scheme.expense_ratio,
      expenseRatioDirect: directEquivalent.expense_ratio,
      expenseGap,
      currentValue,
      yearlySaving,
      tenYearSaving,
      recommendation: `Switch to ${directEquivalent.scheme_name} (Direct). Save ₹${fmt(yearlySaving)}/year, ₹${fmt(tenYearSaving)} over 10 years.`
    });
  }

  return suggestions.sort((a, b) => b.tenYearSaving - a.tenYearSaving);
}

function projectedSavings(currentValue, expenseGapPct, sipAmount, years) {
  // Model savings from lower expense over time (including SIP additions)
  let savings = 0;
  let value = currentValue;
  const monthlyGap = expenseGapPct / 100 / 12;

  for (let m = 0; m < years * 12; m++) {
    value += (sipAmount || 0);
    savings += value * monthlyGap;
    value *= 1.01; // assume ~12% annual growth
  }
  return Math.round(savings);
}
```

#### 7.3 Optimizer UI (accessible from holdings → MF tab)

```
💡 Expense Ratio Optimizer
━━━━━━━━━━━━━━━━━━━━━━━━━

You hold 2 Regular plans. Switching to Direct saves money:

┌────────────────────────┬────────┬────────┬──────────┬───────────┐
│ Fund                   │ Regular│ Direct │ Gap      │ 10yr Save │
├────────────────────────┼────────┼────────┼──────────┼───────────┤
│ HDFC Mid Cap Opp       │ 1.62%  │ 0.75%  │ 0.87%   │ ₹1.24L    │
│ Axis Bluechip          │ 1.48%  │ 0.55%  │ 0.93%   │ ₹89K      │
└────────────────────────┴────────┴────────┴──────────┴───────────┘

Total 10-year savings: ₹2.13L by switching to Direct plans.

How to switch:
1. Redeem existing Regular plan units (may trigger STCG if < 1 year)
2. Invest in the Direct plan via the AMC website or a direct platform
3. Note: Existing SIPs must be cancelled and recreated in Direct

[🤖 AI: Check tax impact before switching]
```

---

## Acceptance Criteria

- [ ] Scenario planner creates, saves, and applies hypothetical changes
- [ ] Scenario comparison shows side-by-side projections (current vs scenario)
- [ ] Pre-built templates (market crash, buy house, career break) work
- [ ] Family members can be added/removed, assets assigned to members
- [ ] Family dashboard shows consolidated + per-member net worth
- [ ] All existing views respect the family member filter
- [ ] Target allocation can be set (model portfolios or custom)
- [ ] Drift is calculated and displayed with visual indicators
- [ ] Rebalance trades are suggested with amounts
- [ ] Assets can be denominated in non-INR currencies
- [ ] FX rates sync daily and convert correctly
- [ ] Portfolio totals convert all currencies to base before summing
- [ ] Documents can be uploaded (PDF/image), attached to assets, viewed, deleted
- [ ] Storage limits are enforced (50MB free, 500MB pro)
- [ ] SIP tracker shows all active SIPs with XIRR
- [ ] Step-up modeler produces correct projections with interactive sliders
- [ ] Expense ratio optimizer identifies Regular → Direct switch opportunities
- [ ] All existing features + Phase 1-2 features still work
- [ ] Tests pass (`npm test`)

---

## Files to Create/Modify

### New Files
- `js/scenarios.js` — Scenario engine and UI
- `js/family.js` — Family member management and views
- `js/rebalance.js` — Drift calculation, target allocation, trade suggestions
- `js/fx.js` — FX rate service and conversion
- `js/documents.js` — Document vault upload/view/delete
- `js/sip-tracker.js` — SIP dashboard and step-up modeler
- `js/expense-optimizer.js` — MF expense ratio analysis
- `supabase/migrations/0008_phase3.sql` — scenarios, family_members, documents, FX rates, target allocation

### Modified Files
- `js/app.js` — Register new routes (`/scenarios`, `/family`, `/rebalance`, `/sips`, `/documents`)
- `js/router.js` — Add new routes
- `js/store.js` — Add `currency` field to assets, family member filtering, FX conversion in aggregation
- `js/views.js` — Family filter bar on all views, SIP tab, scenario comparison view
- `js/forms.js` — Currency selector on add/edit, family member selector
- `js/finance.js` — Step-up SIP calculation
- `js/cloud.js` — Sync family members, scenarios, documents
- `js/market.js` — FX rate fetching and caching
- `styles.css` — Scenario comparison layout, family cards, rebalance table, document grid, SIP step-up chart
- `index.html` — Add nav items for new routes
