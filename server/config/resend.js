import dotenv from 'dotenv';
import { Resend } from 'resend';

dotenv.config();

// [1] STRUCTURED LOGGING ENGINE (Adapted for ESM)
const logger = { 
    info: (msg, meta = {}) => console.log(JSON.stringify({ level: 'info', timestamp: new Date().toISOString(), message: msg, ...meta })),
    error: (msg, err, meta = {}) => console.error(JSON.stringify({ level: 'error', timestamp: new Date().toISOString(), message: msg, error: err?.message || err, ...meta }))
};

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

// [2] TEXT SANITIZATION (XSS Protection for Email Clients)
const sanitizeText = (str) => str ? String(str).replace(/[<>]/g, '').trim() : '';

// [3] EXTERNAL API RETRY ENGINE (Network Resilience)
async function withRetry(fn, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try { return await fn(); } 
        catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(r => setTimeout(r, 1000 * (i + 1))); 
        }
    }
}

// ============================================================================
// TEMPLATE 1: REGISTRATION (WELCOMING & PREMIUM)
// ============================================================================
function getRegistrationHTML(otp) {
    const safeHighlight = sanitizeText(otp);

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;800&display=swap');
        </style>
    </head>
    <body style="margin: 0; padding: 20px; background-color: #f4f4f5; font-family: 'Montserrat', Arial, sans-serif;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; margin: 0 auto; background-color: #ffffff; border-top: 5px solid #2563eb; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05);">
            <tr>
                <td align="center" style="padding: 30px 20px; background-color: #ffffff; border-bottom: 1px solid #f0f0f0;">
                    <h1 style="margin: 0; color: #111111; font-weight: 800; letter-spacing: 2px; font-size: 24px;">Welcome to AFROSTORY</h1>
                    <p style="margin: 8px 0 0 0; color: #666666; font-size: 11px; letter-spacing: 2px; text-transform: uppercase;">Community Registration</p>
                </td>
            </tr>
            <tr>
                <td align="center" style="padding: 40px 30px;">
                    <h3 style="color: #333333; margin-top: 0; margin-bottom: 15px; font-weight: 600; font-size: 16px;">Verify Your Email</h3>
                    <p style="color: #555555; font-size: 14px; line-height: 1.6; margin-bottom: 30px;">
                        Thank you for joining AFROSTORY. To complete your account setup and join the community, please use the verification code below.
                    </p>
                    
                    <!-- 🛠️ MOBILE FIX: white-space: nowrap and adjusted sizing -->
                    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px 10px; width: 100%; max-width: 280px; margin: 0 auto; text-align: center;">
                        <p style="color: #64748b; font-size: 10px; margin: 0 0 8px 0; text-transform: uppercase; font-weight: 700; letter-spacing: 1px;">Verification Code</p>
                        <h1 style="margin: 0; font-size: 32px; letter-spacing: 6px; color: #0f172a; font-weight: 800; white-space: nowrap; user-select: all; -webkit-user-select: all; cursor: pointer;">
                            ${safeHighlight}
                        </h1>
                    </div>

                    <p style="color: #888888; font-size: 12px; line-height: 1.5; margin-top: 30px;">
                        This code is valid for <strong>15 minutes</strong>.<br>
                        If you did not request this email, please safely ignore it.
                    </p>
                </td>
            </tr>
            <!-- 🛡️ ANTI-SPAM FOOTER -->
            <tr>
                <td align="center" style="padding: 20px; background-color: #f8fafc; border-top: 1px solid #e2e8f0;">
                    <p style="color: #94a3b8; font-size: 10px; margin: 0 0 10px 0; font-weight: 600;">
                        This message was sent to you because you requested to register on AFROSTORY.
                    </p>
                    <p style="color: #94a3b8; font-size: 10px; margin: 0; font-weight: 600;">
                        &copy; ${new Date().getFullYear()} AFROSTORY.<br>
                        [INSERT YOUR CITY/STATE HERE]
                    </p>
                </td>
            </tr>
        </table>
    </body>
    </html>
    `;
}

// ============================================================================
// TEMPLATE 2: PASSWORD RESET (SECURITY-FOCUSED, DARK MODE)
// ============================================================================
function getResetHTML(otp) {
    const safeHighlight = sanitizeText(otp);

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;800&display=swap');
        </style>
    </head>
    <body style="margin: 0; padding: 20px; background-color: #050505; font-family: 'Montserrat', Arial, sans-serif;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; margin: 0 auto; background-color: #0a0a0a; border: 2px solid #ef4444; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.8);">
            <tr>
                <td align="center" style="padding: 30px 20px; border-bottom: 1px solid #1f1f1f; background: linear-gradient(180deg, #111111 0%, #0a0a0a 100%);">
                    <h1 style="margin: 0; color: #ef4444; font-weight: 900; letter-spacing: 4px; font-size: 22px;">AFROSTORY SECURITY</h1>
                    <p style="margin: 8px 0 0 0; color: #888888; font-size: 10px; letter-spacing: 3px; text-transform: uppercase; font-weight: 600;">Vault Override Request</p>
                </td>
            </tr>
            <tr>
                <td align="center" style="padding: 40px 30px;">
                    <h3 style="color: #ffffff; margin-top: 0; margin-bottom: 20px; font-weight: 700; text-transform: uppercase; font-size: 15px; letter-spacing: 1px;">Password Reset</h3>
                    <p style="color: #cccccc; font-size: 14px; line-height: 1.7; margin-bottom: 35px; font-weight: 500;">
                        A request was made to override your account security. Use the secure code below to authorize the password reset.
                    </p>
                    
                    <!-- 🛠️ MOBILE FIX: white-space: nowrap and adjusted sizing -->
                    <div style="background-color: #000000; border: 1px dashed #ef4444; border-radius: 8px; padding: 25px 10px; width: 100%; max-width: 280px; margin: 0 auto; text-align: center; box-shadow: inset 0 0 15px rgba(239, 68, 68, 0.05);">
                        <p style="color: #ef4444; font-size: 10px; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 2px; font-weight: 700;">Secure Auth Code</p>
                        <h1 style="margin: 0; font-size: 32px; letter-spacing: 6px; color: #ffffff; font-weight: 900; white-space: nowrap; user-select: all; -webkit-user-select: all; cursor: pointer;">
                            ${safeHighlight}
                        </h1>
                    </div>

                    <p style="color: #888888; font-size: 11px; line-height: 1.6; margin-top: 40px; font-weight: 600;">
                        <span style="color: #ef4444;">SECURITY ALERT:</span> This code expires in 15 minutes.<br>
                        If you did not initiate this request, change your password immediately.
                    </p>
                </td>
            </tr>
            <!-- 🛡️ ANTI-SPAM FOOTER -->
            <tr>
                <td align="center" style="padding: 20px; background-color: #050505; border-top: 1px solid #1a1a1a;">
                    <p style="color: #444444; font-size: 9px; margin: 0 0 10px 0; font-weight: 800; letter-spacing: 1px;">
                        You received this because a password reset was requested for your account.
                    </p>
                    <p style="color: #444444; font-size: 9px; margin: 0; font-weight: 800; letter-spacing: 1px;">
                        SYSTEM MONITORED BY AFROSTORY<br>
                        [MARKUDI BEHIND OlD ASSEMBLY QUARTERS]
                    </p>
                </td>
            </tr>
        </table>
    </body>
    </html>
    `;
}

// ============================================================================
// EMAIL SENDING FUNCTIONS (FAULT TOLERANT)
// ============================================================================

export async function sendVerificationCodeEmail({ email, code }) {
    if (!resend || !RESEND_FROM_EMAIL) {
        throw new Error('CODE READY — REAL CREDENTIAL REQUIRED: set RESEND_API_KEY in your .env');
    }
    
    const safeEmail = sanitizeText(email);
    try {
        await withRetry(() => resend.emails.send({
            from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`,
            to: safeEmail,
            subject: 'Welcome to AFROSTORY - Verification Code',
            html: getRegistrationHTML(code),
            text: `Welcome to AFROSTORY. Your community registration verification code is: ${code}. This code expires in 15 minutes. If you did not request this, please ignore this email.` // 🛡️ CRITICAL SPAM FIX
        }));
        logger.info(`[EMAIL] OTP sent successfully to ${safeEmail}`);
        return true;
    } catch (error) {
        logger.error(`[EMAIL ERROR] Failed to send OTP to ${safeEmail}`, error);
        throw new Error('Email gateway failed to deliver the verification code.');
    }
}

export async function sendPasswordResetEmail({ email, code }) {
    if (!resend || !RESEND_FROM_EMAIL) {
        throw new Error('CODE READY — REAL CREDENTIAL REQUIRED: set RESEND_API_KEY in your .env');
    }

    const safeEmail = sanitizeText(email);
    try {
        await withRetry(() => resend.emails.send({
            from: `${RESEND_FROM_NAME} SECURITY <${RESEND_FROM_EMAIL}>`,
            to: safeEmail,
            subject: 'Security Alert: Password Reset Requested',
            html: getResetHTML(code),
            text: `AFROSTORY Security Alert. A password reset was requested. Your secure auth code is: ${code}. This code expires in 15 minutes. If you did not request this, secure your account immediately.` // 🛡️ CRITICAL SPAM FIX
        }));
        logger.info(`[EMAIL] Password reset OTP sent to ${safeEmail}`);
        return true;
    } catch (error) {
        logger.error(`[EMAIL ERROR] Failed to send Password Reset to ${safeEmail}`, error);
        throw new Error('Email gateway failed to deliver the password reset code.');
    }
}
