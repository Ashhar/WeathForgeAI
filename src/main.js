/* ============================================================
   WealthForge AI — Vite module entry.
   The app modules are classic IIFEs that publish themselves on
   globalThis (so inline onclick handlers and the node test
   harness keep working); import order = dependency order.
   ============================================================ */

import '../styles.css';

import '../js/router.js';
import '../js/market.js';
import '../js/finance.js';
import '../js/supabase.js';
import '../js/store.js';
import '../js/cloud.js';
import '../js/auth.js';
import '../js/insights.js';
import '../js/charts.js';
import '../js/import.js';
import '../js/ai-import.js';
import '../js/forms.js';
import '../js/views.js';
import '../js/pdf-font.js';
import '../js/export.js';
import '../js/share.js';
import '../js/privacy.js';
import '../js/cas-parser.js';
import '../js/onboarding.js';
import '../js/tax.js';
import '../js/tools.js';
import '../js/digest.js';
import '../js/ai-chat.js';
import '../js/app.js';

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
