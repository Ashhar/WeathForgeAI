# Portfolio Import Options - Complete Guide

WealthForge AI offers **THREE powerful ways** to import your portfolio. Choose based on your data source and preferences.

---

## 🤖 Option 1: AI-Powered Universal Import (RECOMMENDED)

**Best for:** ANY broker or platform export

### What It Does
Upload a CSV from **any broker/platform** and Google Gemini AI automatically extracts your holdings - no manual column mapping needed!

### Supported Sources
- ✅ TickerTape (mutual funds + equity)
- ✅ Zerodha Console
- ✅ Groww
- ✅ Kuvera
- ✅ CAMS/KFintech CAS PDFs
- ✅ Any generic CSV export

### How to Use
1. Click "Add asset" → "🤖 AI-Powered Import (BETA)"
2. Upload CSV or PDF (max 10 MB)
3. AI analyzes structure and extracts holdings
4. Review preview table
5. Click "Import"

### Advantages
- ✅ Works with **any** CSV format
- ✅ Handles varied column names automatically
- ✅ Smart date format conversion
- ✅ Fuzzy name matching for funds
- ✅ Currency symbol stripping
- ✅ Auto-skips summary rows
- ✅ Future-proof (adapts to format changes)

### Requirements
- `VITE_GEMINI_API_KEY` in `.env`
- Google Gemini API access (free tier available)

### Cost
**FREE for most users!**
- Gemini free tier: 15 requests/min, 1M tokens/min, 1500 requests/day
- Typical import: 5,000-40,000 tokens
- Paid tier: ~$0.01-0.05 per import

### Time
- Small CSV (10-20 holdings): ~10 seconds
- Medium CSV (50-100 holdings): ~20 seconds
- Large CSV (200+ holdings): ~30 seconds

### Documentation
See [AI_UNIVERSAL_IMPORT.md](./AI_UNIVERSAL_IMPORT.md) for complete guide

---

## 📋 Option 2: Native TickerTape Format

**Best for:** TickerTape users who want instant, offline import

### What It Does
Built-in support for TickerTape's specific mutual fund CSV format with automatic format detection and fuzzy name matching.

### How to Use
1. Export from TickerTape → Download CSV
2. Click "Add asset" → "Mutual Fund" → "Import statement / CSV"
3. Upload or paste CSV content
4. Click "Preview"
5. Click "Import"

### Advantages
- ✅ No API key required
- ✅ Instant processing (no AI calls)
- ✅ Works in local mode (offline)
- ✅ Optimized for TickerTape format
- ✅ Three-tier fuzzy matching (exact → partial → key terms)

### Limitations
- Only works with TickerTape format
- Mutual funds only (no equity)
- Requires specific column structure

### Time
- Instant (< 1 second)

### Documentation
See [TICKERTAPE_IMPORT.md](./TICKERTAPE_IMPORT.md) for complete guide

---

## 📝 Option 3: Standard CSV Import

**Best for:** Users who want control over exact column mapping

### What It Does
Manual CSV import with predefined schemas for each asset type. You must match the exact column names or structure.

### Supported Asset Types
- Equity (stocks)
- Mutual Funds
- Crypto
- Fixed Deposits
- Gold/Silver
- EPF/PPF/NPS
- Small Savings
- ESOPs
- Real Estate
- Vehicles
- Other assets

### How to Use
1. Click "Add asset" → Choose asset type → "Import statement / CSV"
2. See required column names
3. Format your CSV to match schema
4. Paste or upload CSV
5. Click "Preview"
6. Click "Import"

### Example: Mutual Fund CSV
```csv
scheme_code,units,avg_nav,date,plan,option
120503,313.51,159.50,2023-10-12,Direct,Growth
122639,523.18,76.45,2022-06-01,Direct,Growth
```

**Required columns:** `scheme_code`, `date`  
**Optional columns:** `units`, `avg_nav`, `amount`, `plan`, `option`, `folio`

### Advantages
- ✅ Predictable behavior
- ✅ No API key required
- ✅ Works offline
- ✅ Fast processing
- ✅ Supports all asset types
- ✅ Detailed error messages per row

### Limitations
- Must match exact column names (or known aliases)
- Dates must be YYYY-MM-DD or DD-MM-YYYY
- Mutual funds require AMFI scheme codes (not names)
- No automatic format detection

### Time
- Instant (< 1 second)

### Documentation
See in-app hints when you click "Import statement / CSV" on any asset type

---

## Comparison Matrix

| Feature | AI Universal | Native TickerTape | Standard CSV |
|---------|-------------|-------------------|--------------|
| **Any broker format** | ✅ Yes | ❌ TickerTape only | ❌ Exact schema |
| **Auto column mapping** | ✅ Yes | ✅ Yes | ❌ Manual |
| **Fuzzy name matching** | ✅ Yes | ✅ Yes | ❌ Code only |
| **Date format flexibility** | ✅ Any | ✅ Any | ⚠️ Limited |
| **API key required** | ✅ Yes | ❌ No | ❌ No |
| **Offline mode** | ❌ No | ✅ Yes | ✅ Yes |
| **Speed** | ⚠️ 10-30s | ✅ Instant | ✅ Instant |
| **Cost** | 🆓 Free* | 🆓 Free | 🆓 Free |
| **Asset types** | MF + Equity | MF only | All types |
| **Future-proof** | ✅ Yes | ⚠️ Limited | ❌ No |

\* Gemini free tier covers typical usage; paid tier is pennies per import

---

## Decision Guide

### Use **AI Universal Import** if:
- ✅ You export from TickerTape, Zerodha, Groww, or other brokers
- ✅ You have multiple broker accounts (each with different CSV formats)
- ✅ Your CSV doesn't match WealthForge's exact schema
- ✅ You're okay setting up a Gemini API key (1-minute setup)
- ✅ You want the most flexible, future-proof solution

### Use **Native TickerTape Format** if:
- ✅ You only use TickerTape
- ✅ You want instant offline import (no API calls)
- ✅ You prefer not to set up API keys
- ✅ You only need mutual fund imports

### Use **Standard CSV Import** if:
- ✅ You have a custom CSV and want full control over mapping
- ✅ Your CSV already matches WealthForge schema
- ✅ You're importing asset types not yet supported by AI (gold, FD, PPF, etc.)
- ✅ You prefer deterministic behavior over AI flexibility

---

## Migration Path

**Already using Native TickerTape import?**
→ It still works! But try AI Universal for even easier imports.

**Already using Standard CSV import?**
→ Keep using it for exact control, or switch to AI Universal for flexibility.

**New user?**
→ Start with **AI Universal Import** - it's the most powerful and flexible option.

---

## Setup Guide: AI Universal Import

### Step 1: Get Gemini API Key (1 minute)

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API key" or "Get API key"
4. Copy the key (starts with `AIza...`)

### Step 2: Add to WealthForge

**Local development:**
1. Create `.env` file in project root (if not exists)
2. Add this line:
   ```
   VITE_GEMINI_API_KEY=AIzaSyC... # paste your actual key
   ```
3. Restart dev server: `npm run dev`

**Vercel deployment:**
1. Go to Vercel dashboard → Your project
2. Settings → Environment Variables
3. Add new variable:
   - Name: `VITE_GEMINI_API_KEY`
   - Value: `AIzaSyC...` (your key)
   - Environments: Production, Preview, Development
4. Save and redeploy

### Step 3: Test Import

1. Open WealthForge AI
2. Click "Add asset" → "🤖 AI-Powered Import (BETA)"
3. Upload your `Holdings-2.csv` (or any broker CSV)
4. Watch AI extract holdings
5. Review and import!

---

## Troubleshooting

### "VITE_GEMINI_API_KEY not configured"
→ Follow setup guide above

### "Invalid Gemini API key"
→ Check key is correct, starts with `AIza`, no extra spaces

### "AI did not return valid JSON"
→ CSV might be corrupted or unusual format. Try Standard CSV import instead.

### "Cannot match fund/stock"
→ Name doesn't exist in database. Add manually with AMFI code/symbol.

### TickerTape import fails
→ Try AI Universal Import instead - more flexible with name matching

---

## Future Roadmap

Coming soon:
- **Direct broker API integration** - No CSV export needed
- **Recurring auto-import** - Schedule monthly imports
- **Transaction history import** - SIP/buy/sell history, not just current holdings
- **Image/screenshot support** - OCR for scanned statements
- **Multi-asset CSV** - Import stocks + MF + crypto from single file

---

## Questions?

For issues or feature requests:
- Check relevant guide: [AI_UNIVERSAL_IMPORT.md](./AI_UNIVERSAL_IMPORT.md) or [TICKERTAPE_IMPORT.md](./TICKERTAPE_IMPORT.md)
- Report issues: [GitHub Issues](https://github.com/Ashhar/WeathForgeAI/issues)

---

**Last Updated:** 2026-08-03  
**Versions:**
- AI Universal: v1.0 (Gemini 1.5 Flash)
- Native TickerTape: v1.0
- Standard CSV: v2.0
