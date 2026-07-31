/* ============================================================
   WealthForge AI — Supabase client
   Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (the anon key
   is safe to expose — every table is protected by RLS). When the
   env vars are absent the app runs in "local" mode: data stays in
   localStorage exactly as before, and auth pages explain how to
   enable the backend.
   ============================================================ */

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const client = (url && anonKey)
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

// Credentials of the shared, read-only demo account (see supabase/seed.sql).
// The password is public by design; RLS blocks all writes for demo users.
const DEMO_EMAIL = 'demo@wealthforge.ai';
const DEMO_PASSWORD = 'wealthforge-demo';

const Supa = {
  client,
  enabled: !!client,
  DEMO_EMAIL,
  DEMO_PASSWORD,
};

if (typeof globalThis !== 'undefined') globalThis.Supa = Supa;
