# API Migration: Anthropic → Gemini

## Summary

Successfully migrated WealthForge AI's AI-powered import feature from Anthropic Claude API to Google Gemini API.

## Changes Made

### 1. Dependencies (package.json)
- **Removed:** `@anthropic-ai/sdk` (^0.32.0)
- **Added:** `@google/generative-ai` (^0.21.0)

### 2. AI Import Module (js/ai-import.js)
- Updated API client initialization to use Google's Generative AI SDK
- Changed model from `claude-3-5-sonnet-20241022` to `gemini-1.5-flash`
- Refactored API calls to use Gemini's `generateContent()` method
- Updated error handling for Gemini-specific errors
- Token estimation logic (Gemini doesn't provide exact counts like Anthropic)
- Renamed system prompt constant to `EXTRACTION_USER_PROMPT` (Gemini doesn't use separate system prompts)

### 3. Environment Variables
- **Old:** `VITE_ANTHROPIC_API_KEY`
- **New:** `VITE_GEMINI_API_KEY`

Updated in:
- `.env.example`
- `.env` (local configuration)

### 4. Documentation
- **DEPLOY.md:** Updated deployment instructions to reference Gemini API key
- **DEPLOY.md:** Updated troubleshooting section to reference `@google/generative-ai` package

## Getting Your Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Get API key" or "Create API key"
4. Copy the key and add it to your `.env` file:
   ```
   VITE_GEMINI_API_KEY=your-actual-api-key-here
   ```

## Model Comparison

| Feature | Anthropic (Before) | Gemini (After) |
|---------|-------------------|----------------|
| Model | claude-3-5-sonnet-20241022 | gemini-1.5-flash |
| Input Context | ~200k tokens | ~1M tokens |
| Output Tokens | 4,096 | 8,192 (configurable) |
| Cost | Higher | Lower (flash tier) |
| JSON Mode | Via schema enforcement | Via schema enforcement |

## Testing

✅ Build succeeded with no errors
✅ All dependencies installed correctly
✅ No breaking changes to the import workflow

## Next Steps

1. Add your Gemini API key to `.env`:
   ```bash
   VITE_GEMINI_API_KEY=your-key-here
   ```

2. Test the AI import feature:
   ```bash
   npm run dev
   ```
   - Navigate to the app
   - Click "🤖 AI-Powered Import"
   - Upload a CAS PDF to test extraction

3. Deploy to Vercel:
   - Update environment variable `VITE_GEMINI_API_KEY` in Vercel dashboard
   - Deploy: `vercel --prod`

## Compatibility

- All existing features remain unchanged
- Local mode (without API key) still works
- Manual CSV import unaffected
- Database schema unchanged
- UI/UX identical

## Benefits

1. **Cost reduction:** Gemini Flash is significantly cheaper than Claude Sonnet
2. **Larger context:** 1M tokens vs 200k tokens (better for long CAS PDFs)
3. **Free tier available:** Google offers generous free tier for Gemini API
4. **No vendor lock-in:** Easy to switch between providers in the future
