# Scripts Directory

Automation scripts for WealthForge AI, executed by GitHub Actions workflows.

## Scripts

### `sync-masters.mjs`
**Purpose:** Refresh security master tables (NSE/BSE equity + AMFI mutual funds)  
**Schedule:** Daily at 1:30 AM UTC (7:00 AM IST) via `masters-sync.yml`  
**Secrets:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

Updates public reference tables:
- `equity_master` - Full NSE + BSE equity listings
- `mf_master` - Complete AMFI scheme/NAV dump

---

### `sync-rates.mjs`
**Purpose:** Update FX rates, gold/silver prices, crypto prices  
**Schedule:** Configured in `market-data-sync.yml`  
**Secrets:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

Keeps market data fresh for portfolio valuation.

---

### `sync-equity-ltp.mjs`
**Purpose:** Fetch live stock prices (LTP) for equity holdings  
**Schedule:** Configured in `equity-crypto-sync.yml`  
**Secrets:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

Updates real-time stock prices for user portfolios.

---

### `check-new-users.mjs` ✨ NEW
**Purpose:** Monitor new user registrations and send email notifications  
**Schedule:** Daily at 3:30 AM UTC (9:00 AM IST) via `user-notifications.yml`  
**Secrets:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SENDGRID_API_KEY`, `ADMIN_EMAIL`

Features:
- Queries `auth.users` table for registrations in last 24 hours
- Filters out demo account (`demo@wealthforge.ai`)
- Sends formatted email notification to admin if new users found
- Silent success if no new registrations

**Setup required:** See `SENDGRID_SETUP.md` in repo root.

---

## Local Testing

All scripts can be run locally for testing:

```bash
# Export secrets
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-key"

# Test scripts
node scripts/sync-masters.mjs
node scripts/sync-rates.mjs
node scripts/sync-equity-ltp.mjs
node scripts/check-new-users.mjs
```

---

## Requirements

- Node.js 20+
- Supabase project with migrations applied
- Service role key (bypasses RLS)
- GitHub Actions secrets configured

---

## Adding New Scripts

1. Create script in this directory: `new-script.mjs`
2. Add shebang: `#!/usr/bin/env node`
3. Make executable: `chmod +x scripts/new-script.mjs`
4. Create workflow in `.github/workflows/`
5. Add required secrets to GitHub repo settings
6. Test locally first before deploying
7. Update this README

---

## Monitoring

View all automation runs:
- GitHub repo → **Actions** tab
- Click workflow name to see run history
- Click individual run to see detailed logs
- Green checkmark = success, Red X = failure

---

## Secrets Management

GitHub Secrets (Settings → Secrets and variables → Actions):

| Secret | Used By | Description |
|--------|---------|-------------|
| `SUPABASE_URL` | All scripts | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | All scripts | Admin access to bypass RLS |
| `SENDGRID_API_KEY` | check-new-users | SendGrid API key for emails |
| `ADMIN_EMAIL` | check-new-users | Recipient for notifications |

⚠️ **Never commit secrets to git!** Always use GitHub Actions secrets.

---

## Troubleshooting

### Script fails with "401 Unauthorized"
- Check `SUPABASE_SERVICE_ROLE_KEY` is set correctly in GitHub secrets
- Verify key has admin privileges (not anon key)

### Script fails with "404 Not Found"
- Check `SUPABASE_URL` format: `https://xxx.supabase.co` (no trailing slash)
- Verify migrations are applied (tables exist)

### Email not sent
- Check SendGrid API key is valid
- Verify sender email is verified in SendGrid dashboard
- See `SENDGRID_SETUP.md` for detailed troubleshooting

### Workflow doesn't run on schedule
- GitHub may delay scheduled workflows by 5-15 minutes (normal)
- Use `workflow_dispatch` to trigger manually for testing
- Check Actions tab → workflow name → "Enable workflow" if disabled

---

**Last updated:** 2024-09-22
