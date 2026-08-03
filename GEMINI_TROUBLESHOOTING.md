# Gemini API Troubleshooting Guide

## Common Issues and Solutions

### ❌ Error: "model not supported for generateContent"

**Full error message:**
```
gemini1.5 flash is not supported for generateContent
Call ModelService.ListModels to see the list of available models and their supported methods
```

**Cause:** Incorrect model name format or the model name has changed.

**Solution:** ✅ **FIXED** in commit `eea0231`

The app now automatically tries multiple model name formats:
1. `gemini-1.5-flash-latest` (primary)
2. `gemini-1.5-flash` (fallback #1)
3. `gemini-pro` (fallback #2)

If you're still seeing this error after updating, try these steps:

#### Step 1: Verify Your API Key

```bash
# Check .env file has correct key
cat .env | grep GEMINI
```

Expected output:
```
VITE_GEMINI_API_KEY=AIzaSyC...
```

**Key should:**
- Start with `AIza`
- Be 39 characters long
- Have no spaces or quotes

#### Step 2: Test API Key Directly

Visit: https://aistudio.google.com/app/apikey

- Sign in with the same Google account
- Verify the key is listed as "Active"
- Check quota/limits aren't exceeded

#### Step 3: Clear and Rebuild

```bash
# Remove build cache
rm -rf dist/ node_modules/.vite

# Rebuild
npm run build

# Restart dev server
npm run dev
```

#### Step 4: Check Model Availability

The Gemini API periodically updates model names. If all fallbacks fail:

1. Visit [Google AI for Developers](https://ai.google.dev/gemini-api/docs/models/gemini)
2. Find the current model name for "Gemini 1.5 Flash"
3. Update `js/ai-import.js`:

```javascript
const MODELS = ['your-found-model-name', 'gemini-1.5-flash-latest', 'gemini-1.5-flash', 'gemini-pro'];
```

---

### ❌ Error: "Invalid API key"

**Full error message:**
```
Invalid Gemini API key — check VITE_GEMINI_API_KEY in .env
```

**Cause:** API key not set, incorrect, or expired.

**Solutions:**

#### Get a New API Key
1. Go to https://aistudio.google.com/app/apikey
2. Click "Create API key"
3. Copy the new key (starts with `AIza`)

#### Update .env File
```bash
# Local development
echo "VITE_GEMINI_API_KEY=AIzaSyC..." > .env

# Or edit .env manually:
nano .env
```

Add this line:
```
VITE_GEMINI_API_KEY=AIzaSyC_your_actual_key_here
```

**Important:**
- No quotes around the value
- No spaces
- Must start with `VITE_` (Vite environment variable prefix)

#### Update Vercel (Production)
1. Vercel Dashboard → Your Project
2. Settings → Environment Variables
3. Delete old `VITE_GEMINI_API_KEY`
4. Add new one:
   - Name: `VITE_GEMINI_API_KEY`
   - Value: `AIzaSyC...`
   - Apply to: Production, Preview, Development
5. Redeploy

#### Restart Dev Server
```bash
# Kill the server (Ctrl+C)
npm run dev
```

Environment variables are loaded at startup, so you MUST restart.

---

### ❌ Error: "Rate limit exceeded"

**Full error message:**
```
429 Resource exhausted
```

**Cause:** Exceeded Gemini API free tier limits.

**Free Tier Limits:**
- 15 requests per minute (RPM)
- 1 million tokens per minute (TPM)
- 1,500 requests per day (RPD)

**Solutions:**

#### Wait and Retry
Free tier limits reset every minute. Wait 60 seconds and try again.

#### Optimize Usage
- Import smaller CSVs (split large files)
- Avoid rapid successive imports
- Use native TickerTape import (no API calls)

#### Upgrade to Paid Tier
Free tier is usually enough, but if you need more:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Enable billing for your project
3. Paid tier: $0.075 per 1M input tokens

**Typical cost:** $0.01-0.05 per import

---

### ❌ Error: "AI did not return valid JSON"

**Full error message:**
```
AI did not return valid JSON — try a different CSV format
```

**Cause:** CSV format is unusual, corrupted, or AI couldn't parse it.

**Solutions:**

#### Check CSV Format
Open your CSV in a text editor (not Excel):

**Good format:**
```csv
Fund Name,Units,Amount,Date
DSP Small Cap Fund,313.51,49997.48,2023-10-12
```

**Bad format:**
- Empty file
- Only headers, no data
- Corrupted characters
- Binary data (not text CSV)

#### Clean Your CSV
1. Remove extra rows at top (disclaimers, notes)
2. Remove merged cells
3. Ensure proper headers
4. Save as UTF-8 CSV

#### Try Alternative Import Methods

If AI import fails, use:

**Option 1: Native TickerTape Import** (for TickerTape CSVs)
- Mutual Fund form → "Import statement / CSV"
- No API calls, instant

**Option 2: Standard CSV Import**
- Format your CSV to match exact schema
- See required columns in the import modal

---

### ❌ Error: "Cannot match fund/stock"

**Full error message:**
```
cannot match fund "XYZ Fund" — try adding AMFI scheme code manually
```

**Cause:** Fund/stock name doesn't match database or is unlisted.

**Solutions:**

#### For Mutual Funds

**If you have the AMFI code:**
1. Skip the unmatched row
2. Add manually: Mutual Fund form
3. Enter AMFI code (e.g., `120503`)
4. WealthForge matches automatically

**Find AMFI code:**
- AMFI website: https://www.amfiindia.com/
- Your CAS statement
- AMC website

**If fund is new/unlisted:**
- Contact support to add to database
- Or track as "Other" asset type

#### For Stocks

**If symbol doesn't match:**
- Verify correct NSE/BSE symbol
- Try without suffixes (e.g., `RELIANCE` not `RELIANCE-EQ`)

**If stock is unlisted:**
- Track as "Other" asset type
- Manual valuation

---

### ❌ Error: "Quota exceeded"

**Full error message:**
```
Quota exceeded for quota metric 'GenerateContent requests per minute' and limit 'GenerateContent requests per minute per project' of service 'generativelanguage.googleapis.com'
```

**Cause:** Hit the 15 requests/minute limit.

**Solution:** Wait 60 seconds, then retry. The free tier resets every minute.

---

### ❌ Error: "Network error"

**Full error message:**
```
Failed to fetch
TypeError: NetworkError when attempting to fetch resource
```

**Cause:** No internet connection or firewall blocking Gemini API.

**Solutions:**

1. **Check internet connection**
2. **Check firewall/antivirus**
   - Allow connections to `generativelanguage.googleapis.com`
3. **Try different network**
   - Corporate networks may block AI APIs
4. **Use native import** (works offline)

---

## Debugging Steps

### 1. Check Environment Variables

```bash
# Verify .env file exists
ls -la .env

# Check contents (be careful not to expose key publicly)
cat .env | grep VITE_GEMINI_API_KEY

# Verify in app
# Open browser console in dev mode
# Type: import.meta.env.VITE_GEMINI_API_KEY
# Should show your key (or 'undefined' if not set)
```

### 2. Check Browser Console

Open DevTools (F12) → Console tab

Look for error messages like:
- `API key not valid`
- `Model not found`
- `Rate limit exceeded`

### 3. Check Network Tab

DevTools → Network tab

Look for failed requests to:
- `https://generativelanguage.googleapis.com/...`

Status codes:
- **401** = Invalid API key
- **429** = Rate limit
- **404** = Model not found
- **500** = Server error (retry)

### 4. Test with Minimal Example

Create `test-gemini.html`:

```html
<!DOCTYPE html>
<html>
<body>
<script type="module">
import { GoogleGenerativeAI } from 'https://esm.run/@google/generative-ai';

const API_KEY = 'YOUR_KEY_HERE';
const genAI = new GoogleGenerativeAI(API_KEY);

try {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });
  const result = await model.generateContent('Say hello');
  console.log('Success:', await result.response.text());
} catch (err) {
  console.error('Error:', err.message);
}
</script>
</body>
</html>
```

Open in browser. Check console for errors.

---

## Model Name History

Gemini API has changed model names over time:

| Date | Primary Model Name | Status |
|------|-------------------|--------|
| 2024-02 | `gemini-pro` | ✅ Works |
| 2024-05 | `gemini-1.5-flash` | ✅ Works |
| 2024-12 | `gemini-1.5-flash-latest` | ✅ **Current** |
| Future | TBD | App auto-tries fallbacks |

The app now tries multiple names automatically, so updates to Gemini API shouldn't break functionality.

---

## Still Having Issues?

### Check Status Page
Visit: https://status.cloud.google.com/

Look for:
- "Vertex AI" incidents
- "Gemini API" notices

### Report Bug

If none of the above work:

1. Gather information:
   - Error message (full text)
   - Browser console screenshot
   - Network tab screenshot
   - Steps to reproduce

2. Create issue: https://github.com/Ashhar/WeathForgeAI/issues

3. Include:
   ```
   **Environment:**
   - Browser: Chrome 120
   - OS: Windows 11
   - Mode: Dev / Production
   - API Key: Set / Not set (don't share actual key!)

   **Error:**
   [Paste full error message]

   **Steps:**
   1. Clicked "AI Import"
   2. Uploaded Holdings-2.csv
   3. Got error
   ```

---

## Alternative: Use Native Import

If Gemini API issues persist, you can **always use native import methods**:

### For TickerTape Users
✅ Use built-in TickerTape format support (no API needed)
- Mutual Fund form → "Import statement / CSV"
- Instant, offline, works perfectly

### For Other Brokers
✅ Use standard CSV import
- Format your CSV to match schema
- See required columns in import modal
- No API calls

**Native imports:**
- ✅ No API key required
- ✅ No rate limits
- ✅ Work offline
- ✅ Instant processing
- ✅ 100% reliable

---

**Last Updated:** 2026-08-03  
**Latest Working Model:** `gemini-1.5-flash-latest`  
**App Auto-Fallback:** Enabled in commit `eea0231`
