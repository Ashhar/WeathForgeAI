# SendGrid Setup Guide for User Notifications

This guide will walk you through setting up SendGrid for receiving daily new user registration notifications.

## Step 1: Create SendGrid Account

1. Go to [https://signup.sendgrid.com/](https://signup.sendgrid.com/)
2. Click **"Start for Free"**
3. Fill in your details:
   - Email: `ashharn@icloud.com` (or your preferred email)
   - Password: Create a strong password
   - Click "Create Account"
4. **Verify your email address** (check inbox for verification link)
5. Complete the onboarding questionnaire:
   - **What's your role?** → Developer
   - **What's your primary use case?** → Transactional emails
   - **What programming language?** → Node.js
   - **How many emails per month?** → Less than 10,000
   - Click "Get Started"

---

## Step 2: Verify Sender Identity

SendGrid requires you to verify a sender email address before sending emails.

### Option A: Single Sender Verification (Easiest - Recommended)

1. In SendGrid dashboard, go to **Settings** → **Sender Authentication**
2. Click **"Get Started"** under **Single Sender Verification**
3. Click **"Create New Sender"**
4. Fill in the form:
   - **From Name:** `WealthForge AI Notifications`
   - **From Email Address:** `ashharn@icloud.com` (your iCloud email)
   - **Reply To:** `ashharn@icloud.com`
   - **Company Address:** (your address - required but not shown in emails)
   - **Nickname:** `wealthforge-admin`
5. Click **"Save"**
6. **Check your email** (ashharn@icloud.com) for verification link
7. Click the verification link to confirm

✅ You can now send emails from `ashharn@icloud.com`

### Option B: Domain Authentication (Advanced - Better for production)

If you own a domain (e.g., `wealthforgeai.com`):
1. Go to **Settings** → **Sender Authentication** → **Authenticate Your Domain**
2. Follow DNS setup instructions (adds CNAME records)
3. This allows sending from any email @yourdomain.com

*For now, use Option A (Single Sender) for simplicity.*

---

## Step 3: Create API Key

1. In SendGrid dashboard, go to **Settings** → **API Keys**
2. Click **"Create API Key"** (top right)
3. Fill in details:
   - **API Key Name:** `github-actions-wealthforge`
   - **API Key Permissions:** Select **"Restricted Access"**
   - Expand **"Mail Send"** section
   - Enable **"Mail Send"** toggle (turn it ON)
   - Leave everything else OFF
4. Click **"Create & View"**
5. **COPY THE API KEY NOW** - it looks like:
   ```
   SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
   ⚠️ **Important:** You can only see this once! Save it immediately.
6. Store it temporarily in a secure location (password manager, etc.)

---

## Step 4: Update Workflow File (Optional)

The workflow uses `from: noreply@wealthforgeai.app` as the sender. If you used Single Sender Verification with your iCloud email, update the workflow:

```bash
# Open the workflow file
nano /Volumes/SSD/apps/WeathForgeAI/.github/workflows/user-notifications.yml
```

Change this line:
```yaml
from: noreply@wealthforgeai.app
```

To your verified email:
```yaml
from: ashharn@icloud.com
```

*If you already verified ashharn@icloud.com as a sender, you're good to go!*

---

## Step 5: Add GitHub Secrets

Now add the secrets to your GitHub repository:

1. Go to your GitHub repository: [https://github.com/Ashhar/WeathForgeAI](https://github.com/Ashhar/WeathForgeAI)
2. Click **Settings** tab (top right)
3. In left sidebar, click **Secrets and variables** → **Actions**
4. Click **"New repository secret"** button

### Add these 2 secrets:

#### Secret 1: SENDGRID_API_KEY
- **Name:** `SENDGRID_API_KEY`
- **Value:** Paste the API key you copied (starts with `SG.`)
- Click **"Add secret"**

#### Secret 2: ADMIN_EMAIL
- **Name:** `ADMIN_EMAIL`
- **Value:** `ashharn@icloud.com`
- Click **"Add secret"**

### Verify existing secrets:

Make sure you already have these (from masters-sync setup):
- ✅ `SUPABASE_URL`
- ✅ `SUPABASE_SERVICE_ROLE_KEY`

If missing, add them from your Supabase project settings.

---

## Step 6: Test the Workflow

### Option A: Test Locally First

```bash
cd /Volumes/SSD/apps/WeathForgeAI

# Set environment variables
export SUPABASE_URL="your-supabase-url"
export SUPABASE_SERVICE_ROLE_KEY="your-service-key"

# Run the script
node scripts/check-new-users.mjs
```

Expected output:
- If no new users: "No new user registrations in the last 24 hours"
- If new users: Formatted email body with user details

### Option B: Test via GitHub Actions (Manual Trigger)

1. Go to GitHub repository → **Actions** tab
2. Click **"New user notifications"** workflow (left sidebar)
3. Click **"Run workflow"** dropdown (right side)
4. Select branch: `main`
5. Click green **"Run workflow"** button
6. Wait ~30 seconds, refresh page
7. Click the workflow run to see logs
8. Check your email inbox (ashharn@icloud.com)

---

## Step 7: Monitor & Verify

### Check workflow runs:
- GitHub repo → **Actions** tab → **"New user notifications"**
- View logs for each daily run
- Green checkmark = success
- Red X = failure (click to see error)

### Check SendGrid activity:
- SendGrid dashboard → **Activity** → **Email Activity**
- See all sent emails, delivery status, opens (if tracking enabled)

### Email will include:
```
New user(s) registered in the last 24 hours:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📧 Email: user@example.com
🕐 Registered: Dec 25, 2024, 14:32:18 UTC
✓ Confirmed
Last login: Dec 25, 2024, 14:35:00 UTC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Total new users: 1

---
🤖 Automated by GitHub Actions
Repository: github.com/Ashhar/WeathForgeAI
Timestamp: 2024-12-25T03:30:00.000Z
```

---

## Troubleshooting

### Email not received?
1. Check SendGrid dashboard → Activity → Email Activity
2. Look for bounces or blocks
3. Check spam folder in your email
4. Verify sender email is verified in SendGrid
5. Check GitHub Actions logs for errors

### "Sender identity not verified" error?
- You forgot to verify your sender email in Step 2
- Check email inbox for verification link from SendGrid

### "Invalid API Key" error?
- API key not copied correctly (includes SG. prefix)
- API key doesn't have "Mail Send" permission enabled
- Check GitHub secret `SENDGRID_API_KEY` is set correctly

### No email sent, workflow shows "No new users"?
- Expected behavior! Email only sends when users register
- Create a test user in Supabase to trigger notification
- Use manual trigger to test immediately

---

## SendGrid Free Tier Limits

✅ **100 emails/day** forever free  
✅ No credit card required  
✅ Perfect for user notifications (max 1 email/day)

If you need more emails in the future, upgrade to paid plan or switch to transactional email service.

---

## Schedule

The workflow runs automatically:
- **Daily at 9:00 AM IST** (3:30 UTC)
- Checks last 24 hours for new registrations
- Only sends email if new users found
- Filters out demo account (`demo@wealthforge.ai`)

To change schedule, edit `.github/workflows/user-notifications.yml`:
```yaml
schedule:
  - cron: "30 3 * * *"  # Format: minute hour * * *
```

Cron examples:
- `"0 0 * * *"` = Midnight UTC (5:30 AM IST)
- `"30 15 * * *"` = 9:00 PM IST
- `"0 */6 * * *"` = Every 6 hours

---

## Next Steps (Future Enhancements)

Once this is working, you can add:
- 📊 Weekly summary emails (7-day growth metrics)
- 💬 Slack/Discord webhook notifications
- 📈 User growth charts in email (via charts API)
- 🔔 Real-time notifications (webhooks on Supabase auth trigger)
- 📋 Track notification history in Supabase table

---

## Quick Reference

| Item | Value |
|------|-------|
| **SendGrid Dashboard** | https://app.sendgrid.com/ |
| **GitHub Actions** | https://github.com/Ashhar/WeathForgeAI/actions |
| **Workflow File** | `.github/workflows/user-notifications.yml` |
| **Script File** | `scripts/check-new-users.mjs` |
| **Schedule** | Daily 9:00 AM IST |
| **Recipient** | ashharn@icloud.com |

---

**Questions?** Check GitHub Actions logs or SendGrid Activity dashboard for debugging.
