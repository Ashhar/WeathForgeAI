# Deployment Guide - WealthForge AI

## Quick Deploy via Vercel CLI

```bash
# 1. Install Vercel CLI (if not already installed)
npm install -g vercel

# 2. Login to Vercel
vercel login

# 3. Link to your existing project (one-time)
vercel link

# 4. Deploy to production
vercel --prod
```

## Verify Deployment Success

After deployment completes, test these URLs:

### 1. Version Check
```bash
curl https://wealthforgeai.ashharnadeem.in/version.json
```
**Expected:** JSON with `"version": "2.0.0-p0p1"` and P1-1 AI import listed

### 2. Bundle Check
```bash
curl -s https://wealthforgeai.ashharnadeem.in/index.html | grep "index-BILEChUy.js"
```
**Expected:** Should find the bundle (hash: BILEChUy)

### 3. Manual Browser Check
Visit: https://wealthforgeai.ashharnadeem.in
- Click "Add asset" button
- Should see "🤖 AI-Powered Import (BETA)" card at top

## What's Deployed

✅ **P0-1:** Live gold/silver/FX rates (every 20 min via GitHub Actions)  
✅ **P0-2:** Bulk CSV import (12 asset types)  
✅ **P0-3:** Full NSE/BSE + AMFI search (daily sync via GitHub Actions)  
✅ **P1-1:** AI-powered CAS PDF import (CAMS/KFintech → mutual funds)

## Troubleshooting

### Issue: Vercel shows old bundle (BJuzqyvV.js instead of BILEChUy.js)

**Solution 1:** Clear build cache
1. Vercel dashboard → Settings → General
2. Scroll to "Build & Development Settings"
3. Click "Clear Build Cache"
4. Redeploy

**Solution 2:** Force rebuild from latest commit
1. Make sure commit `c3de1a6` or later is deployed
2. Redeploy with "Use existing Build Cache" UNCHECKED

**Solution 3:** Check build logs
1. Deployment → View Build Logs
2. Look for npm install or build errors
3. Common issues:
   - Missing `@anthropic-ai/sdk` or `pdfjs-dist`
   - Out of memory during build
   - Build timeout

### Issue: Build succeeds but features missing

Check these settings in Vercel:
- Framework: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm ci`
- Root Directory: (empty or `.`)

## Latest Commits

- `c3de1a6` - Force npm dependency refresh for Vercel
- `244f092` - Add version marker for deployment verification
- `b678b28` - P1-1: LLM-powered universal import
- `63dfe8d` - P0-3: Full NSE/BSE + AMFI search coverage

## Environment Variables Required

Set these in Vercel dashboard (Settings → Environment Variables):

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_ANTHROPIC_API_KEY=your-anthropic-api-key
```

Without these, the app runs in local mode (localStorage only, no AI import).
