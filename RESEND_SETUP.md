# Resend Setup Guide for User Notifications

This guide will walk you through setting up Resend for receiving daily new user registration notifications.

## What is Resend?

Resend is a modern email API built for developers. It's simpler than SendGrid, with:
- ✅ **Free tier:** 100 emails/day, 3,000 emails/month
- ✅ **No credit card required** for free tier
- ✅ **Simple REST API** (no SMTP needed)
- ✅ **Better deliverability** and developer experience

---

## Step 1: Create Resend Account (Already Done)

✅ You've already completed this step!

For reference:
1. Go to [https://resend.com/signup](https://resend.com/signup)
2. Sign up with your email
3. Verify your email address

---

## Step 2: Verify Sender Email (Already Done)

✅ You've already verified `ashhar@gmail.com` as your sender!

For reference, to verify additional emails:
1. Go to Resend dashboard → **Domains** → **Emails**
2. Click **"Add Email"**
3. Enter email address and verify via confirmation link

**Current setup:**
- **Sender:** ashhar@gmail.com
- **Recipient:** ashharn@icloud.com

---

## Step 3: Get API Key (Already Done)

✅ You've already created your Resend API key!

For reference, to create additional keys:
1. In Resend dashboard, go to **API Keys**
2. Click **"Create API Key"**
3. Name: `github-actions-wealthforge`
4. Permissions: **Full Access** or **Sending Access** only
5. Click **"Create"**
6. Copy the API key (starts with `re_`)

⚠️ **Important:** Store it securely - you can only see it once!

---

## Step 4: Add GitHub Secrets

Now add the secrets to your GitHub repository:

1. Go to your GitHub repository: [https://github.com/Ashhar/WeathForgeAI](https://github.com/Ashhar/WeathForgeAI)
2. Click **Settings** tab (top right)
3. In left sidebar, click **Secrets and variables** → **Actions**
4. Click **"New repository secret"** button

### Add or Update these secrets:

#### Secret 1: RESEND_API_KEY (NEW)
- **Name:** `RESEND_API_KEY`
- **Value:** Paste your Resend API key (starts with `re_`)
- Click **"Add secret"**

#### Secret 2: ADMIN_EMAIL (UPDATE if needed)
- **Name:** `ADMIN_EMAIL`
- **Value:** `ashharn@icloud.com`
- Click **"Add secret"** (or update if it already exists)

### Verify existing secrets:

Make sure you already have these (from masters-sync setup):
- ✅ `SUPABASE_URL`
- ✅ `SUPABASE_SERVICE_ROLE_KEY`

If missing, add them from your Supabase project settings.

### Remove old secret:

⚠️ **Optional cleanup:** You can now delete the old `SENDGRID_API_KEY` secret:
1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Find `SENDGRID_API_KEY`
3. Click **"Remove"**

---

## Step 5: Test the Workflow

### Option A: Test Locally First

The check script can run locally (it only checks for users, doesn't send email):

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

## Step 6: Monitor & Verify

### Check workflow runs:
- GitHub repo → **Actions** tab → **"New user notifications"**
- View logs for each daily run
- Green checkmark = success
- Red X = failure (click to see error)

### Check Resend dashboard:
- Resend dashboard → **Logs**
- See all sent emails, delivery status, opens/clicks
- Real-time delivery tracking

### Email will include:
```
Subject: ✨ 1 new user registered - WealthForge AI

Body:
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
1. Check Resend dashboard → **Logs** for delivery status
2. Look for bounces or errors
3. Check spam folder in your email
4. Verify sender email (ashhar@gmail.com) is verified in Resend
5. Check GitHub Actions logs for curl errors

### "Invalid API Key" error?
- API key not copied correctly (must include `re_` prefix)
- Check GitHub secret `RESEND_API_KEY` is set correctly
- Verify key has sending permissions in Resend dashboard

### "Email not verified" error?
- Sender email (ashhar@gmail.com) not verified in Resend
- Check email inbox for verification link from Resend
- Go to Resend → **Domains** → **Emails** to verify

### No email sent, workflow shows "No new users"?
- Expected behavior! Email only sends when users register
- Create a test user in Supabase to trigger notification
- Use manual trigger to test immediately

### curl error in GitHub Actions?
- Check the workflow logs for specific error message
- Verify JSON format in workflow file (no syntax errors)
- Ensure `RESEND_API_KEY` secret exists

---

## Resend Free Tier Limits

✅ **3,000 emails/month** (100/day average)  
✅ **No credit card required**  
✅ **Better deliverability** than SendGrid  
✅ **Simple API** (no SMTP setup needed)

Perfect for user notifications (max 1 email/day = ~30/month).

If you need more emails in the future:
- **$20/month:** 50,000 emails
- **Custom:** Unlimited emails with volume pricing

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

## Advantages of Resend over SendGrid

| Feature | Resend | SendGrid |
|---------|--------|----------|
| **Free tier** | 3,000/month | 100/day (3,000/month) |
| **Setup complexity** | Simple API | SMTP configuration |
| **API simplicity** | RESTful, clean | Complex, legacy |
| **Deliverability** | Excellent | Good |
| **Developer experience** | Modern, fast | Dated interface |
| **Credit card** | Not required | Not required |

---

## Next Steps (Future Enhancements)

Once this is working, you can add:
- 📊 Weekly summary emails (7-day growth metrics)
- 📧 HTML email templates (Resend supports React Email)
- 💬 Slack/Discord webhook notifications
- 📈 User growth charts in email
- 🔔 Real-time notifications (webhooks on Supabase auth trigger)
- 📋 Track notification history in Supabase table

---

## Quick Reference

| Item | Value |
|------|-------|
| **Resend Dashboard** | https://resend.com/dashboard |
| **Resend Docs** | https://resend.com/docs |
| **GitHub Actions** | https://github.com/Ashhar/WeathForgeAI/actions |
| **Workflow File** | `.github/workflows/user-notifications.yml` |
| **Script File** | `scripts/check-new-users.mjs` |
| **Schedule** | Daily 9:00 AM IST (3:30 UTC) |
| **Sender** | ashhar@gmail.com |
| **Recipient** | ashharn@icloud.com |

---

**Questions?** Check GitHub Actions logs or Resend dashboard logs for debugging.
