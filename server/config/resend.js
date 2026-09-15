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

// 🛡️ Added a professional footer to satisfy Spam Filters
const emailFooter = `
  <br><br>
  <hr style="border: none; border-top: 1px solid #eaeaea; margin: 20px 0;">
  <p style="font-size: 12px; color: #666; text-align: center;">
    You received this email because you registered or requested a password reset on AFROSTORY.<br>
    If you did not make this request, please safely ignore and delete this email.<br><br>
    &copy; ${new Date().getFullYear()} AFROSTORY. All rights reserved.
  </p>
`;

export async function sendVerificationCodeEmail({ email, code }) {
  return sendTransactionalEmail({
    to: email,
    subject: 'Welcome to AFROSTORY - Verify your account',
    text: `Welcome to AFROSTORY! Your verification code is ${code}. This code expires in 15 minutes. If you did not request this, please ignore this email.`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #eaeaea; border-radius: 8px;">
        <h2 style="color: #1a1a1a; margin-bottom: 16px;">Welcome to AFROSTORY! 🌍</h2>
        <p style="font-size: 16px;">Hello,</p>
        <p style="font-size: 16px;">Thank you for joining our community. To complete your registration and secure your account, please use the verification code below:</p>
        <div style="background-color: #f4f4f5; padding: 24px; border-radius: 8px; text-align: center; margin: 24px 0;">
          <p style="font-size: 36px; font-weight: 700; letter-spacing: 6px; margin: 0; color: #000;">${code}</p>
        </div>
        <p style="font-size: 16px;">This code will expire in <strong>15 minutes</strong>.</p>
        ${emailFooter}
      </div>
    `,
  });
}

export async function sendPasswordResetEmail({ email, code }) {
  return sendTransactionalEmail({
    to: email,
    subject: 'AFROSTORY - Reset Your Password',
    text: `AFROSTORY Password Reset. Your code is ${code}. This code expires in 15 minutes. If you did not request this, please ignore this email.`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #eaeaea; border-radius: 8px;">
        <h2 style="color: #1a1a1a; margin-bottom: 16px;">Password Reset Request 🔒</h2>
        <p style="font-size: 16px;">Hello,</p>
        <p style="font-size: 16px;">We received a request to reset the password for your AFROSTORY account. Use the code below to proceed:</p>
        <div style="background-color: #f4f4f5; padding: 24px; border-radius: 8px; text-align: center; margin: 24px 0;">
          <p style="font-size: 36px; font-weight: 700; letter-spacing: 6px; margin: 0; color: #000;">${code}</p>
        </div>
        <p style="font-size: 16px;">This code will expire in <strong>15 minutes</strong>.</p>
        ${emailFooter}
      </div>
    `,
  });
}

export { RESEND_API_KEY, RESEND_FROM_EMAIL, RESEND_FROM_NAME };
export default resend;
