import dotenv from 'dotenv';
import { Resend } from 'resend';

dotenv.config();

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL;
const RESEND_FROM_NAME = process.env.RESEND_FROM_NAME || 'AFROSTORY';

if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
  console.warn('RESEND_API_KEY / RESEND_FROM_EMAIL not configured; email delivery is disabled');
}

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export function isResendReady() {
  return Boolean(resend && RESEND_FROM_EMAIL);
}

export async function sendTransactionalEmail({ to, subject, html, text }) {
  if (!resend || !RESEND_FROM_EMAIL) {
    throw new Error('CODE READY — REAL CREDENTIAL REQUIRED: set RESEND_API_KEY and a verified RESEND_FROM_EMAIL in your .env before sending OTP emails.');
  }

  const result = await resend.emails.send({
    from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text,
  });

  if (result?.error) {
    throw new Error(result.error.message || 'Resend email delivery failed');
  }

  return result;
}

export async function sendVerificationCodeEmail({ email, code }) {
  return sendTransactionalEmail({
    to: email,
    subject: 'Verify your AFROSTORY account',
    text: `Your AFROSTORY verification code is ${code}. This code expires in 15 minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111;">
        <h2 style="margin-bottom: 12px;">Welcome to AFROSTORY</h2>
        <p>Your verification code is:</p>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 4px; margin: 18px 0;">${code}</p>
        <p>This code expires in 15 minutes.</p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail({ email, code }) {
  return sendTransactionalEmail({
    to: email,
    subject: 'Reset your AFROSTORY password',
    text: `Your AFROSTORY password reset code is ${code}. This code expires in 15 minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111;">
        <h2 style="margin-bottom: 12px;">Reset your password</h2>
        <p>Your AFROSTORY reset code is:</p>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 4px; margin: 18px 0;">${code}</p>
        <p>This code expires in 15 minutes.</p>
      </div>
    `,
  });
}

export { RESEND_API_KEY, RESEND_FROM_EMAIL, RESEND_FROM_NAME };
export default resend;
