# Phase 2: AI Core (2-4 months)

## Context

You are working on **WealthForge AI** — a single-page app (SPA) for tracking net worth across 12+ asset classes and liabilities, with projections, goals tracking, and insights. Built with vanilla HTML/CSS/JS (no framework) on Vite, with optional Supabase cloud persistence.

### Existing Architecture
- **Entry point:** `index.html` → `src/main.js` → `js/app.js`
- **Routing:** `js/router.js` (HTML5 history API)
- **Data layer:** `js/store.js` (assets, liabilities, snapshots, goals)
- **Cloud:** `js/cloud.js` (Supabase sync), `js/supabase.js` (client init)
- **Auth:** `js/auth.js` (Supabase email+password + MFA)
- **Market data:** `js/market.js` (live prices via scheduled sync + deterministic fallback)
- **AI Import:** `js/ai-import.js` (Gemini-powered universal file import — now via Edge Function)
- **Finance:** `js/finance.js` (XIRR, Monte Carlo, amortization, compounding)
- **Charts:** `js/charts.js` (dependency-free SVG)
- **Views:** `js/views.js` (dashboard, holdings, projections, goals, settings)
- **Forms:** `js/forms.js` (dynamic type-driven add/edit)
- **Import/Export:** `js/import.js`, `js/export.js`, `js/share.js`
- **Insights:** `js/insights.js` (12 rule-based deterministic insights)
- **Styles:** `styles.css` (CSS custom properties for theming)

### Key Data Structures (`js/store.js`)

```js
// Asset object shape
{
  id: 'uuid',
  type: 'equity|mf|esop|crypto|fd|smallsavings|epf|ppf|nps|gold|realestate|other',
  name: 'Reliance Industries',
  data: { /* type-specific fields */ },
  valuationMode: 'live|computed|manual', // override
  createdAt: '2024-01-15',
  updatedAt: '2024-08-10'
}

// Portfolio aggregated state (from store.getPortfolio())
{
  totalAssets: 12500000,
  totalLiabilities: 3200000,
  netWorth: 9300000,
  dayChange: 15000,
  dayChangePct: 0.16,
  allocation: { equity: 0.35, mf: 0.25, fd: 0.15, ... },
  assets: [...],
  liabilities: [...]
}

// Snapshot (daily)
{
  date: '2024-08-10',
  totalAssets: 12500000,
  totalLiabilities: 3200000,
  netWorth: 9300000,
  byType: { equity: 4375000, mf: 3125000, ... }
}
```

### Finance Functions Available (`js/finance.js`)
- `fdValue(principal, rate, tenureMonths, freq)` → maturity amount
- `xirr(cashflows)` → annualized return
- `cagr(start, end, years)` → compound growth
- `lognormalBand(currentVal, mu, sigma, years, steps)` → {p10, p50, p90}[]
- `loanEMI(principal, rate, tenureMonths)` → monthly EMI
- `loanBalance(principal, rate, tenureMonths, monthsElapsed)` → outstanding
- `loanPayoffMonths(principal, rate, emi)` → months to clear
- `loanInterestRemaining(principal, rate, tenureMonths, monthsElapsed)` → total interest left
- `vestingSchedule(totalUnits, vestingMonths, cliffMonths, freq)` → events[]
- `ppfFV(balance, annualContrib, rate, years)` → future value
- `epfFV(balance, monthlySalary, employeeRate, employerRate, rate, years)` → future value
- `annuityFV(payment, rate, periods)` → future value (RD/SIP)
- `npsBlended(eqPct, corpPct, govtPct)` → { mu, sigma }

---

## Feature 1: Conversational Portfolio Assistant (AI Chat)

### Goal
Natural language interface where users query their portfolio, get explanations, run what-if scenarios, and receive personalized advice — powered by an LLM with function-calling over the user's data.

### Architecture

```
User types question
       ↓
js/ai-chat.js (client)
       ↓
POST /functions/v1/ai-chat (Edge Function)
  - Receives: question + user session token
  - Loads user's portfolio data from Supabase
  - Builds system prompt with portfolio context
  - Calls LLM with tools/functions defined
  - LLM may call tools (calculate XIRR, project, compare)
  - Returns structured response
       ↓
Render response in chat UI
```

### Implementation

#### 1.1 Chat UI (`js/ai-chat.js`)

Add a slide-out chat panel accessible from any screen:

```js
// Chat panel (slide from right)
export function renderChatPanel() {
  return `
    <aside id="ai-chat" class="chat-panel collapsed">
      <header class="chat-header">
        <h3>AI Assistant</h3>
        <span class="chat-model-badge">Powered by AI</span>
        <button class="chat-close" onclick="toggleChat()">×</button>
      </header>
      <div class="chat-messages" id="chat-messages">
        <div class="chat-welcome">
          <p>Ask me anything about your portfolio:</p>
          <div class="chat-suggestions">
            <button class="suggestion-chip" onclick="askAI(this.textContent)">What's my best performer this year?</button>
            <button class="suggestion-chip" onclick="askAI(this.textContent)">Am I on track for my goals?</button>
            <button class="suggestion-chip" onclick="askAI(this.textContent)">How diversified is my portfolio?</button>
            <button class="suggestion-chip" onclick="askAI(this.textContent)">What should I do with ₹1L surplus?</button>
          </div>
        </div>
      </div>
      <form class="chat-input-form" onsubmit="handleChatSubmit(event)">
        <input type="text" id="chat-input" placeholder="Ask about your portfolio..." autocomplete="off">
        <button type="submit" class="chat-send">→</button>
      </form>
    </aside>
  `;
}

// FAB button to open chat (shown on all pages)
export function renderChatFAB() {
  return `<button class="chat-fab" onclick="toggleChat()" title="AI Assistant">💬</button>`;
}
```

#### 1.2 Chat Message Handling

```js
const chatHistory = []; // { role: 'user'|'assistant', content: string }

async function askAI(question) {
  // Add user message to UI
  appendMessage('user', question);
  chatHistory.push({ role: 'user', content: question });

  // Show typing indicator
  showTypingIndicator();

  try {
    const session = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.data.session.access_token}`
      },
      body: JSON.stringify({
        question,
        history: chatHistory.slice(-10) // last 10 messages for context
      })
    });

    if (!res.ok) throw new Error(`Error: ${res.status}`);
    const data = await res.json();

    hideTypingIndicator();
    appendMessage('assistant', data.response, data.charts);
    chatHistory.push({ role: 'assistant', content: data.response });

  } catch (err) {
    hideTypingIndicator();
    appendMessage('assistant', 'Sorry, I couldn\'t process that. Please try again.');
  }
}
```

#### 1.3 Edge Function (`supabase/functions/ai-chat/index.ts`)

```ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY');
// OR use Anthropic:
// const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');

serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: { user } } = await supabase.auth.getUser(authHeader!.replace('Bearer ', ''));
  if (!user) return new Response('Unauthorized', { status: 401 });

  // Load user's portfolio
  const [assets, liabilities, snapshots, goals] = await Promise.all([
    supabase.from('assets').select('*').eq('user_id', user.id),
    supabase.from('liabilities').select('*').eq('user_id', user.id),
    supabase.from('net_worth_snapshots').select('*').eq('user_id', user.id).order('date', { ascending: false }).limit(90),
    supabase.from('goals').select('*').eq('user_id', user.id)
  ]);

  const { question, history } = await req.json();

  const systemPrompt = buildSystemPrompt(assets.data, liabilities.data, snapshots.data, goals.data);

  // Call LLM (Gemini function calling example)
  const response = await callLLM(systemPrompt, history, question);

  return new Response(JSON.stringify({ response }), {
    headers: { 'Content-Type': 'application/json' }
  });
});

function buildSystemPrompt(assets, liabilities, snapshots, goals) {
  return `You are WealthForge AI Assistant, a personal financial advisor analyzing the user's portfolio.

IMPORTANT RULES:
- Always use Indian currency formatting (₹, lakhs, crores)
- Be specific — reference actual holdings by name and value
- When recommending actions, explain the tax implications
- Never recommend specific stocks/MFs — suggest categories/approaches
- If asked about something outside finance, politely redirect
- Keep responses concise (under 200 words unless asked for detail)
- Use markdown formatting for readability

USER'S PORTFOLIO SUMMARY:
- Total Assets: ₹${formatIndian(totalAssets(assets))}
- Total Liabilities: ₹${formatIndian(totalLiabilities(liabilities))}
- Net Worth: ₹${formatIndian(netWorth(assets, liabilities))}

ASSET ALLOCATION:
${formatAllocation(assets)}

INDIVIDUAL HOLDINGS:
${formatHoldings(assets)}

LIABILITIES:
${formatLiabilities(liabilities)}

RECENT NET WORTH TREND (last 90 days):
${formatTrend(snapshots)}

GOALS:
${formatGoals(goals)}

Answer the user's question based on this data. Be specific and actionable.`;
}
```

#### 1.4 Tool/Function Calling (Advanced)

Define tools the LLM can call for calculations:

```js
const tools = [
  {
    name: 'calculate_xirr',
    description: 'Calculate XIRR (annualized return) for a specific holding',
    parameters: {
      type: 'object',
      properties: {
        asset_id: { type: 'string', description: 'ID of the asset' }
      }
    }
  },
  {
    name: 'project_portfolio',
    description: 'Project portfolio value over N years',
    parameters: {
      type: 'object',
      properties: {
        years: { type: 'number' },
        include_liabilities: { type: 'boolean' }
      }
    }
  },
  {
    name: 'what_if_scenario',
    description: 'Model a hypothetical change to the portfolio',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add_asset', 'remove_asset', 'add_liability', 'market_crash', 'increase_sip'] },
        params: { type: 'object' }
      }
    }
  },
  {
    name: 'compare_holdings',
    description: 'Compare performance of two or more holdings',
    parameters: {
      type: 'object',
      properties: {
        asset_ids: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  {
    name: 'tax_impact',
    description: 'Calculate capital gains tax if a holding is sold',
    parameters: {
      type: 'object',
      properties: {
        asset_id: { type: 'string' },
        units_to_sell: { type: 'number', description: 'If partial, number of units; omit for full' }
      }
    }
  }
];
```

#### 1.5 Example Conversations

```
User: "What's my best performing asset this year?"
AI: "Your best performer is **Bitcoin (BTC)** with a 47.2% return YTD, 
     followed by **Reliance Industries** at 28.1%. However, BTC also has 
     the highest volatility — it dropped 18% in March before recovering. 
     Your MF SIPs have a steadier 15.2% XIRR."

User: "If markets drop 20%, what happens?"
AI: "A 20% market correction would impact your equity + MF holdings 
     (currently ₹47.5L combined, 38% of portfolio). Estimated drawdown: 
     ~₹9.5L, bringing net worth from ₹1.24Cr to ₹1.15Cr.
     
     Your fixed-income (FDs + PPF + EPF: ₹52L) is unaffected.
     Recovery to current levels typically takes 12-18 months historically.
     
     Your 'Retirement 2035' goal would still be achievable if recovery 
     happens within 2 years."

User: "Am I saving enough for retirement?"
AI: "Based on your current trajectory:
     - Monthly SIPs: ₹45,000
     - Portfolio growth (5yr CAGR): 12.8%
     - Target: ₹3Cr by 2035 (your goal)
     - Projected: ₹2.6Cr (87% of target)
     
     Gap: ₹40Cr. To close it, either:
     1. Increase SIP by ₹8,000/month, OR
     2. Extend timeline by 14 months, OR
     3. Shift 10% from FDs to equity MFs (increases expected return)
     
     Option 1 is safest. Want me to model the step-up SIP scenario?"
```

#### 1.6 Chat Persistence

Store chat history in Supabase for continuity across sessions:

```sql
-- supabase/migrations/0007_chat_history.sql
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_chat_user_time ON chat_messages(user_id, created_at DESC);
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own chats" ON chat_messages FOR ALL USING (user_id = auth.uid());
```

#### 1.7 Rate Limiting

- Free tier: 20 questions/day
- Pro tier: 100 questions/day
- Track in `chat_messages` count per user per day
- Show remaining quota in chat UI footer

---

## Feature 2: AI-Generated Personalized Insights

### Goal
Replace/augment the 12 static rule-based insights with LLM-generated personalized recommendations that combine multiple signals and adapt to the user's specific situation.

### Implementation

#### 2.1 Insight Generation Pipeline

```
Portfolio data (assets, liabilities, snapshots, goals, market context)
       ↓
Serialize to structured prompt
       ↓
LLM generates 5-7 personalized insights
       ↓
Cache in Supabase (refresh daily or on significant portfolio change)
       ↓
Display on dashboard (alongside or replacing rule-based insights)
```

#### 2.2 Edge Function (`supabase/functions/ai-insights/index.ts`)

```ts
serve(async (req) => {
  // Auth + load portfolio (same as chat)
  // ...

  const prompt = `Analyze this portfolio and generate exactly 5 personalized financial insights.

PORTFOLIO DATA:
${JSON.stringify(portfolioSummary)}

RULES FOR INSIGHTS:
1. Each insight must reference SPECIFIC holdings by name and amount
2. Prioritize actionable advice over observations
3. Consider Indian tax laws (LTCG 10% above ₹1L, STCG 15%, 80C ₹1.5L limit, 80CCD ₹50K NPS)
4. Consider current market conditions and interest rate environment
5. Flag any concentration risk, liquidity mismatch, or goal misalignment
6. Include at least one positive insight (what's going well)
7. Include at least one forward-looking projection insight

FORMAT each insight as JSON:
{
  "title": "Short headline (under 60 chars)",
  "body": "2-3 sentence explanation with specific numbers",
  "severity": "high|medium|info|positive",
  "category": "risk|opportunity|tax|goal|allocation|debt",
  "actionable": true/false,
  "action": "Specific next step (if actionable)"
}

Return a JSON array of exactly 5 insights, sorted by severity (high first).`;

  const insights = await callLLM(prompt);
  
  // Cache results
  await supabase.from('cached_insights').upsert({
    user_id: user.id,
    insights: JSON.parse(insights),
    generated_at: new Date().toISOString()
  });

  return new Response(insights);
});
```

#### 2.3 Insight Caching & Refresh Strategy

```sql
-- supabase/migrations/0007_cached_insights.sql (or add to existing)
CREATE TABLE cached_insights (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  insights JSONB NOT NULL DEFAULT '[]',
  generated_at TIMESTAMPTZ DEFAULT now(),
  portfolio_hash TEXT -- hash of portfolio state when generated
);
ALTER TABLE cached_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own insights" ON cached_insights FOR ALL USING (user_id = auth.uid());
```

Refresh logic:
- On dashboard load: check if `generated_at` > 24 hours ago OR `portfolio_hash` has changed
- If stale: fetch new insights in background, update UI when ready
- Show cached insights immediately (never block on LLM call)
- Portfolio hash = md5(JSON.stringify(simplified portfolio state))

#### 2.4 Hybrid: Keep Rule-Based as Fallback

The existing 12 rules in `js/insights.js` should remain as:
1. **Fallback** when AI insights aren't available (local mode, rate limit)
2. **Critical alerts** that should never be missed (credit card revolving, extreme concentration)
3. **Instant** (rule-based fire immediately; AI insights are cached/async)

Display strategy:
- Show AI insights in the main panel (labeled "AI Insights")
- Show critical rule-based alerts above them (labeled "Alerts" with red/amber badges)

#### 2.5 Example AI Insights vs Current Rules

**Current rule-based (generic):**
> "Single holding concentration: Reliance Industries is 32% of your equity portfolio."

**AI-generated (personalized, actionable):**
> "**Reliance concentration risk: ₹14.2L in one stock**
> Reliance is 32% of your equity and 11.4% of total portfolio. A 15% correction (which happened 3 times in the past 2 years) would wipe ₹2.1L. Consider trimming ₹4-5L into a Nifty Next 50 index fund for similar large-cap exposure with diversification. Bonus: no additional LTCG if held over 1 year."

---

## Feature 3: Natural Language Data Entry

### Goal
Let users add assets by typing or dictating in natural language instead of filling forms.

### Implementation

#### 3.1 NLP Input Bar

Add a universal input bar at the top of the "Add Asset" flow:

```html
<div class="nlp-input-section">
  <p class="nlp-hint">Type naturally — we'll parse it for you</p>
  <div class="nlp-input-wrapper">
    <input type="text" id="nlp-input" 
           placeholder='e.g., "Bought 100 Infosys at 1450 on 5th Aug" or "My PPF balance is 12.5L"'
           class="nlp-input-field">
    <button class="nlp-submit" onclick="parseNaturalInput()">Parse →</button>
  </div>
  <div class="nlp-examples">
    <small>Examples:</small>
    <span class="example-chip" onclick="setNLPInput(this.textContent)">50 shares TCS at 3200</span>
    <span class="example-chip" onclick="setNLPInput(this.textContent)">SIP ₹10K in Axis Bluechip since Jan 2023</span>
    <span class="example-chip" onclick="setNLPInput(this.textContent)">FD 5L in SBI for 1 year at 6.8%</span>
    <span class="example-chip" onclick="setNLPInput(this.textContent)">Home loan 45L from HDFC at 8.5% for 20 years</span>
  </div>
</div>
```

#### 3.2 Parsing Logic (Edge Function)

```ts
// supabase/functions/ai-parse-entry/index.ts

const PARSE_PROMPT = `Parse this natural language input into a structured financial asset or liability.

INPUT: "{userInput}"

Determine the type and extract all fields. Return JSON:
{
  "type": "equity|mf|crypto|fd|epf|ppf|nps|gold|realestate|esop|other|homeloan|carloan|personal|education|creditcard",
  "name": "Human-readable name",
  "data": {
    // Type-specific fields. Include ALL that can be inferred:
    // equity: { ticker, exchange, units, avgCost, purchaseDate }
    // mf: { schemeName, amfiCode, units, nav, sipAmount, sipStartDate }
    // fd: { bank, principal, rate, tenureMonths, startDate, compoundFreq }
    // ppf: { balance, yearlyContribution }
    // gold: { form, grams, purchasePrice }
    // realestate: { propertyType, purchasePrice, currentValue, area, areaUnit }
    // homeloan: { lender, principal, rate, tenureMonths, emiAmount, startDate }
    // etc.
  },
  "confidence": "high|medium|low",
  "ambiguities": ["list of things that couldn't be determined from input"]
}

If the input is unclear or could be multiple types, pick the most likely and note ambiguities.
If a value uses Indian shorthand (L = lakh = 100000, Cr = crore = 10000000, K = thousand), convert to full numbers.`;
```

#### 3.3 Client Flow

```js
async function parseNaturalInput() {
  const input = document.getElementById('nlp-input').value.trim();
  if (!input) return;

  showNLPLoading();

  const result = await callEdgeFunction('ai-parse-entry', { input });

  if (result.confidence === 'high') {
    // Pre-fill the form with parsed data and show for confirmation
    prefillForm(result.type, result.data);
    showToast('Parsed successfully! Review and save.', 'success');
  } else {
    // Show what was parsed + highlight ambiguities
    showNLPReview(result);
  }
}

function showNLPReview(result) {
  // Show a card: "Here's what I understood:"
  // Type: [detected type]
  // Fields: [parsed values in a mini-table]
  // Ambiguities: "Couldn't determine: [list]"
  // [✓ Looks good — fill form] [✏️ Let me correct]
}
```

#### 3.4 Voice Input (Bonus)

Add a microphone button next to the NLP input that uses the Web Speech API:

```js
function startVoiceInput() {
  const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
  recognition.lang = 'en-IN';
  recognition.interimResults = false;

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    document.getElementById('nlp-input').value = transcript;
    parseNaturalInput(); // auto-parse
  };

  recognition.start();
}
```

---

## Feature 4: Capital Gains Computation (LTCG/STCG)

### Goal
Auto-calculate short-term and long-term capital gains per Indian tax law for all holdings with purchase history.

### Implementation

#### 4.1 Tax Rules (Indian, FY 2024-25+)

```js
// js/tax.js (new file)

const TAX_RULES = {
  equity: {
    longTermThreshold: 12, // months (changed from 12 to 24 for unlisted, stays 12 for listed)
    stcgRate: 0.20,        // 20% (Budget 2024)
    ltcgRate: 0.125,       // 12.5% (Budget 2024)
    ltcgExemption: 125000, // ₹1.25L per year (Budget 2024)
    grandfatherDate: '2018-01-31', // for pre-2018 equity
    grandfatherCap: null    // FMV on 31-Jan-2018 OR actual cost, whichever is higher
  },
  mf_equity: { // equity-oriented MFs (>65% equity)
    longTermThreshold: 12,
    stcgRate: 0.20,
    ltcgRate: 0.125,
    ltcgExemption: 125000
  },
  mf_debt: { // debt MFs
    longTermThreshold: 24, // no longer relevant — all taxed at slab
    taxAtSlab: true        // Budget 2023: no LTCG indexation, taxed at slab
  },
  crypto: {
    flatRate: 0.30,        // 30% flat on all gains
    noSetoff: true,        // cannot set off losses against other income
    tds: 0.01             // 1% TDS on transfer above ₹10K
  },
  gold: {
    longTermThreshold: 24, // months (physical gold)
    ltcgRate: 0.125,       // 12.5% without indexation (Budget 2024)
    stcgRate: null         // at slab rate
  },
  realestate: {
    longTermThreshold: 24,
    ltcgRate: 0.125,       // 12.5% without indexation (Budget 2024)
    stcgRate: null,        // at slab rate
    exemptions: ['54', '54EC', '54F'] // reinvestment exemptions
  }
};
```

#### 4.2 Capital Gains Calculator

```js
export function calculateCapitalGains(asset, sellDate = new Date()) {
  const lots = getLots(asset); // each lot = { date, units, cost }
  const currentPrice = getCurrentPrice(asset);
  const rules = TAX_RULES[getAssetTaxCategory(asset)];

  const results = lots.map(lot => {
    const holdingMonths = monthsBetween(lot.date, sellDate);
    const isLongTerm = holdingMonths >= rules.longTermThreshold;
    const gain = (currentPrice * lot.units) - (lot.cost * lot.units);

    // Grandfathering for pre-2018 equity
    let adjustedCost = lot.cost;
    if (rules.grandfatherDate && new Date(lot.date) < new Date(rules.grandfatherDate)) {
      const fmvOnGrandfatherDate = getFMV(asset, rules.grandfatherDate);
      adjustedCost = Math.max(lot.cost, Math.min(fmvOnGrandfatherDate, currentPrice));
    }

    const adjustedGain = (currentPrice - adjustedCost) * lot.units;

    return {
      lotDate: lot.date,
      units: lot.units,
      costPerUnit: lot.cost,
      adjustedCostPerUnit: adjustedCost,
      currentPrice,
      holdingMonths,
      isLongTerm,
      gain: adjustedGain,
      taxCategory: isLongTerm ? 'LTCG' : 'STCG',
      taxRate: isLongTerm ? rules.ltcgRate : rules.stcgRate,
      taxAmount: calculateTax(adjustedGain, isLongTerm, rules)
    };
  });

  const totalSTCG = results.filter(r => !r.isLongTerm).reduce((s, r) => s + r.gain, 0);
  const totalLTCG = results.filter(r => r.isLongTerm).reduce((s, r) => s + r.gain, 0);
  const ltcgAfterExemption = Math.max(0, totalLTCG - (rules.ltcgExemption || 0));

  return {
    lots: results,
    totalSTCG,
    totalLTCG,
    ltcgExemption: rules.ltcgExemption || 0,
    ltcgTaxable: ltcgAfterExemption,
    stcgTax: totalSTCG > 0 ? totalSTCG * rules.stcgRate : 0,
    ltcgTax: ltcgAfterExemption > 0 ? ltcgAfterExemption * rules.ltcgRate : 0,
    totalTax: (totalSTCG > 0 ? totalSTCG * rules.stcgRate : 0) + (ltcgAfterExemption > 0 ? ltcgAfterExemption * rules.ltcgRate : 0)
  };
}
```

#### 4.3 Tax Report View (new route: `/tax`)

```js
function renderTaxReport() {
  const assets = store.getAssets();
  const taxableAssets = assets.filter(a => ['equity', 'mf', 'crypto', 'gold'].includes(a.type));

  // Group by STCG and LTCG
  const gains = taxableAssets.map(a => ({
    asset: a,
    ...calculateCapitalGains(a)
  }));

  const totalSTCG = gains.reduce((s, g) => s + g.totalSTCG, 0);
  const totalLTCG = gains.reduce((s, g) => s + g.totalLTCG, 0);
  const totalTax = gains.reduce((s, g) => s + g.totalTax, 0);

  return `
    <div class="tax-report">
      <h2>Capital Gains Report (FY ${currentFY()})</h2>

      <div class="tax-summary-cards">
        <div class="stat-card">
          <label>Short-Term Gains</label>
          <span class="amount ${totalSTCG >= 0 ? 'positive' : 'negative'}">${fmt(totalSTCG)}</span>
          <small>Tax @ 20%: ${fmt(totalSTCG * 0.20)}</small>
        </div>
        <div class="stat-card">
          <label>Long-Term Gains</label>
          <span class="amount ${totalLTCG >= 0 ? 'positive' : 'negative'}">${fmt(totalLTCG)}</span>
          <small>Exemption: ${fmt(125000)} | Taxable: ${fmt(Math.max(0, totalLTCG - 125000))}</small>
        </div>
        <div class="stat-card highlight">
          <label>Estimated Tax Liability</label>
          <span class="amount">${fmt(totalTax)}</span>
        </div>
      </div>

      <h3>Per-Holding Breakdown</h3>
      <table class="tax-table">
        <thead>
          <tr><th>Holding</th><th>Type</th><th>Holding Period</th><th>Gain/Loss</th><th>Category</th><th>Tax</th></tr>
        </thead>
        <tbody>
          ${gains.flatMap(g => g.lots.map(lot => `
            <tr>
              <td>${g.asset.name}</td>
              <td>${g.asset.type}</td>
              <td>${lot.holdingMonths}m</td>
              <td class="${lot.gain >= 0 ? 'positive' : 'negative'}">${fmt(lot.gain)}</td>
              <td><span class="badge ${lot.isLongTerm ? 'badge-green' : 'badge-amber'}">${lot.taxCategory}</span></td>
              <td>${fmt(lot.taxAmount)}</td>
            </tr>
          `)).join('')}
        </tbody>
      </table>
    </div>
  `;
}
```

#### 4.4 Tax-Loss Harvesting Suggestions

```js
function findTaxLossHarvestingOpportunities(assets) {
  const opportunities = [];

  for (const asset of assets) {
    const gains = calculateCapitalGains(asset);
    const losingLots = gains.lots.filter(l => l.gain < 0);

    for (const lot of losingLots) {
      // Only suggest if:
      // 1. Loss is significant (>₹5000)
      // 2. Not a wash sale concern (30-day rule for equity)
      // 3. Won't trigger exit load (for MFs)
      if (Math.abs(lot.gain) > 5000) {
        opportunities.push({
          asset: asset.name,
          type: asset.type,
          lot,
          potentialSaving: Math.abs(lot.gain) * (lot.isLongTerm ? 0.125 : 0.20),
          recommendation: `Sell ${lot.units} units of ${asset.name} (bought ${formatDate(lot.lotDate)}) to harvest ₹${fmt(Math.abs(lot.gain))} loss. Tax saving: ~₹${fmt(Math.abs(lot.gain) * 0.20)}`
        });
      }
    }
  }

  return opportunities.sort((a, b) => b.potentialSaving - a.potentialSaving);
}
```

#### 4.5 Section 80C Tracker

```js
function get80CUtilization(assets, liabilities) {
  const limit = 150000;
  let utilized = 0;

  // PPF contributions
  const ppf = assets.filter(a => a.type === 'ppf');
  utilized += ppf.reduce((s, a) => s + (a.data.yearlyContribution || 0), 0);

  // EPF (employee share only — 12% of basic)
  const epf = assets.filter(a => a.type === 'epf');
  utilized += epf.reduce((s, a) => s + (a.data.monthlyContribution || 0) * 12, 0);

  // ELSS MFs
  const elss = assets.filter(a => a.type === 'mf' && isELSS(a));
  utilized += elss.reduce((s, a) => s + (a.data.sipAmount || 0) * 12, 0);

  // Life insurance premium (if tracked)
  // Home loan principal (from liabilities)
  const homeLoans = liabilities.filter(l => l.type === 'homeloan');
  // Principal component of EMI for the year
  utilized += homeLoans.reduce((s, l) => s + estimateAnnualPrincipal(l), 0);

  return {
    limit,
    utilized: Math.min(utilized, limit),
    remaining: Math.max(0, limit - utilized),
    breakdown: { ppf: ppfTotal, epf: epfTotal, elss: elssTotal, homeLoan: hlPrincipal }
  };
}
```

---

## Feature 5: Tax Planning Assistant (AI Tool)

### Goal
Combine capital gains data, 80C/80D utilization, and portfolio structure into an AI-powered tax optimization tool.

### Implementation

#### 5.1 Tax Planning View (route: `/tax/plan`)

Interactive tool that:
1. Shows current FY tax situation (income bracket, existing deductions)
2. AI analyzes portfolio for tax optimization opportunities
3. Generates specific recommendations with estimated savings

#### 5.2 User Input (what we need beyond portfolio)

Ask user for (store in profile):
- Approximate annual income bracket (for slab determination)
- Tax regime chosen (old vs new)
- Existing deductions beyond what we track (insurance, HRA, etc.)

#### 5.3 AI Tax Optimization Prompt

```
Given this user's financial situation:
- Income bracket: ₹15-20L (30% slab under old regime)
- Existing 80C utilization: ₹1.05L out of ₹1.5L
- Existing 80CCD(1B) utilization: ₹0 out of ₹50K
- LTCG unrealized: ₹2.3L (taxable: ₹1.05L above exemption)
- STCG unrealized: ₹45K
- Portfolio has 3 loss-making lots totaling ₹67K unrealized loss

Recommend specific tax optimization actions for this FY:
1. How to fill remaining 80C (₹45K gap)
2. Whether to harvest losses to offset gains
3. Whether old vs new regime is better
4. Any rebalancing that could be done tax-efficiently
5. NPS 80CCD(1B) opportunity

For each recommendation, show the exact tax saving in rupees.
```

---

## Feature 6: AI-Generated Monthly Digest

### Goal
Monthly email/in-app report summarizing portfolio changes, written in natural language by AI.

### Implementation

#### 6.1 Digest Generation (scheduled Edge Function or pg_cron trigger)

Run on the 1st of each month:
1. Load user's snapshots for past month
2. Load current portfolio
3. Generate narrative digest via LLM

#### 6.2 Digest Template Prompt

```
Generate a monthly portfolio digest for this user. Write in a friendly, professional tone.

PORTFOLIO CHANGES (Last 30 days):
- Net worth: ₹92.3L → ₹95.1L (+₹2.8L, +3.0%)
- Assets added: [HDFC Mid Cap Fund ₹50K]
- Assets sold: none
- Best performer: Bitcoin +12.3%
- Worst performer: Paytm -8.2%
- SIPs executed: 3 (total ₹35K)
- FD matured: SBI FD ₹2L (renewed? or parked in savings?)
- Goals: "House Down Payment" now 67% complete (was 62%)
- Allocation shift: Equity 42% → 44% (drift from target 40%)

MARKET CONTEXT:
- Nifty50: +2.1% this month
- 10Y govt bond yield: 7.1%
- Gold: +0.8%

Generate a 200-word digest covering:
1. One-line headline ("Your portfolio grew by...")
2. Key movers (what drove the change)
3. One actionable insight
4. One positive reinforcement
5. Upcoming: FDs maturing, goals approaching, SIPs due
```

#### 6.3 In-App Digest View

Route: `/digest` — shows monthly digests as cards, most recent first:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 August 2026 Digest
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Your portfolio grew ₹2.8L this month (+3.0%) —
ahead of Nifty's 2.1%. Bitcoin's 12.3% rally was
the star, while your SIPs quietly added ₹35K.

⚡ Key Insight: Your equity allocation drifted to 44%
(target: 40%). Consider pausing equity SIPs for one month
or redirecting ₹15K to debt funds to rebalance.

✅ Great move: Starting the HDFC Mid Cap SIP adds
mid-cap diversification you were missing.

📅 Coming up: SBI FD (₹2L) matures on Sep 15.
Current renewal rate is 6.5% — Bajaj Finance offers
7.4% for same tenure.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### 6.4 Email Delivery (Optional)

Use Supabase Edge Function + a transactional email service (Resend, SendGrid):
- Send digest email on 1st of month to opted-in users
- Include unsubscribe link
- Track delivery in `digest_emails` table

---

## Feature 7: Smart Financial Calculators (AI-Enhanced)

### Goal
Suite of financial planning tools that combine deterministic calculations with AI explanation/recommendations.

### Implementation

#### 7.1 Calculator Suite (new route: `/tools`)

```
Financial Tools
├── Retirement Calculator
├── Emergency Fund Analyzer
├── Loan Prepayment Advisor
├── SIP Step-Up Planner
├── Insurance Adequacy Check
└── Goal Gap Analyzer
```

#### 7.2 Retirement Calculator

```js
function retirementCalculator(inputs) {
  const {
    currentAge,
    retirementAge,
    monthlyExpenses,    // current
    inflationRate,      // default 6%
    expectedReturn,     // pre-retirement
    postRetReturn,      // post-retirement (conservative)
    lifeExpectancy,     // default 85
    existingCorpus      // from portfolio
  } = inputs;

  const yearsToRetirement = retirementAge - currentAge;
  const yearsInRetirement = lifeExpectancy - retirementAge;

  // Future monthly expenses at retirement (inflation-adjusted)
  const futureMonthlyExpense = monthlyExpenses * Math.pow(1 + inflationRate / 100, yearsToRetirement);

  // Corpus needed at retirement (PV of annuity with inflation)
  const realReturnRate = ((1 + postRetReturn / 100) / (1 + inflationRate / 100)) - 1;
  const corpusNeeded = futureMonthlyExpense * 12 * ((1 - Math.pow(1 + realReturnRate, -yearsInRetirement)) / realReturnRate);

  // What existing corpus will grow to
  const existingCorpusAtRetirement = existingCorpus * Math.pow(1 + expectedReturn / 100, yearsToRetirement);

  // Gap
  const gap = corpusNeeded - existingCorpusAtRetirement;

  // Monthly SIP needed to fill gap
  const monthlyRate = expectedReturn / 100 / 12;
  const months = yearsToRetirement * 12;
  const sipNeeded = gap > 0 ? gap * monthlyRate / (Math.pow(1 + monthlyRate, months) - 1) : 0;

  return {
    corpusNeeded,
    existingCorpusAtRetirement,
    gap,
    sipNeeded,
    futureMonthlyExpense,
    yearsToRetirement,
    yearsInRetirement
  };
}
```

After calculation, pass results to AI for plain-English explanation and personalized advice:

```
Results of retirement calculation:
- Needs ₹4.2Cr corpus at age 55
- Current portfolio will grow to ₹2.8Cr (at 12% CAGR)
- Gap: ₹1.4Cr
- Monthly SIP needed: ₹28,000 for 18 years

User's current SIP total: ₹45,000/month
User's portfolio: [equity heavy, no NPS]

Explain these results simply and suggest 2-3 specific actions to close the gap,
considering the user's existing portfolio composition.
```

#### 7.3 Loan Prepayment Advisor

```js
function loanPrepaymentAnalysis(loan, surplusAmount) {
  const { principal, rate, tenureMonths, monthsElapsed } = loan;
  const outstanding = loanBalance(principal, rate, tenureMonths, monthsElapsed);
  const emi = loanEMI(principal, rate, tenureMonths);

  // Scenario 1: Prepay → reduce tenure
  const newTenureAfterPrepay = loanPayoffMonths(outstanding - surplusAmount, rate, emi);
  const interestSavedPrepay = loanInterestRemaining(principal, rate, tenureMonths, monthsElapsed)
    - loanInterestRemaining(outstanding - surplusAmount, rate, newTenureAfterPrepay, 0);

  // Scenario 2: Invest the surplus instead
  const investReturn = surplusAmount * Math.pow(1 + 0.12, (tenureMonths - monthsElapsed) / 12); // assume 12% equity
  const investGainPostTax = (investReturn - surplusAmount) * 0.875; // LTCG 12.5%

  // Scenario 3: Prepay → reduce EMI (keep tenure)
  const newEMI = loanEMI(outstanding - surplusAmount, rate, tenureMonths - monthsElapsed);
  const emiReduction = emi - newEMI;

  return {
    prepayReduceTenure: { monthsSaved: (tenureMonths - monthsElapsed) - newTenureAfterPrepay, interestSaved: interestSavedPrepay },
    prepayReduceEMI: { newEMI, monthlySaving: emiReduction },
    investInstead: { futureValue: investReturn, gainPostTax: investGainPostTax },
    recommendation: interestSavedPrepay > investGainPostTax ? 'prepay' : 'invest'
  };
}
```

---

## Chat Panel Styles (`styles.css` additions)

```css
/* Chat panel */
.chat-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 400px;
  max-width: 100vw;
  height: 100vh;
  background: var(--bg-primary);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  z-index: 1000;
  transform: translateX(100%);
  transition: transform 0.3s ease;
}
.chat-panel.open { transform: translateX(0); }

.chat-header {
  padding: 1rem;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

.chat-message {
  margin-bottom: 1rem;
  max-width: 85%;
}
.chat-message.user {
  margin-left: auto;
  background: var(--accent);
  color: white;
  border-radius: 1rem 1rem 0 1rem;
  padding: 0.75rem 1rem;
}
.chat-message.assistant {
  background: var(--bg-secondary);
  border-radius: 1rem 1rem 1rem 0;
  padding: 0.75rem 1rem;
}

.chat-input-form {
  padding: 1rem;
  border-top: 1px solid var(--border);
  display: flex;
  gap: 0.5rem;
}
.chat-input-form input {
  flex: 1;
  padding: 0.75rem;
  border-radius: 2rem;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
}

.chat-fab {
  position: fixed;
  bottom: 5rem;
  right: 1.5rem;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--accent);
  color: white;
  font-size: 1.5rem;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  z-index: 999;
}

.suggestion-chip {
  display: inline-block;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 2rem;
  font-size: 0.8rem;
  cursor: pointer;
  margin: 0.25rem;
  background: var(--bg-secondary);
}
.suggestion-chip:hover { background: var(--accent); color: white; }

@media (max-width: 600px) {
  .chat-panel { width: 100vw; }
}
```

---

## Acceptance Criteria

- [ ] Chat panel opens/closes smoothly, works on mobile
- [ ] User can ask natural language questions and get portfolio-specific answers
- [ ] AI references actual holdings by name with correct values
- [ ] AI insights are personalized (not generic rules) and refresh daily
- [ ] Natural language data entry parses common formats (equity, MF, FD, loan)
- [ ] Capital gains report shows correct LTCG/STCG per Indian tax law
- [ ] Tax-loss harvesting identifies valid opportunities with savings estimate
- [ ] 80C tracker shows utilization from PPF, EPF, ELSS, home loan principal
- [ ] Monthly digest generates readable narrative of portfolio changes
- [ ] Financial calculators (retirement, prepayment) give correct results + AI explanation
- [ ] Chat history persists across sessions (cloud mode)
- [ ] Rate limiting works (20 free / 100 pro questions per day)
- [ ] All existing features still work (no regressions)
- [ ] Tests pass (`npm test`)

---

## Files to Create/Modify

### New Files
- `js/ai-chat.js` — Chat panel UI and message handling
- `js/tax.js` — Capital gains, 80C tracker, tax rules
- `js/tools.js` — Financial calculators (retirement, prepayment, emergency fund)
- `js/digest.js` — Monthly digest view
- `supabase/functions/ai-chat/index.ts` — Chat edge function
- `supabase/functions/ai-insights/index.ts` — Insight generation
- `supabase/functions/ai-parse-entry/index.ts` — NL parsing
- `supabase/functions/ai-digest/index.ts` — Digest generation
- `supabase/migrations/0007_ai_features.sql` — chat_messages, cached_insights tables

### Modified Files
- `js/app.js` — Add chat FAB, register `/tax`, `/tools`, `/digest` routes
- `js/router.js` — Add new routes
- `js/views.js` — Tax report view, tools view, digest view
- `js/insights.js` — Hybrid display (AI + rule-based fallback)
- `js/forms.js` — NLP input bar above form
- `styles.css` — Chat panel, tax report, tools, digest styles
- `index.html` — Chat panel container
