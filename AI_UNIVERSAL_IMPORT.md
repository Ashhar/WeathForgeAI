# AI-Powered Universal Import

## Overview

WealthForge AI now supports **AI-powered universal import** that can automatically extract holdings from **ANY broker or platform export** — no manual column mapping required!

Simply upload a CSV or PDF, and Google Gemini AI will intelligently parse the data and import your portfolio.

## Supported Sources

✅ **TickerTape** - Mutual funds, stocks, ETFs  
✅ **Zerodha** - Console holdings export  
✅ **Groww** - Portfolio CSV  
✅ **Kuvera** - Holdings statement  
✅ **CAMS/KFintech** - CAS PDF statements  
✅ **Any broker** - Generic CSV formats  
✅ **Custom exports** - Excel/CSV from any source  

The AI adapts to different column names, date formats, and data structures automatically.

## How It Works

### 1. AI Detection & Analysis
- **Asset type detection** - Automatically identifies if the file contains stocks, mutual funds, crypto, etc.
- **Column mapping** - Maps varied column names to standard fields (e.g., "Fund Name" → scheme_name, "Qty" → quantity)
- **Date normalization** - Converts all date formats (DD-MM-YYYY, MM/DD/YY, etc.) to standard format
- **Smart skipping** - Ignores total rows, headers, and summary lines

### 2. Intelligent Matching
- **Mutual funds** - Fuzzy name matching against AMFI database (40,000+ schemes in cloud mode)
- **Stocks** - Symbol lookup in NSE/BSE master database
- **Confidence scoring** - High/medium/low confidence for each match

### 3. Review & Confirm
- Preview table with all extracted holdings
- Yellow highlights for low-confidence matches
- Edit or remove before final import
- Partial import (valid rows import, invalid rows skipped)

## Usage

### Step 1: Access AI Import

1. Click **"Add asset"** button
2. You'll see **"🤖 AI-Powered Import (BETA)"** card at the top
3. Click to open the upload modal

OR use the import button in any asset form (mutual funds, equity, etc.)

### Step 2: Upload File

**Supported formats:**
- CSV files (`.csv`)
- PDF files (`.pdf` - text-based only, no scanned images)

**Size limit:** 10 MB max

**Examples:**
- `Holdings-2.csv` (TickerTape export)
- `zerodha_holdings.csv` (Zerodha Console)
- `groww_portfolio.csv` (Groww app)
- `CAS_Statement.pdf` (CAMS/KFintech)

### Step 3: AI Processing

The AI will:
1. Read the file content
2. Identify asset type (stocks vs mutual funds)
3. Extract all holdings with their details
4. Match against WealthForge's master databases
5. Generate confidence scores

**Processing time:** ~10-30 seconds depending on file size

### Step 4: Review & Import

**Preview table shows:**
- ✅ Successfully matched holdings (green checkmark)
- ⚠️ Low-confidence matches (yellow highlight)
- ❌ Unmatched holdings (red cross)

**For each holding, you see:**
- Name/symbol
- Quantity/units
- Price/NAV
- Current value
- Folio (for mutual funds)

**Actions:**
- Click **"Import"** to add all valid holdings
- Invalid/unmatched rows are skipped with reasons shown

## Examples

### Example 1: TickerTape Mutual Funds CSV

**Input file structure:**
```csv
Fund Name,Plan Type,Option Type,NAV ₹,Units,Invested Amt ₹,Invested Since
DSP Small Cap Fund,Direct,Growth,244.48,313.51,49997.48,2023-10-12
Franklin India Flexi Cap Fund,Direct,Growth,1809.06,100.66,149992.70,2023-10-12
```

**AI extracts:**
- Asset type: `mf` (mutual fund)
- 8 holdings with fund names, units, invested amounts, dates
- Matches against AMFI database
- Imports with correct plan (Direct) and option (Growth)

**Result:** All 8 funds imported in ~20 seconds

---

### Example 2: Zerodha Stocks CSV

**Input file structure:**
```csv
Symbol,Quantity,Average Cost,LTP,P&L
RELIANCE,50,2450.00,3012.40,28120.00
TCS,25,4100.00,4188.60,2215.00
```

**AI extracts:**
- Asset type: `equity` (stocks)
- Symbols, quantities, average prices
- Matches against NSE/BSE database
- Calculates total invested from qty × avg cost

**Result:** All stocks imported with live LTP linked

---

### Example 3: Generic CSV (Any Format)

**Input file structure:**
```csv
Scheme Name,Investment Date,Amount,Current Units
HDFC Balanced Advantage Fund - Direct Plan - Growth,01-Apr-2023,50000,120.5
```

**AI extracts:**
- Recognizes "Scheme Name" → mutual fund
- Parses Indian date format
- Maps "Amount" → total invested
- Maps "Current Units" → units
- Fuzzy matches "HDFC Balanced Advantage Fund" in database

**Result:** Successfully imported despite non-standard columns

## Column Mapping Examples

The AI understands many column name variations:

### Mutual Funds
| Your CSV Column | AI Maps To |
|-----------------|-----------|
| Fund Name, Scheme Name, Fund | scheme_name |
| AMFI Code, Scheme Code | scheme_code |
| Units, Units Held, Quantity | units |
| NAV, NAV ₹, Latest NAV | nav |
| Invested Amount, Amount, Total Cost | total_invested |
| Invested Since, Purchase Date, Date | date |
| Plan Type, Plan | plan |
| Option Type, Option | option |
| Folio No, Folio Number | folio |

### Stocks/Equity
| Your CSV Column | AI Maps To |
|-----------------|-----------|
| Symbol, Ticker, Scrip, Stock | symbol |
| Quantity, Qty, Shares | quantity |
| Avg Price, Average Cost, Buy Price | avg_price |
| Total Invested, Amount, Cost | total_invested |
| Date, Purchase Date, Acquired On | date |

## Advanced Features

### Multi-Asset Type Detection

If your CSV contains mixed assets (stocks + mutual funds), the AI will:
1. Detect the dominant asset type
2. Import all rows of that type
3. Skip rows that don't match the detected type

**Example:** TickerTape exports are single-type (MF or equity), so all rows import cleanly.

### Date Format Handling

AI automatically handles:
- ISO format: `2023-10-12`
- Indian format: `12-10-2023` or `12/10/2023`
- US format: `10/12/2023`
- Text dates: `12 Oct 2023`, `Oct-12-2023`

All are converted to standard `YYYY-MM-DD` format.

### Currency Symbols

AI strips currency symbols automatically:
- `₹2,450.50` → `2450.50`
- `$1,234.56` → `1234.56`
- `2 450.50` (space-separated) → `2450.50`

### Summary Row Detection

AI automatically skips:
- Total rows: `"Total","","","",1599920.24`
- Grand total rows
- Empty rows
- Extra header rows

## Troubleshooting

### "AI did not return valid JSON"

**Cause:** CSV format is too unusual or corrupted

**Solutions:**
1. Check if CSV opens correctly in Excel
2. Verify it has proper headers
3. Try removing extra rows (notes, disclaimers)
4. Use manual CSV import instead

---

### "Cannot match fund/stock"

**Cause:** Name doesn't match database or is a new/unlisted instrument

**Solutions:**
1. Check if the name is correct
2. For mutual funds: add manually with AMFI code
3. For stocks: verify symbol on NSE/BSE
4. Some instruments (unlisted stocks, ETFs) may not be in database

---

### "CSV appears empty"

**Cause:** File has no data or only headers

**Solutions:**
1. Verify CSV has data rows (not just headers)
2. Check file isn't password-protected
3. Ensure it's saved as CSV (not Excel with .csv extension)

---

### "Invalid Gemini API key"

**Cause:** `VITE_GEMINI_API_KEY` not set or incorrect

**Solutions:**
1. Get key from [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Add to `.env` file: `VITE_GEMINI_API_KEY=your-key-here`
3. Restart dev server: `npm run dev`
4. For Vercel: set in dashboard → Environment Variables

---

### Partial Import Success

**Example:** "5 holdings imported, 3 skipped"

**This is normal!** Each row is processed independently:
- ✅ Valid rows import
- ❌ Invalid rows skip with reason shown

**Common skip reasons:**
- "skipping summary row" - Total row (expected)
- "cannot match fund" - Name not in database
- "Units must be a positive number" - Data quality issue

Check the preview table to see which rows failed and why.

## Cost & Token Usage

### Gemini API Pricing (as of 2026)

**Model used:** `gemini-1.5-flash`

| Input | Output | Cost per file |
|-------|--------|---------------|
| Free tier | 15 RPM, 1M TPM | **FREE** for normal use |
| Paid tier | $0.075/1M tokens input | ~$0.01-0.05 per import |

**Typical token usage:**
- Small CSV (10-20 rows): ~5,000 tokens
- Medium CSV (50-100 rows): ~15,000 tokens
- Large CSV (200+ rows): ~40,000 tokens
- CAS PDF (10 pages): ~60,000 tokens

**Free tier limits:**
- 15 requests per minute
- 1 million tokens per minute
- 1,500 requests per day

**Bottom line:** Most users stay within free tier. Even power users pay pennies per import.

## Privacy & Security

### What Gets Sent to Gemini

**YES - Sent to AI:**
- CSV column headers
- Fund names, stock symbols
- Quantities, amounts, dates
- NAV/price values

**NO - NOT sent:**
- Your name or email
- Bank account details
- PAN/Aadhaar numbers
- Login credentials

**Data retention:** Google may log API calls for debugging but doesn't train models on your data.

### Local vs Cloud Mode

**Cloud mode (recommended):**
- Matches against full AMFI/NSE/BSE database (40,000+ schemes)
- Uses `pg_trgm` fuzzy search
- Higher success rate

**Local mode:**
- Matches against built-in list (~10 popular schemes/stocks)
- No database calls
- Limited coverage

## Comparison: AI Import vs Manual Import

| Feature | AI Import | Manual CSV Import | Manual Entry |
|---------|-----------|-------------------|--------------|
| Setup | None | Must match exact column names | N/A |
| Column mapping | Automatic | Manual (must match schema) | N/A |
| Date formats | Any format | Must be YYYY-MM-DD or DD-MM-YYYY | Manual |
| Fund matching | Name-based (fuzzy) | Requires AMFI code | Manual search |
| Skip summary rows | Automatic | Manual removal | N/A |
| Works with any broker | ✅ Yes | ❌ No (specific format) | ✅ Yes |
| Requires API key | ✅ Yes | ❌ No | ❌ No |
| Cost | ~Free (Gemini tier) | Free | Free |
| Speed (50 funds) | ~20 seconds | ~30 seconds | ~25 minutes |

## Best Practices

### 1. Start Small
Test with 2-3 holdings first before importing full portfolio

### 2. Review Before Confirming
Always check the preview table — AI is smart but not perfect

### 3. Clean Your CSV
Remove:
- Notes and disclaimers at top
- Multiple header rows
- Merged cells (Excel)
- Macros or formulas

### 4. Use Cloud Mode
For best results, use WealthForge with Supabase (cloud mode) for full database access

### 5. Keep API Key Secure
Never commit `.env` to Git or share your `VITE_GEMINI_API_KEY`

## Future Enhancements

Planned improvements:
- **Multi-asset imports** - Single CSV with stocks + MF + crypto
- **Bank statement parsing** - Extract SIPs from transaction history
- **Image/screenshot support** - OCR for scanned PDFs
- **Broker APIs** - Direct integration (no CSV export needed)
- **Recurring auto-import** - Schedule monthly imports
- **Transaction history** - Import buy/sell/SIP history, not just current holdings

## Technical Details

### AI Extraction Schema

The AI is prompted to extract:

**For Mutual Funds:**
```json
{
  "asset_type": "mf",
  "holdings": [
    {
      "scheme_name": "DSP Small Cap Fund",
      "scheme_code": null,
      "units": 313.51,
      "avg_nav": 159.50,
      "total_invested": 49997.48,
      "plan": "Direct",
      "option": "Growth",
      "date": "2023-10-12",
      "folio": null
    }
  ]
}
```

**For Stocks:**
```json
{
  "asset_type": "equity",
  "holdings": [
    {
      "symbol": "RELIANCE",
      "quantity": 50,
      "avg_price": 2450.00,
      "total_invested": 122500.00,
      "date": "2023-01-15"
    }
  ]
}
```

### Matching Logic

**Mutual Funds:**
1. Try ISIN match (exact)
2. Try AMFI scheme code (exact)
3. Try fuzzy name match via `search_mf` RPC
4. Confidence: high > medium > low

**Stocks:**
1. Try symbol match in `equity_master` table
2. Confidence: high if found, low if not

### Model Configuration

```javascript
model: 'gemini-1.5-flash',
temperature: 0.1,  // Low temperature for deterministic output
maxOutputTokens: 8192
```

## Questions?

For issues or feature requests:
- Check preview table for specific error messages
- Read troubleshooting section above
- Report issues: [GitHub Issues](https://github.com/Ashhar/WeathForgeAI/issues)

---

**Last Updated:** 2026-08-03  
**AI Model:** Google Gemini 1.5 Flash  
**Tested With:** TickerTape (MF + Equity), Zerodha, Groww, CAMS PDF
