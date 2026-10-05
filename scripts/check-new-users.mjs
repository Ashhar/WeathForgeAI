#!/usr/bin/env node
/* ============================================================
   WealthForge AI — new user registration checker
   Queries Supabase auth.users for registrations in the last
   24 hours and outputs formatted data for email notification.
   Run daily by .github/workflows/user-notifications.yml.

   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
   ============================================================ */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('check-new-users: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

async function checkNewUsers() {
  try {
    console.log('🔍 Checking for new user registrations in the last 24 hours...\n');

    // Query auth.users for registrations in last 24 hours
    // Filter out demo account
    const query = `created_at.gte.${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}`;

    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?${query}`, {
      method: 'GET',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch users: HTTP ${res.status}`);
    }

    const data = await res.json();
    const users = data.users || [];

    // Filter out demo account
    const newUsers = users.filter(u =>
      u.email && !u.email.includes('demo@wealthforge.ai')
    );

    if (newUsers.length === 0) {
      console.log('✓ No new user registrations in the last 24 hours.');
      console.log('\nNo email notification needed.');
      process.exit(0);
    }

    console.log(`✨ Found ${newUsers.length} new user(s):\n`);

    // Format user data for email
    const emailBody = formatEmailBody(newUsers);
    const emailSubject = `✨ ${newUsers.length} new user${newUsers.length > 1 ? 's' : ''} registered - WealthForge AI`;

    // Output for GitHub Actions (these will be captured and used in email step)
    console.log('EMAIL_SUBJECT=' + emailSubject);
    console.log('USER_COUNT=' + newUsers.length);
    console.log('\n--- EMAIL BODY ---');
    console.log(emailBody);
    console.log('--- END EMAIL BODY ---\n');

    // Write to GitHub Actions output file if available
    const outputFile = process.env.GITHUB_OUTPUT;
    if (outputFile) {
      const fs = await import('fs');
      const output = [
        `has_new_users=true`,
        `user_count=${newUsers.length}`,
        `email_subject=${emailSubject}`,
        `email_body<<EOF`,
        emailBody,
        `EOF`
      ].join('\n');
      fs.appendFileSync(outputFile, output + '\n');
      console.log('✓ Output written to GITHUB_OUTPUT');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error checking new users:', error.message);
    process.exit(1);
  }
}

function formatEmailBody(users) {
  const lines = [
    `New user(s) registered in the last 24 hours:`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
  ];

  users.forEach(user => {
    const createdAt = new Date(user.created_at).toLocaleString('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    const confirmed = user.email_confirmed_at ? '✓ Confirmed' : '⏳ Pending confirmation';
    const lastSignIn = user.last_sign_in_at
      ? `Last login: ${new Date(user.last_sign_in_at).toLocaleString('en-US', { timeZone: 'UTC' })}`
      : 'Never logged in';

    lines.push(
      `📧 Email: ${user.email}`,
      `🕐 Registered: ${createdAt} UTC`,
      `${confirmed}`,
      `${lastSignIn}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    );
  });

  lines.push(
    ``,
    `Total new users: ${users.length}`,
    ``,
    `---`,
    `🤖 Automated by GitHub Actions`,
    `Repository: github.com/Ashhar/WeathForgeAI`,
    `Timestamp: ${new Date().toISOString()}`
  );

  return lines.join('\n');
}

checkNewUsers();
