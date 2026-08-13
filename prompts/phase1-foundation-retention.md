# Phase 1: Foundation & Retention (0-2 months)

## Context

You are working on **WealthForge AI** — a single-page app (SPA) for tracking net worth across 12+ asset classes and liabilities, with projections, goals tracking, and insights. Built with vanilla HTML/CSS/JS (no framework) on Vite, with optional Supabase cloud persistence.

### Existing Architecture
- **Entry point:** `index.html` → `src/main.js` → `js/app.js`
- **Routing:** `js/router.js` (HTML5 history API)
- **Data layer:** `js/store.js` (assets, liabilities, snapshots, goals in localStorage or Supabase)
- **Cloud:** `js/cloud.js` (Supabase sync), `js/supabase.js` (client init)
- **Auth:** `js/auth.js` (Supabase email+password, demo account)
- **Market data:** `js/market.js` (live prices via scheduled sync + deterministic fallback)
- **AI:** `js/ai-import.js` (Gemini-powered universal file import)
- **Finance:** `js/finance.js` (XIRR, Monte Carlo, amortization, compounding)
- **Charts:** `js/charts.js` (dependency-free SVG)
- **Views:** `js/views.js` (dashboard, holdings, projections, goals, settings)
- **Forms:** `js/forms.js` (dynamic type-driven add/edit)
- **Import/Export:** `js/import.js`, `js/export.js`, `js/share.js`
- **Insights:** `js/insights.js` (12 rule-based deterministic insights)
- **Styles:** `styles.css` (single file, CSS custom properties for theming)
- **Build:** Vite with `VITE_*` env vars
- **Deploy:** Vercel with SPA rewrite (`vercel.json`)
- **DB:** Supabase with RLS, migrations in `supabase/migrations/`

### Env Vars
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_GEMINI_API_KEY=...  (currently client-side — needs to move server-side)
```

---

## Feature 1: Progressive Web App (PWA)

### Goal
Make the app installable on mobile/desktop with offline support and push notification capability.

### Implementation

#### 1.1 Web App Manifest (`public/manifest.json`)

```json
{
  "name": "WealthForge AI",
  "short_name": "WealthForge",
  "description": "Track your net worth across all asset classes with AI-powered insights",
  "start_url": "/dashboard",
  "display": "standalone",
  "background_color": "#0f172a",
  "theme_color": "#6366f1",
  "orientation": "portrait-primary",
  "categories": ["finance", "productivity"],
  "icons": [
    { "src": "/icons/icon-72.png", "sizes": "72x72", "type": "image/png" },
    { "src": "/icons/icon-96.png", "sizes": "96x96", "type": "image/png" },
    { "src": "/icons/icon-128.png", "sizes": "128x128", "type": "image/png" },
    { "src": "/icons/icon-144.png", "sizes": "144x144", "type": "image/png" },
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ],
  "screenshots": [
    { "src": "/screenshots/dashboard.png", "sizes": "1280x720", "type": "image/png", "form_factor": "wide" },
    { "src": "/screenshots/mobile.png", "sizes": "390x844", "type": "image/png", "form_factor": "narrow" }
  ]
}
```

#### 1.2 Service Worker (`public/sw.js`)

Strategy:
- **App shell (HTML/CSS/JS):** Cache-first, update in background
- **API calls (Supabase):** Network-first, fall back to cached
- **Market data:** Stale-while-revalidate with 5-min TTL
- **Static assets (fonts, icons):** Cache-first, immutable

```js
const CACHE_NAME = 'wealthforge-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/src/main.js',
  // All JS modules (build will bundle these)
  '/styles.css',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Supabase API: network-first
  if (url.hostname.includes('supabase')) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // App shell: cache-first
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

// Push notification handler
self.addEventListener('push', event => {
  const data = event.data?.json() || { title: 'WealthForge AI', body: 'Check your portfolio' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      data: data.url || '/dashboard'
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data));
});
```

#### 1.3 Register Service Worker (in `src/main.js`)

Add at the end of the boot sequence:
```js
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js');
  });
}
```

#### 1.4 Add to `index.html`
```html
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#6366f1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
```

#### 1.5 Install Prompt UI

Add an install banner component in `js/app.js`:
- Listen for `beforeinstallprompt` event
- Show a dismissible banner: "Install WealthForge for quick access"
- Track dismissal in localStorage so it doesn't reappear

#### 1.6 Vite PWA Build Config

Update `vite.config.js` to include the service worker in the build output. Use `vite-plugin-pwa` or manually configure the SW to reference hashed asset URLs.

### Icons to Generate
Create app icons at all required sizes. Use a bold "W" monogram or a chart-growth icon in indigo (#6366f1) on dark slate (#0f172a).

---

## Feature 2: Two-Factor Authentication (2FA/MFA)

### Goal
Enable TOTP-based 2FA for cloud-mode users using Supabase's built-in MFA.

### Implementation

#### 2.1 Supabase MFA Setup

Supabase natively supports TOTP MFA. The flow:
1. User enrolls a factor (shows QR code)
2. User verifies with a code from their authenticator app
3. On subsequent logins, after password succeeds, prompt for TOTP code
4. Session is only fully authenticated (AAL2) after TOTP verification

#### 2.2 New UI: MFA Enrollment (add to `/account` page)

In `js/auth.js`, add:

```js
async function enrollMFA() {
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
  if (error) return showToast(error.message, 'error');

  // data.totp.qr_code — base64 PNG of QR code
  // data.totp.uri — otpauth:// URI
  // data.id — factor ID (save for verification)

  // Show modal with QR code image + manual key
  showMFAEnrollModal(data);
}

async function verifyMFAEnrollment(factorId, code) {
  const challenge = await supabase.auth.mfa.challenge({ factorId });
  const { data, error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code
  });
  if (error) return showToast('Invalid code. Try again.', 'error');
  showToast('2FA enabled successfully!', 'success');
}
```

#### 2.3 Login Flow Update

After successful password login, check if user has MFA enrolled:

```js
async function handleLogin(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return showError(error.message);

  // Check MFA requirement
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const activeTOTP = factors.totp.filter(f => f.factor_type === 'totp' && f.status === 'verified');

  if (activeTOTP.length > 0) {
    // Show TOTP input screen
    showMFAVerifyScreen(activeTOTP[0].id);
  } else {
    // No MFA, proceed normally
    onAuthSuccess();
  }
}

async function verifyMFALogin(factorId, code) {
  const challenge = await supabase.auth.mfa.challenge({ factorId });
  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code
  });
  if (error) return showToast('Invalid code', 'error');
  onAuthSuccess();
}
```

#### 2.4 MFA Enrollment Modal UI

```html
<div class="modal mfa-enroll-modal">
  <h3>Enable Two-Factor Authentication</h3>
  <p>Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)</p>
  <img class="qr-code" src="" alt="MFA QR Code">
  <details>
    <summary>Can't scan? Enter this key manually</summary>
    <code class="mfa-secret"></code>
  </details>
  <label>Enter the 6-digit code from your app to verify:</label>
  <input type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" class="mfa-code-input">
  <button class="btn-primary" onclick="verifyMFAEnrollment(...)">Verify & Enable</button>
</div>
```

#### 2.5 Account Page Addition

In the `/account` view (in `js/views.js` or `js/auth.js`), add a "Security" section:
- Show MFA status (enabled/disabled)
- "Enable 2FA" button → enrollment flow
- "Disable 2FA" button → re-verify code → unenroll
- Show backup codes option (store encrypted, show once)

---

## Feature 3: Session Timeout & Device Management

### Goal
Auto-logout after inactivity. Show active sessions with ability to revoke.

### Implementation

#### 3.1 Idle Timeout (`js/auth.js`)

```js
const IDLE_TIMEOUT = 15 * 60 * 1000; // 15 minutes
let idleTimer;

function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    showToast('Session expired due to inactivity', 'info');
    supabase.auth.signOut();
    window.location.href = '/login';
  }, IDLE_TIMEOUT);
}

// Reset on user interaction
['click', 'keydown', 'scroll', 'touchstart'].forEach(evt =>
  document.addEventListener(evt, resetIdleTimer, { passive: true })
);
```

#### 3.2 Session Tracking Table (new migration)

```sql
-- supabase/migrations/0006_sessions.sql
CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  device_info JSONB NOT NULL DEFAULT '{}',
  ip_address INET,
  last_active_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  is_current BOOLEAN DEFAULT false
);

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own sessions" ON user_sessions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users delete own sessions" ON user_sessions FOR DELETE USING (user_id = auth.uid());
```

#### 3.3 Record Sessions on Login

After successful auth, insert a session record with user-agent info:
```js
async function recordSession() {
  const ua = navigator.userAgent;
  const device = parseUserAgent(ua); // extract browser + OS
  await supabase.from('user_sessions').insert({
    user_id: (await supabase.auth.getUser()).data.user.id,
    device_info: { browser: device.browser, os: device.os, raw: ua },
    is_current: true
  });
}
```

#### 3.4 Device Management UI (in `/account`)

Show a list of active sessions with:
- Device/browser name
- Last active timestamp
- "This device" badge for current session
- "Revoke" button for other sessions (deletes row + calls `supabase.auth.admin.signOut` via edge function)

---

## Feature 4: Move Gemini API Key Server-Side

### Goal
The `VITE_GEMINI_API_KEY` is currently bundled into the client JS — anyone can extract it from browser dev tools. Move AI calls to a Supabase Edge Function.

### Implementation

#### 4.1 Create Edge Function (`supabase/functions/ai-extract/index.ts`)

```ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.21.0';

const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

serve(async (req) => {
  // Verify user is authenticated
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: { user }, error } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (error || !user) return new Response('Unauthorized', { status: 401 });

  // Rate limit: max 10 imports per hour per user
  const { count } = await supabase
    .from('import_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', new Date(Date.now() - 3600000).toISOString());
  if (count >= 10) return new Response('Rate limit exceeded', { status: 429 });

  const { text, prompt, model } = await req.json();

  const genAI = new GoogleGenerativeAI(GEMINI_KEY);
  const genModel = genAI.getGenerativeModel({ model: model || 'gemini-2.5-flash' });
  const result = await genModel.generateContent(prompt + '\n\n' + text);

  return new Response(JSON.stringify({ result: result.response.text() }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
```

#### 4.2 Update `js/ai-import.js`

Replace direct Gemini SDK calls with edge function calls:

```js
async function callAI(text, prompt, model) {
  const session = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-extract`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.data.session.access_token}`
    },
    body: JSON.stringify({ text, prompt, model })
  });
  if (!res.ok) throw new Error(`AI service error: ${res.status}`);
  const data = await res.json();
  return data.result;
}
```

#### 4.3 Remove Client-Side Key

- Remove `VITE_GEMINI_API_KEY` from `.env` and `.env.example`
- Remove `@google/generative-ai` from client bundle (keep in edge function only)
- Add `GEMINI_API_KEY` to Supabase Edge Function secrets

#### 4.4 Fallback for Local Mode

In local mode (no Supabase), AI import won't work. Show a message: "AI-powered import requires a WealthForge account. Sign up for free to use this feature." This also becomes a conversion funnel for free → cloud users.

---

## Feature 5: Onboarding Wizard

### Goal
New users currently see an empty dashboard. Add a 3-step guided onboarding that gets them to value quickly.

### Implementation

#### 5.1 Onboarding State

Track in localStorage: `wealthforge.onboarding = { completed: false, step: 0 }`

#### 5.2 Onboarding Flow (new file: `js/onboarding.js`)

**Step 1: Welcome + Quick Profile**
```
Welcome to WealthForge AI!
Let's set up your portfolio in under 2 minutes.

What's your primary currency? [INR ▾]
What's your rough net worth range? (helps us tailor insights)
  [ ] Under ₹10L
  [ ] ₹10L – ₹50L
  [ ] ₹50L – ₹2Cr
  [ ] ₹2Cr – ₹10Cr
  [ ] ₹10Cr+
```

**Step 2: Add Your First Asset (choice)**
```
How would you like to start?

[📄 Import a statement]     → Opens AI import
[✏️  Add manually]           → Opens quick-add form (pre-selected to most common: MF or Equity)
[🎯 Skip — set a goal first] → Opens goal creation
[👁️  Explore with demo data]  → Loads demo seed, marks as "demo tour"
```

**Step 3: Dashboard Tour (lightweight)**
Highlight key areas with tooltip popovers (no library needed — CSS + JS positioning):
1. "This is your net worth" → hero number
2. "Track growth over time" → history chart
3. "AI insights appear here" → insights panel
4. "Set goals to stay motivated" → goals section

Mark `onboarding.completed = true` after step 3 or any skip.

#### 5.3 Empty States

For each view, when no data exists, show a helpful empty state instead of blank:

**Dashboard (no assets):**
```
Your portfolio is empty.
Add your first asset to see your net worth come alive.
[+ Add Asset]  [📄 Import Statement]
```

**Holdings (no assets of type):**
```
No {type} holdings yet.
[+ Add {type}]
```

**Goals (no goals):**
```
Set a net-worth goal to track your progress.
[+ Create Goal]
```

---

## Feature 6: CAS PDF Import (Dedicated Parser)

### Goal
CAMS/KFintech Consolidated Account Statements are the most common way Indian users can get their full MF portfolio. While AI import handles this, a dedicated parser is faster and more reliable for this specific format.

### Implementation

#### 6.1 CAS Format Understanding

CAS PDFs follow a predictable structure:
```
Folio No: 12345678 / 90      PAN: ABCDE1234F
[Scheme Name] - [Plan] - [Option]
Registrar: CAMS / KFintech

Date        | Transaction      | Amount    | Units    | NAV     | Balance
01-Jan-2023 | Purchase - SIP   | 5,000.00  | 32.154  | 155.51  | 832.456
...

Valuation on [date]: ₹1,29,456.78
```

#### 6.2 Dedicated CAS Parser (`js/cas-parser.js`)

```js
export function parseCAS(textContent) {
  const folios = [];
  let currentFolio = null;
  let currentScheme = null;

  const lines = textContent.split('\n');

  for (const line of lines) {
    // Detect folio
    const folioMatch = line.match(/Folio\s*(?:No)?[:\s]*(\S+)/i);
    if (folioMatch) {
      currentFolio = { number: folioMatch[1], schemes: [] };
      folios.push(currentFolio);
      continue;
    }

    // Detect scheme name (usually after folio, before transactions)
    // Pattern: known AMC name or scheme identifier
    const schemeMatch = detectSchemeLine(line);
    if (schemeMatch && currentFolio) {
      currentScheme = { name: schemeMatch, transactions: [], valuation: null };
      currentFolio.schemes.push(currentScheme);
      continue;
    }

    // Detect transaction row
    const txn = parseTransactionLine(line);
    if (txn && currentScheme) {
      currentScheme.transactions.push(txn);
      continue;
    }

    // Detect valuation
    const valMatch = line.match(/Valuation.*?([₹\d,]+\.?\d*)/i);
    if (valMatch && currentScheme) {
      currentScheme.valuation = parseIndianNumber(valMatch[1]);
    }
  }

  return folios;
}

function parseTransactionLine(line) {
  // Match: DD-Mon-YYYY | description | amount | units | nav | balance
  const pattern = /(\d{2}-\w{3}-\d{4})\s+(.+?)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{3})\s+([\d,]+\.\d+)\s+([\d,]+\.\d{3})/;
  const m = line.match(pattern);
  if (!m) return null;
  return {
    date: parseDate(m[1]),
    description: m[2].trim(),
    amount: parseIndianNumber(m[3]),
    units: parseFloat(m[4].replace(/,/g, '')),
    nav: parseFloat(m[5].replace(/,/g, '')),
    balance: parseFloat(m[6].replace(/,/g, ''))
  };
}
```

#### 6.3 CAS → WealthForge Asset Mapping

After parsing, convert to WealthForge MF assets:
1. Match scheme name against `mf_master` (Supabase fuzzy search or local matching)
2. Extract latest balance units + current NAV → current value
3. Extract all purchase transactions → lots for XIRR
4. Group by folio+scheme → one asset per scheme

#### 6.4 UI: CAS Import Button

Add to the import options (in the import modal or holdings page):
```
[📄 Import CAS PDF]
  ↓
  File picker (PDF only)
  ↓
  Parse → Preview table (scheme | units | value | status)
  ↓
  [Import All] / [Select & Import]
```

#### 6.5 Password-Protected PDFs

CAMS PDFs are typically password-protected (PAN + DOB or email). Add a password input before parsing:
```
This PDF is password-protected.
Enter your CAS password (usually PAN followed by DOB in DDMMYYYY):
[_______________] [Unlock]
```

Use `pdfjs-dist` (already a dependency) with the password option.

---

## Feature 7: Privacy Mode (Blur Amounts)

### Goal
Let users hide financial amounts on screen (for screen sharing, demos, shoulder-surfing).

### Implementation

#### 7.1 CSS Class

```css
body.privacy-mode .amount,
body.privacy-mode .net-worth-value,
body.privacy-mode .stat-value,
body.privacy-mode [data-sensitive] {
  filter: blur(8px);
  user-select: none;
  transition: filter 0.2s;
}

body.privacy-mode .amount:hover,
body.privacy-mode [data-sensitive]:hover {
  filter: none; /* reveal on hover */
}
```

#### 7.2 Toggle Button

Add an eye icon button in the top nav bar (next to theme toggle):
```js
function togglePrivacyMode() {
  document.body.classList.toggle('privacy-mode');
  localStorage.setItem('wealthforge.privacy', document.body.classList.contains('privacy-mode'));
}
```

#### 7.3 Mark Sensitive Elements

Add `data-sensitive` attribute or `.amount` class to all monetary values in views. Audit all view rendering functions in `js/views.js` to ensure amounts are wrapped in `<span class="amount">`.

---

## Feature 8: Content Security Policy

### Goal
Prevent XSS and other injection attacks with strict CSP headers.

### Implementation

#### 8.1 Add to `vercel.json`

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://generativelanguage.googleapis.com; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        },
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "Referrer-Policy",
          "value": "strict-origin-when-cross-origin"
        },
        {
          "key": "Permissions-Policy",
          "value": "camera=(), microphone=(), geolocation=()"
        }
      ]
    }
  ]
}
```

#### 8.2 Meta Tag Fallback (for non-Vercel or local dev)

In `index.html`:
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; font-src 'self'">
```

#### 8.3 Audit innerHTML Usage

Search for `innerHTML` assignments in all JS files. Replace with `textContent` where content is user-generated (asset names, notes, etc.). Only use innerHTML for controlled template strings where all dynamic values are escaped.

Create a helper:
```js
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
```

---

## Feature 9: Audit Log

### Goal
Track security-relevant actions (logins, edits, exports, password changes) and show users their activity.

### Implementation

#### 9.1 Migration (`supabase/migrations/0006_audit_log.sql`)

```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_log_user_time ON audit_log(user_id, created_at DESC);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own audit log" ON audit_log FOR SELECT USING (user_id = auth.uid());
-- Only service role or triggers can INSERT (not client directly)
CREATE POLICY "System inserts audit" ON audit_log FOR INSERT WITH CHECK (false);
```

#### 9.2 Trigger-Based Logging

Use Supabase database triggers to auto-log:
```sql
-- Log asset changes
CREATE OR REPLACE FUNCTION log_asset_change() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log (user_id, action, details)
  VALUES (
    COALESCE(NEW.user_id, OLD.user_id),
    TG_OP,
    jsonb_build_object('table', TG_TABLE_NAME, 'asset_type', COALESCE(NEW.type, OLD.type), 'asset_name', COALESCE(NEW.name, OLD.name))
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER audit_assets AFTER INSERT OR UPDATE OR DELETE ON assets
  FOR EACH ROW EXECUTE FUNCTION log_asset_change();
```

#### 9.3 Client-Side Logging (for actions without DB triggers)

For login, export, password change — log via edge function or direct insert with service role:
```js
async function logAction(action, details = {}) {
  if (!supabase) return; // skip in local mode
  await supabase.functions.invoke('audit-log', {
    body: { action, details }
  });
}
```

#### 9.4 Activity View (in `/account`)

Show recent activity:
```
Security Activity
─────────────────
Today 10:30 AM    Login from Chrome/Mac
Today 09:15 AM    Added asset: HDFC MF (₹50,000)
Yesterday         Exported portfolio (CSV)
Aug 10            Changed password
Aug 8             Enabled 2FA
```

---

## Acceptance Criteria

- [ ] App is installable as PWA on Chrome/Safari/Edge (mobile + desktop)
- [ ] Offline mode works: cached app shell loads, localStorage data accessible
- [ ] 2FA enrollment + login flow works end-to-end with TOTP
- [ ] Session auto-expires after 15min inactivity
- [ ] Gemini API key is NOT in client bundle (check with browser devtools → Sources)
- [ ] New users see onboarding wizard on first visit
- [ ] CAS PDF import successfully parses CAMS format and creates MF assets
- [ ] Privacy mode blurs all amounts, reveals on hover
- [ ] CSP headers present in production (check with browser devtools → Network → Response Headers)
- [ ] Audit log captures login, asset CRUD, export actions
- [ ] All existing tests still pass (`npm test`)
- [ ] No regressions in existing functionality

---

## Files to Create/Modify

### New Files
- `public/manifest.json`
- `public/sw.js`
- `public/icons/` (all sizes)
- `js/onboarding.js`
- `js/cas-parser.js`
- `supabase/functions/ai-extract/index.ts`
- `supabase/functions/audit-log/index.ts`
- `supabase/migrations/0006_sessions_audit.sql`

### Modified Files
- `index.html` (manifest link, meta tags, CSP)
- `src/main.js` (SW registration)
- `js/app.js` (onboarding trigger, privacy toggle, idle timer)
- `js/auth.js` (MFA flow, session recording, audit logging)
- `js/ai-import.js` (replace direct Gemini calls with edge function)
- `js/views.js` (empty states, amount class marking, audit view)
- `styles.css` (privacy mode, onboarding styles, MFA modal)
- `vercel.json` (security headers)
- `.env.example` (remove VITE_GEMINI_API_KEY, add server-side keys)
- `package.json` (remove @google/generative-ai from client deps if fully server-side)
