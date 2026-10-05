#!/usr/bin/env node
/* ============================================================
   WealthForge AI — Email sender via Resend API
   Sends email notification using Resend API with proper
   JSON handling for special characters and newlines.

   Env: RESEND_API_KEY, ADMIN_EMAIL, EMAIL_SUBJECT, EMAIL_BODY
   ============================================================ */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const EMAIL_SUBJECT = process.env.EMAIL_SUBJECT;
const EMAIL_BODY = process.env.EMAIL_BODY;

if (!RESEND_API_KEY || !ADMIN_EMAIL || !EMAIL_SUBJECT || !EMAIL_BODY) {
  console.error('❌ Missing required environment variables');
  console.error('Required: RESEND_API_KEY, ADMIN_EMAIL, EMAIL_SUBJECT, EMAIL_BODY');
  process.exit(1);
}

async function sendEmail() {
  try {
    console.log('📧 Sending email via Resend API...');
    console.log(`To: ${ADMIN_EMAIL}`);
    console.log(`Subject: ${EMAIL_SUBJECT}`);
    console.log('');

    const payload = {
      from: 'WealthForge AI <onboarding@resend.dev>',
      to: [ADMIN_EMAIL],
      subject: EMAIL_SUBJECT,
      text: EMAIL_BODY
    };

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Failed to send email');
      console.error(`Status: ${response.status}`);
      console.error('Response:', JSON.stringify(data, null, 2));
      process.exit(1);
    }

    console.log('✅ Email sent successfully!');
    console.log('Email ID:', data.id);
    console.log('');
    console.log('Check Resend dashboard for delivery status:');
    console.log('https://resend.com/emails/' + data.id);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error sending email:', error.message);
    process.exit(1);
  }
}

sendEmail();
