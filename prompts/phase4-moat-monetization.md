# Phase 4: Moat & Monetization (7-12 months)

## Context

You are working on **WealthForge AI** — a single-page app (SPA) for tracking net worth across 12+ asset classes and liabilities, with projections, goals tracking, and AI-powered insights. Built with vanilla HTML/CSS/JS (no framework) on Vite, with optional Supabase cloud persistence.

### What's Already Built (Phases 1-3 completed)

**Phase 1 (Foundation):**
- PWA with service worker, installable, push notifications
- 2FA/MFA with TOTP, session management, idle timeout
- AI calls via Edge Function (Gemini key server-side)
- Onboarding wizard, CAS PDF parser, privacy mode
- CSP headers, audit log, device management

**Phase 2 (AI Core):**
- Conversational AI assistant (chat panel with function-calling)
- AI-generated personalized insights (replaces rule-based)
- Natural language data entry
- Capital gains computation (LTCG/STCG)
- Tax-loss harvesting, 80C tracker, tax planning assistant
- Monthly AI digest, financial calculators

**Phase 3 (Differentiation):**
- What-if scenario planner with templates
- Family/household view (multi-member)
- Rebalancing alerts with model portfolios
- Multi-currency support with FX conversion
- Document vault (Supabase Storage)
- SIP tracker with step-up modeling
- Expense ratio optimizer (Regular → Direct)

### Architecture at this Point
- **Client:** Vanilla JS modules in `js/`, Vite bundled, PWA
- **Data:** `js/store.js` → localStorage (local) or Supabase (cloud)
- **AI:** All LLM calls via Supabase Edge Functions
- **Auth:** Supabase Auth with MFA, session management
- **Storage:** Supabase Storage for documents
- **Finance:** `js/finance.js` + `js/tax.js` + `js/rebalance.js`
- **Routes:** Dashboard, Holdings, Liabilities, Projections, Goals, Tax, Tools, Scenarios, Family, Rebalance, SIPs, Chat, Settings, Account

---

## Feature 1: Estate / Beneficiary Planning

### Goal
Let users designate beneficiaries per asset, create a "digital will" view, and optionally set up inactivity-triggered sharing (dead man's switch).

### Implementation

#### 1.1 Beneficiary Data Model

```sql
-- supabase/migrations/0009_estate.sql

CREATE TABLE beneficiaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  relationship TEXT NOT NULL, -- 'spouse', 'child', 'parent', 'sibling', 'other'
  email TEXT, -- for notifications
  phone TEXT,
  pan TEXT, -- for tax continuity
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE asset_nominations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
  liability_id UUID REFERENCES liabilities(id) ON DELETE CASCADE,
  beneficiary_id UUID REFERENCES beneficiaries(id) ON DELETE CASCADE NOT NULL,
  share_pct DECIMAL(5,2) NOT NULL DEFAULT 100, -- percentage share
  notes TEXT,
  CONSTRAINT valid_target CHECK (asset_id IS NOT NULL OR liability_id IS NOT NULL)
);

CREATE TABLE estate_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  inactivity_days INTEGER DEFAULT 90, -- days before triggering
  notify_emails TEXT[], -- who to notify
  enabled BOOLEAN DEFAULT false,
  last_activity_at TIMESTAMPTZ DEFAULT now(),
  emergency_message TEXT -- custom message to beneficiaries
);

ALTER TABLE beneficiaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_nominations ENABLE ROW LEVEL SECURITY;
ALTER TABLE estate_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own beneficiaries" ON beneficiaries FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Users manage own nominations" ON asset_nominations FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Users manage own estate settings" ON estate_settings FOR ALL USING (user_id = auth.uid());
```

#### 1.2 Estate Planning View (route: `/estate`)

```js
function renderEstatePlan() {
  const beneficiaries = store.getBeneficiaries();
  const nominations = store.getNominations();
  const settings = store.getEstateSettings();
  const assets = store.getAssets();
  const liabilities = store.getLiabilities();

  // Calculate total estate value per beneficiary
  const distribution = calculateDistribution(assets, liabilities, nominations, beneficiaries);

  return `
    <div class="estate-plan">
      <header class="estate-header">
        <h2>Estate Plan</h2>
        <p class="estate-subtitle">Ensure your wealth reaches the right people</p>
      </header>

      <!-- Estate summary -->
      <div class="estate-summary-cards">
        <div class="stat-card">
          <label>Total Estate Value</label>
          <span class="amount">${fmt(totalEstateValue)}</span>
        </div>
        <div class="stat-card">
          <label>Nominated</label>
          <span class="amount">${fmt(totalNominated)}</span>
          <small>${nominatedPct}% of assets have nominees</small>
        </div>
        <div class="stat-card ${unNominatedCount > 0 ? 'warning' : ''}">
          <label>Without Nominee</label>
          <span>${unNominatedCount} assets</span>
        </div>
      </div>

      <!-- Distribution by beneficiary -->
      <section class="estate-distribution">
        <h3>Distribution Overview</h3>
        ${distribution.map(d => `
          <div class="beneficiary-card">
            <div class="beneficiary-header">
              <strong>${d.beneficiary.name}</strong>
              <span class="relationship-badge">${d.beneficiary.relationship}</span>
              <span class="beneficiary-total amount">${fmt(d.totalValue)}</span>
            </div>
            <div class="beneficiary-assets">
              ${d.assets.map(a => `
                <div class="nominated-asset">
                  <span>${a.name}</span>
                  <span>${a.sharePct}%</span>
                  <span class="amount">${fmt(a.value * a.sharePct / 100)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </section>

      <!-- Unnominated assets warning -->
      ${unNominatedAssets.length > 0 ? `
        <section class="estate-warning">
          <h3>⚠️ Assets Without Nominees</h3>
          <p>These assets don't have designated beneficiaries:</p>
          <ul>
            ${unNominatedAssets.map(a => `<li>${a.name} (${fmt(valuate(a).currentValue)}) <button onclick="addNomination('${a.id}')">Add nominee →</button></li>`).join('')}
          </ul>
        </section>
      ` : ''}

      <!-- Inactivity trigger settings -->
      <section class="estate-inactivity">
        <h3>Inactivity Sharing</h3>
        <p>If you don't log in for ${settings.inactivityDays} days, we'll notify your designated contacts with a summary of your portfolio.</p>
        <label class="toggle">
          <input type="checkbox" ${settings.enabled ? 'checked' : ''} onchange="toggleInactivitySharing(this.checked)">
          <span>Enable inactivity sharing</span>
        </label>
        ${settings.enabled ? `
          <div class="inactivity-config">
            <label>Trigger after (days):</label>
            <input type="number" value="${settings.inactivityDays}" min="30" max="365" onchange="updateInactivityDays(this.value)">
            <label>Notify:</label>
            <div class="notify-emails">
              ${settings.notifyEmails.map(e => `<span class="email-chip">${e} <button onclick="removeNotifyEmail('${e}')">×</button></span>`).join('')}
              <input type="email" placeholder="Add email" onkeydown="if(event.key==='Enter')addNotifyEmail(this.value)">
            </div>
            <label>Message to include:</label>
            <textarea placeholder="Optional message for your beneficiaries...">${settings.emergencyMessage || ''}</textarea>
          </div>
        ` : ''}
      </section>

      <!-- Generate PDF will -->
      <section class="estate-export">
        <h3>Export Estate Document</h3>
        <p>Generate a PDF summary of your nominations for your records or legal use.</p>
        <button class="btn-primary" onclick="exportEstatePDF()">📄 Generate Estate Summary PDF</button>
      </section>
    </div>
  `;
}
```

#### 1.3 Nomination UI (on asset detail page)

Add a "Nominees" section to each asset detail:
```
Nominees
─────────
Priya (Spouse) — 70%     [Edit] [Remove]
Arjun (Child)  — 30%     [Edit] [Remove]

[+ Add Nominee]
```

Add nominee modal:
```html
<div class="modal nomination-modal">
  <h3>Add Nominee for ${assetName}</h3>
  <select name="beneficiaryId">
    <!-- existing beneficiaries -->
    <option value="new">+ New beneficiary</option>
  </select>
  <label>Share percentage</label>
  <input type="number" name="sharePct" min="1" max="100" value="100">
  <small class="remaining">Remaining: ${100 - existingShares}%</small>
  <button class="btn-primary">Save Nomination</button>
</div>
```

#### 1.4 Inactivity Monitor (Server-Side)

pg_cron job or Edge Function scheduled daily:
```sql
-- Check for inactive users with sharing enabled
CREATE OR REPLACE FUNCTION check_inactivity() RETURNS void AS $$
DECLARE
  inactive_user RECORD;
BEGIN
  FOR inactive_user IN
    SELECT es.user_id, es.notify_emails, es.emergency_message, p.display_name
    FROM estate_settings es
    JOIN profiles p ON p.id = es.user_id
    WHERE es.enabled = true
    AND es.last_activity_at < NOW() - (es.inactivity_days || ' days')::interval
    AND NOT EXISTS (SELECT 1 FROM estate_notifications WHERE user_id = es.user_id AND sent_at > NOW() - interval '7 days')
  LOOP
    -- Trigger notification (via webhook to Edge Function)
    INSERT INTO estate_notifications (user_id, notify_emails, triggered_at)
    VALUES (inactive_user.user_id, inactive_user.notify_emails, NOW());
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

#### 1.5 Activity Tracking

Update `last_activity_at` on every meaningful user action:
```js
// In cloud.js, on any write operation
async function touchActivity() {
  await supabase.from('estate_settings')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('user_id', userId);
}
```

#### 1.6 Estate PDF Export

Generate a formal PDF with:
- User's name and date
- Total estate value
- All assets with nominees and percentages
- All liabilities
- Net distributable value
- Contact information for each beneficiary
- Disclaimer: "This is an informational document, not a legal will"

---

## Feature 2: Plugin/Addon Architecture & API

### Goal
Open platform that lets power users and developers build custom views, integrations, and automations on top of WealthForge data.

### Implementation

#### 2.1 Public API (Supabase Edge Functions)

```ts
// supabase/functions/api/index.ts
// RESTful API endpoints for authenticated users

serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace('/functions/v1/api', '');
  const method = req.method;

  // Auth
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  const { user } = await verifyToken(token);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // Rate limiting (100 req/min for pro, 20 for free)
  if (await isRateLimited(user.id)) return json({ error: 'Rate limited' }, 429);

  // Route
  switch (true) {
    case path === '/portfolio' && method === 'GET':
      return getPortfolioSummary(user.id);
    case path === '/assets' && method === 'GET':
      return getAssets(user.id, url.searchParams);
    case path === '/assets' && method === 'POST':
      return createAsset(user.id, await req.json());
    case path.match(/^\/assets\/[\w-]+$/) && method === 'GET':
      return getAsset(user.id, path.split('/')[2]);
    case path.match(/^\/assets\/[\w-]+$/) && method === 'PUT':
      return updateAsset(user.id, path.split('/')[2], await req.json());
    case path.match(/^\/assets\/[\w-]+$/) && method === 'DELETE':
      return deleteAsset(user.id, path.split('/')[2]);
    case path === '/liabilities' && method === 'GET':
      return getLiabilities(user.id);
    case path === '/snapshots' && method === 'GET':
      return getSnapshots(user.id, url.searchParams);
    case path === '/goals' && method === 'GET':
      return getGoals(user.id);
    case path === '/projections' && method === 'GET':
      return getProjections(user.id, url.searchParams);
    case path === '/insights' && method === 'GET':
      return getInsights(user.id);
    case path === '/tax/gains' && method === 'GET':
      return getTaxGains(user.id);
    default:
      return json({ error: 'Not found' }, 404);
  }
});
```

#### 2.2 API Response Formats

```json
// GET /api/portfolio
{
  "netWorth": 9300000,
  "totalAssets": 12500000,
  "totalLiabilities": 3200000,
  "dayChange": 15000,
  "dayChangePct": 0.16,
  "allocation": {
    "equity": { "value": 4375000, "pct": 35.0 },
    "mf": { "value": 3125000, "pct": 25.0 },
    "fd": { "value": 1875000, "pct": 15.0 }
  },
  "currency": "INR",
  "asOf": "2026-08-13T10:30:00Z"
}

// GET /api/assets?type=equity&sort=value&order=desc
{
  "assets": [
    {
      "id": "uuid",
      "type": "equity",
      "name": "Reliance Industries",
      "currency": "INR",
      "currentValue": 1420000,
      "dayChange": 12500,
      "growth": { "xirr": 18.5, "absoluteReturn": 42.3, "holdingPeriod": "2y 3m" },
      "data": { "ticker": "RELIANCE", "exchange": "NSE", "units": 100, "avgCost": 1000 }
    }
  ],
  "total": 5,
  "page": 1
}
```

#### 2.3 API Key Management (in `/account`)

```sql
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL, -- user-given label
  key_hash TEXT NOT NULL, -- bcrypt hash of the key
  key_prefix TEXT NOT NULL, -- first 8 chars for identification
  permissions TEXT[] DEFAULT ARRAY['read'], -- 'read', 'write', 'delete'
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own API keys" ON api_keys FOR ALL USING (user_id = auth.uid());
```

UI for managing API keys:
```
API Access
──────────

Your API keys:
wf_ak_8x4f2... │ "Spreadsheet sync" │ Read only │ Last used: 2h ago │ [Revoke]
wf_ak_9m2k7... │ "Notion widget"    │ Read only │ Never used       │ [Revoke]

[+ Create API Key]

Documentation: /api/docs
Rate limit: 100 requests/minute (Pro)
```

#### 2.4 Webhook System

Let users register webhooks for events:

```sql
CREATE TABLE webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL, -- 'asset.created', 'asset.updated', 'goal.achieved', 'snapshot.created', 'alert.triggered'
  secret TEXT NOT NULL, -- for HMAC signature verification
  active BOOLEAN DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  failure_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

Webhook payload:
```json
{
  "event": "asset.updated",
  "timestamp": "2026-08-13T10:30:00Z",
  "data": {
    "assetId": "uuid",
    "name": "Reliance Industries",
    "previousValue": 1400000,
    "currentValue": 1420000,
    "change": 20000
  }
}
```

#### 2.5 Plugin Registry (Future)

```js
// Plugin interface
const PLUGIN_MANIFEST = {
  name: 'my-custom-view',
  version: '1.0.0',
  author: 'User Name',
  description: 'Custom portfolio heatmap',
  permissions: ['read:assets', 'read:snapshots'],
  entry: 'https://my-plugin.example.com/widget.js', // sandboxed iframe
  settings: [
    { key: 'colorScheme', type: 'select', options: ['green-red', 'blue-orange'] }
  ]
};
```

Plugins run in sandboxed iframes with a postMessage API:
```js
// Plugin ↔ WealthForge communication
window.parent.postMessage({ type: 'wf:getAssets', requestId: '123' }, '*');

// WealthForge responds:
window.addEventListener('message', (event) => {
  if (event.data.type === 'wf:getAssets') {
    // Verify plugin origin, check permissions, respond
    event.source.postMessage({
      type: 'wf:response',
      requestId: event.data.requestId,
      data: filteredAssets
    }, event.origin);
  }
});
```

---

## Feature 3: Smart Alerts & Proactive Notifications

### Goal
Proactive push notifications and in-app alerts for financial events that require attention.

### Implementation

#### 3.1 Alert Types

```js
const ALERT_TYPES = {
  // Time-based
  FD_MATURITY: { template: 'Your {name} FD (₹{amount}) matures on {date}', advance: 7 }, // days before
  SIP_DUE: { template: 'SIP of ₹{amount} for {name} due tomorrow', advance: 1 },
  INSURANCE_RENEWAL: { template: '{name} insurance renewal due {date}', advance: 30 },
  GOAL_DEADLINE: { template: 'Goal "{name}" deadline is in {days} days ({progress}% complete)', advance: 30 },
  ESOP_VESTING: { template: '{units} units of {name} vest on {date}', advance: 7 },
  LOAN_MILESTONE: { template: 'Your {name} is 50% paid off! {remaining} remaining.', trigger: 'milestone' },

  // Threshold-based
  MARKET_DROP: { template: 'Your portfolio dropped {pct}% today (₹{amount})', threshold: -3 },
  MARKET_RALLY: { template: 'Great day! Portfolio up {pct}% (₹{amount})', threshold: 3 },
  CONCENTRATION_ALERT: { template: '{name} is now {pct}% of your portfolio (threshold: {limit}%)', threshold: 25 },
  GOAL_ACHIEVED: { template: '🎉 Goal "{name}" achieved! Net worth crossed ₹{target}', trigger: 'achieved' },
  NET_WORTH_MILESTONE: { template: '🎉 Your net worth just crossed ₹{milestone}!', trigger: 'milestone' },
  DRIFT_ALERT: { template: 'Portfolio drift is {drift}% — time to rebalance?', threshold: 10 },

  // AI-generated
  AI_INSIGHT: { template: '{insight}', trigger: 'ai_generated' },
  TAX_REMINDER: { template: 'FY ending in {days} days. Unrealized LTCG: ₹{amount}. Consider harvesting.', advance: 45 }
};
```

#### 3.2 Alert Engine (`js/alerts.js`)

```js
export function checkAlerts() {
  const alerts = [];
  const today = new Date();
  const assets = store.getAssets();
  const liabilities = store.getLiabilities();
  const goals = store.getGoals();

  // FD Maturity
  assets.filter(a => a.type === 'fd').forEach(a => {
    const maturityDate = new Date(a.data.maturityDate);
    const daysUntil = daysBetween(today, maturityDate);
    if (daysUntil > 0 && daysUntil <= 7) {
      alerts.push({
        type: 'FD_MATURITY',
        severity: 'high',
        title: `FD Maturing Soon`,
        body: `${a.name} (₹${fmt(a.data.principal)}) matures in ${daysUntil} days (${formatDate(maturityDate)})`,
        action: { label: 'View FD', route: `/asset/${a.id}` },
        assetId: a.id
      });
    }
  });

  // ESOP Vesting
  assets.filter(a => a.type === 'esop').forEach(a => {
    const nextVest = getNextVestEvent(a);
    if (nextVest && daysBetween(today, nextVest.date) <= 7) {
      alerts.push({
        type: 'ESOP_VESTING',
        severity: 'info',
        title: `ESOPs Vesting`,
        body: `${nextVest.units} units of ${a.name} vest on ${formatDate(nextVest.date)}`,
        action: { label: 'View Grant', route: `/asset/${a.id}` }
      });
    }
  });

  // Net Worth Milestones (₹10L increments up to 1Cr, then ₹50L increments)
  const netWorth = store.getPortfolio().netWorth;
  const milestones = [1000000, 2000000, 3000000, 5000000, 7500000, 10000000, 15000000, 20000000, 30000000, 50000000, 75000000, 100000000];
  const lastSnapshot = store.getSnapshots()[store.getSnapshots().length - 2];
  if (lastSnapshot) {
    for (const m of milestones) {
      if (netWorth >= m && lastSnapshot.netWorth < m) {
        alerts.push({
          type: 'NET_WORTH_MILESTONE',
          severity: 'positive',
          title: `🎉 Milestone Crossed!`,
          body: `Your net worth just crossed ₹${fmtCompact(m)}!`,
          celebratory: true
        });
      }
    }
  }

  // Goal Achievement
  goals.filter(g => !g.achieved).forEach(g => {
    if (netWorth >= g.targetAmount) {
      alerts.push({
        type: 'GOAL_ACHIEVED',
        severity: 'positive',
        title: `🎯 Goal Achieved!`,
        body: `"${g.name}" — you've reached ₹${fmt(g.targetAmount)}!`,
        celebratory: true,
        action: { label: 'View Goals', route: '/goals' }
      });
    }
  });

  return alerts;
}
```

#### 3.3 Push Notification Delivery

```js
// Request notification permission
async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    // Register with push service
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: VAPID_PUBLIC_KEY
    });
    // Save subscription to Supabase for server-side push
    await supabase.from('push_subscriptions').upsert({
      user_id: userId,
      subscription: JSON.stringify(subscription),
      device_info: navigator.userAgent
    });
    return true;
  }
  return false;
}
```

#### 3.4 Alert Preferences (in `/settings`)

```
Notification Preferences
━━━━━━━━━━━━━━━━━━━━━━━

Push Notifications: [ON ✓]

Alert Types:
  ✓ FD maturity reminders (7 days before)
  ✓ ESOP vesting reminders
  ✓ Goal achievements
  ✓ Net worth milestones
  ✓ Market drops > [3]%
  ✓ Portfolio drift > [10]%
  ☐ Daily net worth update (morning)
  ✓ Weekly portfolio summary
  ✓ Tax deadline reminders

Quiet hours: [10 PM] to [8 AM]
```

#### 3.5 Celebration Animations

For milestone alerts, trigger a confetti animation:
```js
function celebrateMilestone(message) {
  showToast(message, 'positive', 5000);
  triggerConfetti(); // CSS animation burst
}

function triggerConfetti() {
  const container = document.createElement('div');
  container.className = 'confetti-container';
  for (let i = 0; i < 50; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.animationDelay = `${Math.random() * 3}s`;
    piece.style.backgroundColor = ['#6366f1', '#ec4899', '#f59e0b', '#10b981'][Math.floor(Math.random() * 4)];
    container.appendChild(piece);
  }
  document.body.appendChild(container);
  setTimeout(() => container.remove(), 4000);
}
```

---

## Feature 4: Community Benchmarks (Anonymous)

### Goal
Let users compare their financial metrics against anonymized peers (same age group, income bracket, city tier) for motivation and self-assessment.

### Implementation

#### 4.1 Anonymized Data Collection

**Privacy-first approach:** Users opt-in. Only aggregated percentile data is stored — no individual portfolios are shared or visible.

```sql
-- Store only aggregate metrics per user (not full portfolio)
CREATE TABLE benchmark_contributions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  age_bracket TEXT, -- '25-30', '30-35', etc.
  income_bracket TEXT, -- '5-10L', '10-20L', '20-50L', '50L+'
  city_tier TEXT, -- 'metro', 'tier1', 'tier2', 'other'
  net_worth_bracket TEXT, -- computed from net worth: '10-25L', '25-50L', etc.
  metrics JSONB NOT NULL, -- { netWorth, savingsRate, equityPct, debtPct, sipTotal, goalCount }
  opted_in BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Materialized view for percentile computation
CREATE MATERIALIZED VIEW benchmark_percentiles AS
SELECT
  age_bracket,
  income_bracket,
  percentile_cont(0.25) WITHIN GROUP (ORDER BY (metrics->>'netWorth')::numeric) as net_worth_p25,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY (metrics->>'netWorth')::numeric) as net_worth_p50,
  percentile_cont(0.75) WITHIN GROUP (ORDER BY (metrics->>'netWorth')::numeric) as net_worth_p75,
  percentile_cont(0.90) WITHIN GROUP (ORDER BY (metrics->>'netWorth')::numeric) as net_worth_p90,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY (metrics->>'equityPct')::numeric) as equity_pct_median,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY (metrics->>'sipTotal')::numeric) as sip_median,
  COUNT(*) as sample_size
FROM benchmark_contributions
WHERE opted_in = true
GROUP BY age_bracket, income_bracket;
```

#### 4.2 Benchmark View (route: `/benchmarks`)

```
How You Compare (Age: 30-35, Income: ₹20-50L)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Net Worth:     ₹95L    ┃████████████████░░░░┃  Top 22% (p75: ₹72L)
Savings Rate:  38%     ┃██████████████░░░░░░┃  Top 31%  (median: 25%)
Monthly SIP:   ₹45K    ┃████████████████████┃  Top 12% (median: ₹15K)
Equity %:      42%     ┃██████████████░░░░░░┃  Typical  (median: 40%)
Goals Set:     3       ┃██████████░░░░░░░░░░┃  Above avg (median: 1)

Based on 847 anonymous contributors in your cohort.

[Opt in to contribute your anonymized data]
[Change my demographics]
```

#### 4.3 Percentile Calculation (client-side display)

```js
function getPercentile(value, p25, p50, p75, p90) {
  if (value >= p90) return { percentile: 90 + (value - p90) / (p90 * 0.5) * 10, label: 'Top 10%' };
  if (value >= p75) return { percentile: 75 + (value - p75) / (p90 - p75) * 15, label: 'Top 25%' };
  if (value >= p50) return { percentile: 50 + (value - p50) / (p75 - p50) * 25, label: 'Above average' };
  if (value >= p25) return { percentile: 25 + (value - p25) / (p50 - p25) * 25, label: 'Below average' };
  return { percentile: (value / p25) * 25, label: 'Bottom 25%' };
}
```

#### 4.4 Opt-In Flow

```
Would you like to see how you compare to peers?

To show benchmarks, we need your demographics (stored anonymously):
- Age bracket: [30-35 ▾]
- Income bracket: [₹20-50L ▾]
- City tier: [Metro ▾]

☐ Also contribute my anonymized metrics to help others compare
  (Only aggregate stats are shared — never your actual portfolio)

[Show My Benchmarks]
```

#### 4.5 Privacy Safeguards

- Minimum cohort size: 50 users before showing percentiles (prevents de-anonymization)
- Only brackets stored (never exact values for demographics)
- User can opt out anytime → their contribution row is deleted
- No individual data is ever queryable by other users
- Refresh materialized view weekly (not real-time)
- Display disclaimer: "Based on voluntary, anonymized self-reported data"

---

## Feature 5: Premium Tier & Subscription System

### Goal
Implement a freemium model with clear value differentiation.

### Implementation

#### 5.1 Tier Definitions

```js
const TIERS = {
  FREE: {
    name: 'Free',
    price: 0,
    limits: {
      assets: 15,
      familyMembers: 0, // self only
      aiQuestions: 10, // per month
      documents: 0,
      documentStorageMB: 0,
      apiRequests: 0,
      scenarios: 1,
      alerts: 3,
      historyDays: 90
    },
    features: {
      dashboard: true,
      holdings: true,
      projections: true,
      goals: true,
      basicInsights: true, // rule-based only
      import: true, // CSV only, no AI
      export: true, // CSV only
      privacy_mode: true,
      multi_currency: false,
      tax_report: false,
      ai_chat: false,
      ai_insights: false,
      scenarios: false,
      family: false,
      rebalance: false,
      estate: false,
      benchmarks: false,
      api: false,
      webhooks: false
    }
  },
  PRO: {
    name: 'Pro',
    priceMonthly: 499, // INR
    priceYearly: 3999,
    limits: {
      assets: -1, // unlimited
      familyMembers: 2,
      aiQuestions: 100,
      documents: 50,
      documentStorageMB: 500,
      apiRequests: 5000, // per month
      scenarios: 10,
      alerts: -1,
      historyDays: -1 // unlimited
    },
    features: {
      // all free features +
      multi_currency: true,
      tax_report: true,
      ai_chat: true,
      ai_insights: true,
      ai_import: true,
      scenarios: true,
      rebalance: true,
      sip_tracker: true,
      expense_optimizer: true,
      benchmarks: true,
      push_notifications: true,
      pdf_export: true
    }
  },
  FAMILY: {
    name: 'Family',
    priceMonthly: 799,
    priceYearly: 6499,
    limits: {
      assets: -1,
      familyMembers: 5,
      aiQuestions: 300,
      documents: 200,
      documentStorageMB: 2000,
      apiRequests: 20000,
      scenarios: -1,
      alerts: -1,
      historyDays: -1
    },
    features: {
      // all pro features +
      family: true,
      estate: true,
      api: true,
      webhooks: true,
      priority_support: true
    }
  }
};
```

#### 5.2 Subscription Table

```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'FREE', -- 'FREE', 'PRO', 'FAMILY'
  billing_cycle TEXT, -- 'monthly', 'yearly'
  amount INTEGER, -- in smallest currency unit (paise)
  currency TEXT DEFAULT 'INR',
  payment_provider TEXT, -- 'razorpay', 'stripe'
  provider_subscription_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  status TEXT DEFAULT 'active', -- 'active', 'past_due', 'cancelled', 'expired'
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own subscription" ON subscriptions FOR SELECT USING (user_id = auth.uid());
```

#### 5.3 Payment Integration (Razorpay for India)

```js
// js/payments.js
async function initSubscription(tier, cycle) {
  // Create subscription via Edge Function
  const { data } = await callEdgeFunction('create-subscription', {
    tier,
    cycle // 'monthly' or 'yearly'
  });

  // Open Razorpay checkout
  const options = {
    key: RAZORPAY_KEY_ID,
    subscription_id: data.razorpaySubscriptionId,
    name: 'WealthForge AI',
    description: `${tier} Plan (${cycle})`,
    handler: async function(response) {
      // Verify payment server-side
      await callEdgeFunction('verify-subscription', {
        razorpay_subscription_id: response.razorpay_subscription_id,
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_signature: response.razorpay_signature
      });
      showToast('Subscription activated! Welcome to Pro.', 'success');
      window.location.reload();
    },
    prefill: { email: user.email },
    theme: { color: '#6366f1' }
  };

  const rzp = new Razorpay(options);
  rzp.open();
}
```

#### 5.4 Feature Gating (`js/subscription.js`)

```js
export function canAccess(feature) {
  const subscription = store.getSubscription();
  const tier = TIERS[subscription?.tier || 'FREE'];
  return tier.features[feature] === true;
}

export function checkLimit(limitKey) {
  const subscription = store.getSubscription();
  const tier = TIERS[subscription?.tier || 'FREE'];
  const limit = tier.limits[limitKey];
  if (limit === -1) return { allowed: true, remaining: Infinity };

  const current = getCurrentUsage(limitKey);
  return { allowed: current < limit, remaining: Math.max(0, limit - current), limit };
}

// Gate decorator for UI elements
export function gateFeature(feature, element) {
  if (!canAccess(feature)) {
    element.classList.add('gated');
    element.innerHTML = `
      <div class="upgrade-prompt">
        <span class="lock-icon">🔒</span>
        <p>This feature requires Pro</p>
        <button class="btn-upgrade" onclick="showUpgradeModal()">Upgrade →</button>
      </div>
    `;
    return false;
  }
  return true;
}
```

#### 5.5 Upgrade Modal

```
┌─────────────────────────────────────────────────┐
│          Unlock the Full Power of                │
│            WealthForge AI                        │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │   Free   │  │   Pro    │  │  Family  │     │
│  │   ₹0    │  │₹499/mo  │  │₹799/mo  │     │
│  │         │  │₹3999/yr │  │₹6499/yr │     │
│  │ 15 assets│  │Unlimited │  │Unlimited │     │
│  │ Basic    │  │AI Chat   │  │Everything│     │
│  │ insights │  │Tax Report│  │5 members │     │
│  │ CSV only │  │Scenarios │  │Estate    │     │
│  │          │  │Rebalance │  │API Access│     │
│  │          │  │Benchmarks│  │Webhooks  │     │
│  │[Current] │  │[Upgrade] │  │[Upgrade] │     │
│  └──────────┘  └──────────┘  └──────────┘     │
│                                                  │
│  💳 Secure payment via Razorpay                  │
│  ↩️  Cancel anytime, no questions asked           │
│  🔒 Your data is never sold or shared            │
└─────────────────────────────────────────────────┘
```

#### 5.6 Trial Period

New users get 14-day Pro trial:
```js
function isInTrial(subscription) {
  if (subscription.tier !== 'FREE') return false;
  const daysSinceSignup = daysBetween(user.created_at, new Date());
  return daysSinceSignup <= 14;
}
```

---

## Feature 6: Year-in-Review / Annual Summary

### Goal
Generate a shareable annual summary card showing the year's financial highlights — growth, best performers, milestones, and achievements.

### Implementation

#### 6.1 Year-in-Review Data Collection

```js
function generateYearInReview(year) {
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;
  const snapshots = store.getSnapshots().filter(s => s.date >= startDate && s.date <= endDate);

  if (snapshots.length < 2) return null;

  const firstSnapshot = snapshots[0];
  const lastSnapshot = snapshots[snapshots.length - 1];

  const netWorthGrowth = lastSnapshot.netWorth - firstSnapshot.netWorth;
  const netWorthGrowthPct = (netWorthGrowth / firstSnapshot.netWorth) * 100;

  // Best performer
  const assets = store.getAssets();
  const performances = assets.map(a => ({
    asset: a,
    startValue: getValueAtDate(a, startDate),
    endValue: valuate(a).currentValue,
    returnPct: ((valuate(a).currentValue - getValueAtDate(a, startDate)) / getValueAtDate(a, startDate)) * 100
  })).filter(p => p.startValue > 0);
  const bestPerformer = performances.sort((a, b) => b.returnPct - a.returnPct)[0];
  const worstPerformer = performances.sort((a, b) => a.returnPct - b.returnPct)[0];

  // Milestones crossed
  const milestonesCrossed = findMilestonesCrossed(snapshots);

  // Goals achieved
  const goalsAchieved = store.getGoals().filter(g => g.achieved && g.achievedDate >= startDate && g.achievedDate <= endDate);

  // Total invested (new assets added this year)
  const totalInvested = assets
    .filter(a => a.createdAt >= startDate && a.createdAt <= endDate)
    .reduce((sum, a) => sum + getInvestedAmount(a), 0);

  // Highest single-day gain/loss
  let maxDayGain = 0, maxDayLoss = 0;
  for (let i = 1; i < snapshots.length; i++) {
    const change = snapshots[i].netWorth - snapshots[i - 1].netWorth;
    if (change > maxDayGain) maxDayGain = change;
    if (change < maxDayLoss) maxDayLoss = change;
  }

  return {
    year,
    netWorthStart: firstSnapshot.netWorth,
    netWorthEnd: lastSnapshot.netWorth,
    netWorthGrowth,
    netWorthGrowthPct,
    bestPerformer,
    worstPerformer,
    milestonesCrossed,
    goalsAchieved,
    totalInvested,
    maxDayGain,
    maxDayLoss,
    totalDaysTracked: snapshots.length,
    longestStreak: calculateTrackingStreak(snapshots)
  };
}
```

#### 6.2 Year-in-Review Card (Shareable Image)

Generate a 1080x1920 (story-sized) or 1200x630 (OG-sized) canvas card:

```js
function renderYearInReviewCard(data) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext('2d');

  // Background gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, 1920);
  gradient.addColorStop(0, '#0f172a');
  gradient.addColorStop(1, '#1e1b4b');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1080, 1920);

  // Header
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 48px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(`My ${data.year} in Wealth`, 540, 120);
  ctx.font = '24px system-ui';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('WealthForge AI', 540, 160);

  // Net worth growth (hero stat)
  ctx.font = 'bold 72px system-ui';
  ctx.fillStyle = data.netWorthGrowthPct >= 0 ? '#10b981' : '#ef4444';
  ctx.fillText(`${data.netWorthGrowthPct >= 0 ? '+' : ''}${data.netWorthGrowthPct.toFixed(1)}%`, 540, 320);
  ctx.font = '28px system-ui';
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(`Net worth grew ₹${fmtCompact(data.netWorthGrowth)}`, 540, 380);

  // Stats grid
  drawStatBox(ctx, 80, 450, 'Best Performer', `${data.bestPerformer.asset.name}\n+${data.bestPerformer.returnPct.toFixed(0)}%`);
  drawStatBox(ctx, 560, 450, 'Total Invested', `₹${fmtCompact(data.totalInvested)}`);
  drawStatBox(ctx, 80, 650, 'Milestones', `${data.milestonesCrossed.length} crossed`);
  drawStatBox(ctx, 560, 650, 'Goals Achieved', `${data.goalsAchieved.length}`);
  drawStatBox(ctx, 80, 850, 'Best Day', `+₹${fmtCompact(data.maxDayGain)}`);
  drawStatBox(ctx, 560, 850, 'Days Tracked', `${data.totalDaysTracked}`);

  // Mini net worth chart
  drawMiniChart(ctx, data.snapshots, 80, 1050, 920, 400);

  // Footer
  ctx.fillStyle = '#475569';
  ctx.font = '20px system-ui';
  ctx.fillText('Generated by WealthForge AI', 540, 1850);

  return canvas.toDataURL('image/png');
}
```

#### 6.3 Year-in-Review Route (`/year-in-review/:year?`)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       Your 2026 in Wealth
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Net Worth Growth: +₹12.8L (+15.3%)
₹83.7L → ₹96.5L

📈 Best Performer: Bitcoin (+47%)
📉 Worst Performer: Paytm (-23%)
💰 Total Invested: ₹6.2L
🎯 Goals Achieved: 1 ("Emergency Fund")
🏆 Milestones: Crossed ₹90L, then ₹95L
📊 Tracked: 298 days (82% consistency)
🚀 Best single day: +₹1.2L (Nov 12)

[Share Card 📤]  [Download PNG]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Feature 7: Advisor White-Label Portal

### Goal
Allow financial advisors to use WealthForge as a client portfolio monitoring tool with their own branding.

### Implementation

#### 7.1 Advisor Account Type

```sql
CREATE TABLE advisor_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  business_name TEXT NOT NULL,
  logo_url TEXT,
  brand_color TEXT DEFAULT '#6366f1',
  sebi_registration TEXT, -- RIA number
  contact_email TEXT,
  contact_phone TEXT,
  max_clients INTEGER DEFAULT 50,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE advisor_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advisor_id UUID REFERENCES advisor_profiles(id) ON DELETE CASCADE NOT NULL,
  client_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  status TEXT DEFAULT 'pending', -- 'pending', 'active', 'revoked'
  permissions TEXT[] DEFAULT ARRAY['read'], -- 'read', 'write', 'manage'
  linked_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(advisor_id, client_user_id)
);

ALTER TABLE advisor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE advisor_clients ENABLE ROW LEVEL SECURITY;

-- Advisor can see their own profile
CREATE POLICY "Advisor sees own profile" ON advisor_profiles FOR ALL USING (user_id = auth.uid());
-- Advisor can see their client links
CREATE POLICY "Advisor sees own clients" ON advisor_clients FOR SELECT USING (advisor_id IN (SELECT id FROM advisor_profiles WHERE user_id = auth.uid()));
-- Client can see who has access
CREATE POLICY "Client sees own advisor links" ON advisor_clients FOR SELECT USING (client_user_id = auth.uid());
```

#### 7.2 Advisor Dashboard

```
[Advisor Logo]  Client Portfolio Monitor
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Active Clients: 23     Total AUM: ₹47.2Cr

┌──────────────┬──────────┬─────────┬──────────┬─────────┐
│ Client       │ Net Worth│ 1M Chng │ Risk     │ Actions │
├──────────────┼──────────┼─────────┼──────────┼─────────┤
│ Rahul S.     │ ₹1.8Cr   │ +4.2%   │ Moderate │ [View]  │
│ Priya M.     │ ₹95L     │ +2.1%   │ Aggress. │ [View]  │
│ Amit K.      │ ₹3.2Cr   │ -1.3%   │ Conserv. │ [View]  │
└──────────────┴──────────┴─────────┴──────────┴─────────┘

Alerts:
⚠️ Priya M. — equity allocation at 72% (target: 50%)
⚠️ Amit K. — FD ₹25L maturing in 5 days
ℹ️ Rahul S. — goal "Retirement" now 80% complete
```

#### 7.3 Client Invitation Flow

Advisor invites client via email → client approves read access → advisor can view (not modify) client portfolio.

```js
// Advisor sends invitation
async function inviteClient(clientEmail) {
  await callEdgeFunction('advisor-invite', { clientEmail });
  // Sends email with approval link
}

// Client approves
async function approveAdvisorAccess(inviteToken) {
  await callEdgeFunction('advisor-approve', { token: inviteToken });
  showToast('Advisor access granted (read-only)', 'success');
}
```

#### 7.4 Advisor View of Client Portfolio

When advisor views a client, they see the same dashboard/holdings/projections but:
- Read-only (no edit buttons)
- Advisor header shows "Viewing: Rahul S.'s portfolio"
- Quick notes field (advisor can add private notes about client)
- "Generate Report" button → PDF summary for client meeting

#### 7.5 White-Label Customization

Advisor can set:
- Business name (shown in header)
- Logo (replaces WealthForge logo)
- Brand color (replaces indigo accent)
- Custom footer text

```js
function applyAdvisorBranding(advisorProfile) {
  if (advisorProfile.brandColor) {
    document.documentElement.style.setProperty('--accent', advisorProfile.brandColor);
  }
  if (advisorProfile.logoUrl) {
    document.querySelector('.app-logo').src = advisorProfile.logoUrl;
  }
  document.querySelector('.app-name').textContent = advisorProfile.businessName;
}
```

#### 7.6 Advisor Pricing

```
Advisor Plan: ₹4,999/month or ₹39,999/year
- Up to 50 clients
- White-label branding
- Client portfolio monitoring
- Batch reports (PDF)
- Priority support
- SEBI RIA compliance features

Enterprise (50+ clients): Contact sales
```

---

## Feature 8: Advanced Performance Analytics

### Goal
Deeper portfolio analytics beyond basic returns — sector exposure, geographic diversification, correlation, risk metrics.

### Implementation

#### 8.1 Sector/Industry Exposure

Using `equity_master` data which includes sector/industry classification:

```js
function getSectorExposure(assets) {
  const sectors = {};

  for (const asset of assets.filter(a => a.type === 'equity')) {
    const master = getMasterData(asset.data.ticker);
    const sector = master?.sector || 'Unknown';
    const value = valuate(asset).currentValue;
    sectors[sector] = (sectors[sector] || 0) + value;
  }

  // For MFs, approximate sector exposure from fund category
  for (const asset of assets.filter(a => a.type === 'mf')) {
    const category = getMFCategory(asset); // 'Large Cap', 'Mid Cap', 'Sectoral - IT', etc.
    const value = valuate(asset).currentValue;
    if (category.startsWith('Sectoral')) {
      const sector = category.replace('Sectoral - ', '');
      sectors[sector] = (sectors[sector] || 0) + value;
    }
  }

  const total = Object.values(sectors).reduce((s, v) => s + v, 0);
  return Object.entries(sectors)
    .map(([sector, value]) => ({ sector, value, pct: (value / total) * 100 }))
    .sort((a, b) => b.value - a.value);
}
```

#### 8.2 Risk Metrics

```js
function calculateRiskMetrics(snapshots) {
  const returns = [];
  for (let i = 1; i < snapshots.length; i++) {
    returns.push((snapshots[i].netWorth - snapshots[i-1].netWorth) / snapshots[i-1].netWorth);
  }

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  // Sharpe ratio (annualized, risk-free rate = 6%)
  const annualReturn = mean * 252; // trading days
  const annualVol = stdDev * Math.sqrt(252);
  const sharpeRatio = (annualReturn - 0.06) / annualVol;

  // Max drawdown
  let peak = -Infinity, maxDrawdown = 0;
  for (const snapshot of snapshots) {
    if (snapshot.netWorth > peak) peak = snapshot.netWorth;
    const drawdown = (peak - snapshot.netWorth) / peak;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  // Sortino ratio (downside deviation only)
  const downsideReturns = returns.filter(r => r < 0);
  const downsideDeviation = Math.sqrt(downsideReturns.reduce((s, r) => s + r * r, 0) / downsideReturns.length);
  const sortinoRatio = (annualReturn - 0.06) / (downsideDeviation * Math.sqrt(252));

  return {
    annualReturn: annualReturn * 100,
    annualVolatility: annualVol * 100,
    sharpeRatio,
    sortinoRatio,
    maxDrawdown: maxDrawdown * 100,
    winRate: (returns.filter(r => r > 0).length / returns.length) * 100,
    bestDay: Math.max(...returns) * 100,
    worstDay: Math.min(...returns) * 100
  };
}
```

#### 8.3 Analytics Dashboard (route: `/analytics`)

```
Portfolio Analytics
━━━━━━━━━━━━━━━━━━

Risk Metrics
┌────────────────────┬────────────────────┐
│ Annual Return: 15.3%│ Sharpe Ratio: 1.42 │
│ Volatility: 8.7%   │ Sortino: 2.01      │
│ Max Drawdown: -12%  │ Win Rate: 62%      │
└────────────────────┴────────────────────┘

Sector Exposure (Equity + MFs)
[Horizontal bar chart]
IT/Technology  ████████████████  28%
Financial      ████████████      22%
Consumer       ████████          15%
Healthcare     ██████            11%
Industrial     ████               8%
Other          ████████          16%

Geographic Exposure
[Donut chart]
India          82%
US             12%
Global/Other    6%

Asset Correlation (90-day rolling)
[Heatmap matrix — equity vs gold vs crypto vs FDs]
              Equity  Gold   Crypto  FDs
Equity         1.0    -0.2    0.4    0.0
Gold          -0.2     1.0   -0.1    0.0
Crypto         0.4    -0.1    1.0    0.0
FDs            0.0     0.0    0.0    1.0
```

---

## Acceptance Criteria

- [ ] Beneficiaries can be created, assigned to assets with share percentages
- [ ] Estate view shows distribution overview with unnominated asset warnings
- [ ] Inactivity sharing trigger works (opt-in, configurable days)
- [ ] Estate summary PDF generates correctly
- [ ] API returns correct data for all endpoints (portfolio, assets, liabilities, snapshots)
- [ ] API keys can be created, listed, revoked
- [ ] Webhooks fire on asset.created, asset.updated, goal.achieved events
- [ ] Alerts fire for FD maturity, ESOP vesting, milestones, drift
- [ ] Push notifications delivered via service worker
- [ ] Confetti animation on milestone achievements
- [ ] Benchmarks show correct percentile position (with privacy safeguards)
- [ ] Subscription tiers gate features correctly
- [ ] Razorpay payment flow works end-to-end
- [ ] Free tier limits are enforced (15 assets, 10 AI questions/month)
- [ ] Year-in-review generates correct stats and shareable card
- [ ] Advisor can invite clients, view their portfolios (read-only)
- [ ] White-label branding applies correctly
- [ ] Risk metrics (Sharpe, drawdown, volatility) calculate correctly
- [ ] Sector/geographic exposure charts render
- [ ] All existing features still work (no regressions)
- [ ] Tests pass (`npm test`)

---

## Files to Create/Modify

### New Files
- `js/estate.js` — Beneficiary management, nomination UI, estate view, PDF export
- `js/api.js` — API key management UI
- `js/alerts.js` — Alert engine, notification preferences, push registration
- `js/benchmarks.js` — Community benchmarks opt-in, percentile display
- `js/subscription.js` — Tier definitions, feature gating, upgrade modal
- `js/payments.js` — Razorpay integration, subscription lifecycle
- `js/year-review.js` — Year-in-review data + canvas card generation
- `js/advisor.js` — Advisor dashboard, client management, white-label
- `js/analytics.js` — Risk metrics, sector exposure, correlation matrix
- `supabase/functions/api/index.ts` — Public REST API
- `supabase/functions/create-subscription/index.ts` — Razorpay subscription creation
- `supabase/functions/verify-subscription/index.ts` — Payment verification
- `supabase/functions/advisor-invite/index.ts` — Client invitation emails
- `supabase/functions/check-inactivity/index.ts` — Scheduled inactivity check
- `supabase/functions/send-push/index.ts` — Push notification sender
- `supabase/migrations/0009_phase4.sql` — All Phase 4 tables

### Modified Files
- `js/app.js` — Register new routes (`/estate`, `/analytics`, `/benchmarks`, `/year-review`, `/advisor`)
- `js/router.js` — Add new routes
- `js/views.js` — Integrate subscription gates, advisor header
- `js/store.js` — Add beneficiaries, subscriptions to store
- `js/cloud.js` — Sync new entities (beneficiaries, nominations, subscriptions)
- `styles.css` — Estate plan, benchmarks, subscription modal, analytics, advisor, alerts, confetti
- `index.html` — Razorpay script tag, notification permission prompt
- `public/sw.js` — Push notification handling improvements
- `package.json` — No new runtime deps (Razorpay loaded via script tag)

---

## Deployment & Operations Notes

### Environment Variables (Phase 4 additions)
```
# Razorpay
RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_SECRET=...

# Push Notifications (VAPID)
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...

# Advisor invitations (email service)
RESEND_API_KEY=...
```

### Scheduled Jobs (pg_cron or Edge Function cron)
1. **Daily:** Check inactivity triggers, refresh benchmark materialized view
2. **Weekly:** Generate digests for opted-in users
3. **Monthly:** Subscription renewal checks, usage reset

### Monitoring
- Track API usage per key (rate limiting table)
- Track AI token consumption per user (for billing accuracy)
- Monitor webhook delivery failures (auto-disable after 10 consecutive failures)
- Alert on subscription payment failures (retry 3x, then notify user)
