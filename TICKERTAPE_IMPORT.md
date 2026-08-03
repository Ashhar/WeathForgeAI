# TickerTape Import Guide

## Overview

WealthForge AI offers **TWO ways** to import TickerTape holdings:

1. **🤖 AI-Powered Universal Import** (Recommended) - Works with ANY CSV format, including TickerTape
2. **📋 Native TickerTape Format Support** - Built-in support for TickerTape's specific CSV structure

Both methods work seamlessly - choose based on your preference!

## Method 1: AI-Powered Import (Recommended)

### Why Choose AI Import?
- ✅ Works with TickerTape AND other brokers (Zerodha, Groww, Kuvera, etc.)
- ✅ Handles ANY column structure automatically
- ✅ Smart name matching even if TickerTape names don't match AMFI exactly
- ✅ Future-proof (works even if TickerTape changes their CSV format)

### Steps:
1. Export from TickerTape → Download CSV
2. In WealthForge: Click "Add asset" → "🤖 AI-Powered Import (BETA)"
3. Upload your `Holdings-2.csv` file
4. AI automatically detects format and extracts holdings
5. Review preview table → Click "Import"

See [AI_UNIVERSAL_IMPORT.md](./AI_UNIVERSAL_IMPORT.md) for complete guide.

---

## Method 2: Native TickerTape Format

### Why Choose Native Import?
- ✅ No AI API key required
- ✅ Instant processing (no AI calls)
- ✅ Works offline (local mode)
- ✅ Predictable column mapping

### Step 1: Export from TickerTape

1. Go to [TickerTape Portfolio](https://tickertape.in/portfolio?tab=mfholdings)
2. Click the **Export** button (usually in the top-right)
3. Select **CSV** format
4. Download the file (e.g., `Holdings-2.csv`)

### Step 2: Import to WealthForge AI

1. Open WealthForge AI
2. Click **"Add asset"**
3. Select **"Mutual Fund"**
4. Click **"Import statement / CSV"** button
5. Either:
   - **Upload the CSV file**, OR
   - **Open the CSV in a text editor, copy all content, and paste** into the text area
6. Click **"Preview"**
7. Review the matched funds in the preview table
8. Click **"Import"** to add all holdings

### What Gets Imported

From your TickerTape export, WealthForge imports:

✅ **Fund Name** → Auto-matched to AMFI scheme database  
✅ **Units** → Your current holdings  
✅ **Invested Amount** → Total amount invested  
✅ **Invested Since** → First investment date  
✅ **Plan Type** → Direct/Regular  
✅ **Option Type** → Growth/IDCW  
✅ **NAV** → Current NAV (used if Invested Amount is missing)

### Auto-Detection

The import system **automatically detects TickerTape format** when you paste/upload a CSV with these columns:
- Fund Name
- Plan Type
- Option Type
- Invested Amt ₹
- Invested Since

No need to select a special format - it just works!

### Smart Matching

TickerTape exports use fund names (e.g., "DSP Small Cap Fund") instead of AMFI scheme codes. WealthForge uses **intelligent fuzzy matching** to find the correct scheme:

1. **Exact match** - Tries exact name first
2. **Partial match** - Checks if names contain each other
3. **Fuzzy match** - Removes common words (fund, direct, growth) and matches key terms
4. **Cloud database** - In cloud mode, searches against full AMFI master database (40,000+ schemes)

### What Gets Skipped

The import automatically skips:
- Header rows (e.g., "Mutual Funds Holdings - Mon Aug 03 2026")
- Visit/link rows (e.g., "Visit: https://tickertape.in...")
- Total/summary rows (e.g., "Total,,,,,...")
- Empty rows

### Example CSV Format

```csv
"Fund Name","Plan Type","Option Type","NAV ₹","Units","Invested Amt ₹","Invested Since"
"DSP Small Cap Fund","Direct","Growth","244.48","313.51","49997.48","2023-10-12"
"Franklin India Flexi Cap Fund","Direct","Growth","1809.06","100.66","149992.70","2023-10-12"
"ICICI Pru All Seasons Bond Fund","Direct","Growth","42.54","7578.75","299984.99","2025-05-02"
"Total","","","","","1599920.24",""
```

## Troubleshooting

### "Cannot match fund" Error

If a fund shows this error:
```
cannot match fund "XYZ Fund" — try adding AMFI scheme code manually
```

**Solution:**
1. Note the fund name
2. Search for the AMFI scheme code on [AMFI India](https://www.amfiindia.com/)
3. Add that scheme manually using the regular form with the AMFI code

**Why this happens:**
- Fund name in TickerTape doesn't exactly match AMFI database
- New/renamed schemes not yet in the database
- ETFs or other instruments that aren't in the mutual fund master

### Partial Import Success

The import shows: "X holdings imported, Y skipped"

**This is normal!** WealthForge uses **partial import**:
- ✅ Valid rows import successfully
- ❌ Invalid rows are reported with specific reasons
- Each row is independent

**Common skip reasons:**
- "skipping summary row" - Total row (expected)
- "skipping header row" - Extra TickerTape headers (expected)
- "cannot match fund" - Name matching failed (see above)
- "Units must be a positive number" - Data issue in CSV

### Missing Data

If some values aren't importing:
- **Folio numbers** - TickerTape doesn't export these; add manually if needed
- **Transaction history (lots)** - TickerTape only shows current holdings; add SIP details manually
- **XIRR** - WealthForge calculates this from your invested amount and dates

## Advanced: Manual Format

If auto-detection fails, you can also use the standard WealthForge CSV format:

```csv
scheme_code,units,avg_nav,date,plan,option
120503,313.51,159.50,2023-10-12,Direct,Growth
```

**Required:** scheme_code (AMFI code), date  
**Optional:** units, avg_nav, amount, plan, option, folio

## Comparison: TickerTape vs WealthForge

| Feature | TickerTape | WealthForge AI |
|---------|-----------|----------------|
| Data Source | Fund name | AMFI scheme code (more accurate) |
| Matching | Manual | Automatic fuzzy matching |
| Plan/Option | Explicit | Auto-detected from database |
| Import | CSV export → manual entry | One-click CSV import |
| Transaction History | Limited | Full lots/SIP tracking |
| Projections | Basic | Monte Carlo 10-year bands |
| Goals Tracking | No | Yes, with achievement dates |

## Cloud Mode Advantage

In **cloud mode** (with Supabase configured), fund matching is even better:

- Searches against **full AMFI database** (40,000+ schemes)
- Uses PostgreSQL `pg_trgm` fuzzy search
- Handles typos and abbreviations
- Daily sync keeps NAVs current

In **local mode**, matching works against built-in scheme list (~10 popular schemes).

## Future Enhancements

Planned improvements:
- Support for TickerTape **equity holdings** export
- Support for other broker formats (Zerodha, Groww, Kuvera, etc.)
- AI-powered import (using Gemini) for ANY CSV format
- Automatic XIRR calculation from import dates

## Questions?

If you encounter issues:
1. Check the preview table for specific error messages
2. Verify your CSV matches the TickerTape format
3. Try importing a smaller subset first (2-3 funds)
4. Report issues at [GitHub Issues](https://github.com/Ashhar/WeathForgeAI/issues)

---

**Last Updated:** 2026-08-03  
**Tested With:** TickerTape MF Holdings Export (2026 format)
