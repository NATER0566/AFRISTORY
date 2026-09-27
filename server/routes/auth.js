import crypto from 'node:crypto';
import axios from 'axios';
import User from '../models/User.js';
import Wallet from '../models/Wallet.js';
import { verifyAuth, generateToken, authCookieOptions } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { isValidEmail, isValidUsername } from '../utils/helpers.js';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { sendVerificationCodeEmail, sendPasswordResetEmail, isResendReady } from '../config/resend.js';

const generateCode = () => String(Math.floor(100000 + Math.random() * 900000));
const codeExpiry = (minutes) => new Date(Date.now() + minutes * 60 * 1000);

const serverUrl = process.env.NODE_ENV === 'production' 
  ? 'https://afristory.onrender.com' 
  : 'http://localhost:3000';

const oauthCallback = provider => `${serverUrl}/api/auth/${provider}/callback`;

const oauthError = (reply, message) => reply.redirect(`/?authError=${encodeURIComponent(message)}`);
const createState = () => crypto.randomBytes(24).toString('hex');
const createCodeVerifier = () => crypto.randomBytes(32).toString('base64url');
const createCodeChallenge = verifier => crypto.createHash('sha256').update(verifier).digest('base64url');

// FIX: Reverted to adaptive secure cookies. Hardcoding secure: true breaks GitHub on localhost/HTTP environments.
const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 600, path: '/' };

const googleJWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const appleJWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

function appleClientSecret() {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: process.env.APPLE_KEY_ID, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: process.env.APPLE_TEAM_ID,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400 * 180,
    aud: 'https://appleid.apple.com',
    sub: process.env.APPLE_CLIENT_ID,
  })).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const signer = crypto.createSign('SHA256');
  signer.update(unsigned);
  return `${unsigned}.${signer.sign({ key: process.env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'), dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

function providerConfig(provider) {
  const configs = {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
      scope: 'openid email profile',
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      authorization: 'https://github.com/login/oauth/authorize',
      token: 'https://github.com/login/oauth/access_token',
      scope: 'read:user user:email',
    },
    apple: {
      clientId: process.env.APPLE_CLIENT_ID,
      clientSecret: process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY ? appleClientSecret() : null,
      authorization: 'https://appleid.apple.com/auth/authorize',
      token: 'https://appleid.apple.com/auth/token',
      scope: 'name email',
    },
  };
  return configs[provider];
}

function providerField(provider) {
  return { google: 'googleId', github: 'githubId', apple: 'appleSub' }[provider];
}

async function findOrCreateSocialUser(provider, profile) {
  const field = providerField(provider);
  if (!field || !profile.providerId) throw new Error('Provider identity is incomplete');
  let user = await User.findOne({ [`authProviders.${field}`]: profile.providerId });
  if (!user && profile.email && profile.emailVerified) user = await User.findOne({ email: profile.email.toLowerCase() });
  if (!user && !profile.email) throw new Error('The provider did not return an email address');
  if (!user) {
    const baseUsername = (profile.name || profile.email.split('@')[0]).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24) || 'storyteller';
    let username = baseUsername;
    let suffix = 1;
    while (await User.exists({ username })) username = `${baseUsername.slice(0, 28 - String(suffix).length)}${suffix++}`;
    user = new User({
      username,
      email: profile.email.toLowerCase(),
      passwordHash: null,
      authProviders: { [field]: profile.providerId },
      isVerified: true,
      profile: { displayName: profile.name || '' },
      profileImage: profile.picture || null,
      lastLogin: new Date(),
    });
    await user.save();
    await Wallet.create({ userId: user._id });
  } else {
    user.authProviders = { ...(user.authProviders?.toObject?.() || user.authProviders || {}), [field]: profile.providerId };
    user.isVerified = true;
    user.lastLogin = new Date();
    if (profile.picture && !user.profileImage) user.profileImage = profile.picture;
    await user.save();
  }
  return user;
}

async function verifyGoogleIdentity(tokenResponse, clientId) {
  if (!tokenResponse.data.id_token) throw new Error('Google did not return an ID token');
  const { payload } = await jwtVerify(tokenResponse.data.id_token, googleJWKS, { issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: clientId });
  if (!payload.sub || payload.email_verified !== true || !payload.email) throw new Error('Google identity is not verified');
  return { providerId: payload.sub, email: payload.email, emailVerified: true, name: payload.name, picture: payload.picture };
}

async function verifyAppleIdentity(idToken, clientId, nonce) {
  const { payload } = await jwtVerify(idToken, appleJWKS, { issuer: 'https://appleid.apple.com', audience: clientId });
  if (!payload.sub || !payload.email || payload.email_verified !== true || payload.nonce !== nonce) throw new Error('Apple identity is not verified');
  return { providerId: payload.sub, email: payload.email, emailVerified: true, name: payload.email.split('@')[0] };
}

export default async function authRoutes(fastify, opts) {
  // ============================================================================
  // REGISTRATION & LOGIN (With Strict Validation & Explicit Messaging)
  // ============================================================================
  fastify.post('/register', async (request, reply) => {
    try {
      const { username, email, password, confirmPassword } = request.body || {};
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

      if (!username) {
        fastify.log.warn(`[REGISTER_VALIDATION_ERROR] Missing username`);
        return sendError(reply, 'Username is required. Please type a username.', 400);
      }
      if (username.length < 3) {
        fastify.log.warn(`[REGISTER_VALIDATION_ERROR] Username too short: ${username}`);
        return sendError(reply, 'Username must be at least 3 characters long.', 400);
      }
      if (username.length > 30) {
        fastify.log.warn(`[REGISTER_VALIDATION_ERROR] Username too long: ${username}`);
        return sendError(reply, 'Username cannot exceed 30 characters.', 400);
      }
      if (!isValidUsername(username)) {
        fastify.log.warn(`[REGISTER_VALIDATION_ERROR] Invalid username format: ${username}`);
        return sendError(reply, 'Username can only contain letters, numbers, and underscores (no spaces or special characters).', 400);
      }
      
      if (!email) {
        fastify.log.warn(`[REGISTER_VALIDATION_ERROR] Missing email`);
        return sendError(reply, 'Email address is required. Please type your email.', 400);
      }
      if (!isValidEmail(normalizedEmail)) {
        fastify.log.warn(`[REGISTER_VALIDATION_ERROR] Invalid email format: ${normalizedEmail}`);
        return sendError(reply, 'Please enter a valid email address (e.g., name@example.com).', 400);
      }
      
      if (!password) {
        fastify.log.warn(`[REGISTER_VALIDATION_ERROR] Missing password`);
        return sendError(reply, 'Password is required. Please type a password.', 400);
      }
      if (password.length < 8) {
        fastify.log.warn(`[REGISTER_VALIDATION_ERROR] Password too short for email: ${normalizedEmail}`);
        return sendError(reply, 'Password must be at least 8 characters long for your security.', 400);
      }
      
      if (confirmPassword !== undefined && password !== confirmPassword) {
        fastify.log.warn(`[REGISTER_VALIDATION_ERROR] Passwords do not match for email: ${normalizedEmail}`);
        return sendError(reply, 'Passwords do not match. Please type them exactly the same.', 400);
      }
      
      if (!isResendReady()) {
        fastify.log.error(`[REGISTER_CONFIG_ERROR] User ${normalizedEmail} attempted to register but Resend is not configured.`);
        return sendError(reply, 'System Configuration Error: Email delivery is not configured on the server. Registration halted.', 503);
      }

      const existingUser = await User.findOne({ $or: [{ email: normalizedEmail }, { username }] });
      if (existingUser) {
        if (existingUser.email === normalizedEmail) {
          fastify.log.warn(`[REGISTER_CONFLICT] Email already exists: ${normalizedEmail}`);
          return sendError(reply, 'An account with this email address already exists. Please log in instead.', 409);
        }
        fastify.log.warn(`[REGISTER_CONFLICT] Username already taken: ${username}`);
        return sendError(reply, 'This username is already taken. Please choose another one.', 409);
      }

      const newUser = new User({
        username,
        email: normalizedEmail,
        passwordHash: password,
        role: 'USER',
        isVerified: false,
        verificationCode: generateCode(),
        verificationCodeExpires: codeExpiry(15),
      });

      await newUser.save();
      
      try {
        await sendVerificationCodeEmail({ email: newUser.email, code: newUser.verificationCode });
        fastify.log.info(`[REGISTER_EMAIL_SENT] Verification code sent to ${newUser.email}`);
      } catch (emailError) {
        fastify.log.error(`[REGISTER_EMAIL_ERROR] Failed to send verification email to ${newUser.email}. Details: ${emailError.message}`);
        return sendError(reply, 'Account created, but the verification email failed to send. Please try logging in to request a new code.', 503);
      }

      await Wallet.create({ userId: newUser._id });

      fastify.log.info(`[REGISTER_SUCCESS] User created successfully, awaiting verification: ${newUser.email}`);
      return sendSuccess(reply, { userId: newUser._id, username: newUser.username, email: newUser.email, role: newUser.role }, 'Registration successful! A verification code has been sent to your email.', 201);
    } catch (error) {
      fastify.log.error(`[REGISTER_CRITICAL_ERROR] Details: ${error.message}\nStack: ${error.stack}`);
      return sendError(reply, 'Registration failed due to a server error. Please try again.', 500, error.message);
    }
  });

  fastify.post('/login', async (request, reply) => {
    try {
      const { email, password } = request.body || {};
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

      if (!email) return sendError(reply, 'Please provide your email address to log in.', 400);
      if (!password) return sendError(reply, 'Please provide your password to log in.', 400);
      
      const user = await User.findOne({ email: normalizedEmail });
      if (!user) {
        fastify.log.warn(`[LOGIN_EMAIL_NOT_FOUND] Attempted login with non-existent email: ${normalizedEmail}`);
        return sendError(reply, 'No account found with this email address. Please register first.', 404);
      }
      
      const passwordMatch = await user.comparePassword(password);
      if (!passwordMatch) {
        fastify.log.warn(`[LOGIN_INVALID_PASSWORD] Wrong password entered for email: ${normalizedEmail}`);
        return sendError(reply, 'Incorrect password. Please try again.', 401);
      }
      
      if (!user.isActive) {
        fastify.log.warn(`[LOGIN_DEACTIVATED] Deactivated account attempted login: ${normalizedEmail}`);
        return sendError(reply, 'Your account has been deactivated. Please contact support.', 403);
      }

      if (!user.isVerified) {
        fastify.log.warn(`[LOGIN_UNVERIFIED] Unverified user logged in: ${normalizedEmail}. Routing to OTP.`);
        if (!isResendReady()) {
          fastify.log.error(`[LOGIN_CONFIG_ERROR] Cannot send OTP to ${normalizedEmail} because Resend is not configured.`);
          return sendError(reply, 'Email delivery is not configured on the server.', 503);
        }
        
        user.verificationCode = generateCode();
        user.verificationCodeExpires = codeExpiry(15);
        await user.save();
        try {
          await sendVerificationCodeEmail({ email: user.email, code: user.verificationCode });
          fastify.log.info(`[LOGIN_OTP_SENT] New verification code sent to ${user.email}`);
        } catch (emailError) {
          fastify.log.error(`[LOGIN_OTP_ERROR] Failed to send verification email to ${user.email}. Details: ${emailError.message}`);
          return sendError(reply, 'Verification email failed to send.', 503);
        }
        return reply.status(403).send({ success: false, code: 'UNVERIFIED', message: 'Please verify your email before logging in. A new code has been sent.' });
      }

      user.lastLogin = new Date();
      await user.save();

      const token = generateToken(user._id);
      reply.setCookie('token', token, authCookieOptions);
      
      fastify.log.info(`[LOGIN_SUCCESS] User logged in securely: ${user.email}`);
      return sendSuccess(reply, { userId: user._id, username: user.username, email: user.email, role: user.role }, 'Login successful! Welcome back.');
    } catch (error) {
      fastify.log.error(`[LOGIN_CRITICAL_ERROR] Details: ${error.message}\nStack: ${error.stack}`);
      return sendError(reply, 'Login failed due to a server error.', 500, error.message);
    }
  });

  fastify.post('/logout', async (request, reply) => {
    reply.clearCookie('token');
    fastify.log.info(`[LOGOUT_SUCCESS] User logged out.`);
    return sendSuccess(reply, null, 'Logout successful');
  });

  // ============================================================================
  // OTP VERIFICATION & PASSWORD RESET 
  // ============================================================================
  
  fastify.post('/verify-email', async (request, reply) => {
    try {
      const { email, code } = request.body || {};
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
      
      if (!email) return sendError(reply, 'Email address is required for verification.', 400);
      if (!code) return sendError(reply, 'Verification code is required.', 400);

      const user = await User.findOne({ email: normalizedEmail });

      if (!user) {
        fastify.log.warn(`[VERIFY_ERROR] Attempted to verify non-existent email: ${normalizedEmail}`);
        return sendError(reply, 'Invalid request. This email is not registered.', 400);
      }

      if (user.isVerified) {
        fastify.log.info(`[VERIFY_INFO] Already verified email attempted verification: ${normalizedEmail}`);
        return sendError(reply, 'Your account is already verified. You can log in.', 400);
      }

      if (user.verificationCode !== String(code) || !user.verificationCodeExpires || user.verificationCodeExpires <= new Date()) {
        fastify.log.warn(`[VERIFY_INVALID_CODE] Failed attempt for ${normalizedEmail}. Provided: ${code}, Expected: ${user.verificationCode}`);
        return sendError(reply, 'Invalid or expired verification code. Please request a new one.', 400);
      }

      user.isVerified = true;
      user.verificationCode = null;
      user.verificationCodeExpires = null;
      await user.save();

      const token = generateToken(user._id);
      reply.setCookie('token', token, authCookieOptions);
      
      fastify.log.info(`[VERIFY_SUCCESS] User ${normalizedEmail} successfully verified their email.`);
      return sendSuccess(reply, null, 'Email verified successfully! Welcome to AfriStory.');
    } catch (error) {
      fastify.log.error(`[VERIFY_CRITICAL_ERROR] Details: ${error.message}\nStack: ${error.stack}`);
      return sendError(reply, 'Failed to verify email due to a server error.', 500, error.message);
    }
  });

  fastify.post('/resend-otp', async (request, reply) => {
    try {
      const { email } = request.body || {};
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
      
      if (!email) return sendError(reply, 'Email address is required.', 400);

      const user = await User.findOne({ email: normalizedEmail });
      if (!user) {
        fastify.log.warn(`[RESEND_NOT_FOUND] OTP resend requested for non-existent email: ${normalizedEmail}`);
        return sendError(reply, 'This email is not registered in our system.', 404);
      }
      if (user.isVerified) {
        fastify.log.info(`[RESEND_ALREADY_VERIFIED] OTP resend requested for verified email: ${normalizedEmail}`);
        return sendError(reply, 'Your account is already verified. You can log in.', 400);
      }
      
      if (!isResendReady()) {
        fastify.log.error(`[RESEND_CONFIG_ERROR] Cannot resend OTP to ${normalizedEmail}. Resend not configured.`);
        return sendError(reply, 'Email delivery is not configured on the server.', 503);
      }

      user.verificationCode = generateCode();
      user.verificationCodeExpires = codeExpiry(15);
      await user.save();
      
      try {
        await sendVerificationCodeEmail({ email: user.email, code: user.verificationCode });
        fastify.log.info(`[RESEND_SUCCESS] New OTP sent to ${user.email}`);
      } catch (emailError) {
        fastify.log.error(`[RESEND_EMAIL_ERROR] Failed to resend OTP to ${user.email}. Details: ${emailError.message}`);
        return sendError(reply, 'Failed to send verification email.', 503);
      }
      return sendSuccess(reply, null, 'A new verification code has been sent to your email.');
    } catch (error) {
      fastify.log.error(`[RESEND_CRITICAL_ERROR] Details: ${error.message}\nStack: ${error.stack}`);
      return sendError(reply, 'Failed to resend verification code', 500, error.message);
    }
  });

  fastify.post('/forgot-password', async (request, reply) => {
    try {
      const { email } = request.body || {};
      if (!email) return sendError(reply, 'Email address is required.', 400);

      const user = await User.findOne({ email: email.trim().toLowerCase() });
      if (!user) {
        fastify.log.warn(`[FORGOT_PW_NOT_FOUND] Reset requested for non-existent email: ${email}`);
        return sendError(reply, 'This email is not registered in our system.', 404);
      }

      if (!isResendReady()) {
        fastify.log.error(`[FORGOT_PW_CONFIG_ERROR] Cannot send reset code to ${user.email}. Resend not configured.`);
        return sendError(reply, 'Email delivery is not configured on the server.', 503);
      }

      user.resetPasswordCode = generateCode();
      user.resetPasswordExpires = codeExpiry(15);
      await user.save();
      
      try {
        await sendPasswordResetEmail({ email: user.email, code: user.resetPasswordCode });
        fastify.log.info(`[FORGOT_PW_SUCCESS] Password reset OTP sent to ${user.email}`);
      } catch (emailError) {
        fastify.log.error(`[FORGOT_PW_EMAIL_ERROR] Failed to send reset email to ${user.email}. Details: ${emailError.message}`);
        return sendError(reply, 'Failed to send password reset email.', 503);
      }
      return sendSuccess(reply, null, 'Password reset OTP sent to your email successfully.', 200);
    } catch (error) {
      fastify.log.error(`[FORGOT_PW_CRITICAL_ERROR] Details: ${error.message}\nStack: ${error.stack}`);
      return sendError(reply, 'Failed to process password reset request', 500, error.message);
    }
  });

  fastify.post('/reset-password', async (request, reply) => {
    try {
      const { email, code, newPassword } = request.body || {};
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
      
      if (!email) return sendError(reply, 'Email address is required.', 400);
      if (!code) return sendError(reply, 'Reset code is required.', 400);
      if (!newPassword) return sendError(reply, 'New password is required.', 400);
      if (newPassword.length < 8) return sendError(reply, 'New password must be at least 8 characters long.', 400);

      const user = await User.findOne({ email: normalizedEmail });

      if (!user || user.resetPasswordCode !== String(code) || !user.resetPasswordExpires || user.resetPasswordExpires <= new Date()) {
        fastify.log.warn(`[RESET_PW_INVALID_CODE] Failed reset for ${normalizedEmail}. Provided code: ${code}`);
        return sendError(reply, 'Invalid or expired reset code. Please request a new password reset OTP.', 400);
      }

      user.passwordHash = newPassword;
      user.resetPasswordCode = null;
      user.resetPasswordExpires = null;
      await user.save();
      
      fastify.log.info(`[RESET_PW_SUCCESS] User ${normalizedEmail} successfully reset their password.`);
      return sendSuccess(reply, null, 'Password reset successfully. You can now log in.');
    } catch (error) {
      fastify.log.error(`[RESET_PW_CRITICAL_ERROR] Details: ${error.message}\nStack: ${error.stack}`);
      return sendError(reply, 'Failed to reset password', 500, error.message);
    }
  });

  // ============================================================================
  // USER PROFILE & OAUTH ROUTES (Fixed Adaptive Auth & Explicit Messaging)
  // ============================================================================
  fastify.get('/me', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);

      return sendSuccess(reply, {
        userId: request.user._id,
        username: request.user.username,
        email: request.user.email,
        role: request.user.role,
        subscriptionExpiresAt: request.user.subscriptionExpiresAt || null,
        profileImage: request.user.profile?.avatarUrl || request.user.profileImage || null,
        profile: request.user.profile || { displayName: request.user.username, avatarUrl: null, country: '', region: '', preferredLanguage: 'English' },
        displayName: request.user.profile?.displayName || request.user.username,
      });
    } catch (error) {
      return sendError(reply, 'Failed to fetch user', 500, error.message);
    }
  });

  for (const provider of ['google', 'apple', 'github']) {
    fastify.get(`/${provider}`, async (request, reply) => {
      const config = providerConfig(provider);
      if (!config?.clientId || !config.clientSecret) {
        fastify.log.error(`[OAUTH_SETUP_ERROR] Provider ${provider} is missing client ID or secret.`);
        return oauthError(reply, `${provider.charAt(0).toUpperCase() + provider.slice(1)} login is not configured properly.`);
      }
      
      const state = createState();
      const verifier = createCodeVerifier();
      
      // FIX 1: Restored standard cookieOptions so Github and local testing don't silently drop the state cookie.
      reply.setCookie(`oauth_${provider}_state`, state, cookieOptions);
      reply.setCookie(`oauth_${provider}_verifier`, verifier, cookieOptions);
      
      fastify.log.info(`[OAUTH_INITIATED] Starting ${provider} OAuth flow. State generated.`);
      
      const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: oauthCallback(provider), response_type: 'code', scope: config.scope, state });
      
      // FIX 2: Only inject PKCE Code Challenge for Google/Apple. GitHub's standard web app flow doesn't require this and it can confuse the callback.
      if (provider !== 'github') {
        params.set('code_challenge', createCodeChallenge(verifier));
        params.set('code_challenge_method', 'S256');
      }
      
      return reply.redirect(`${config.authorization}?${params}`);
    });

    fastify.route({
      method: 'GET',
      url: `/${provider}/callback`,
      handler: async (request, reply) => {
        try {
          const config = providerConfig(provider);
          const { code, state, error } = request.query || {};
          const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
          
          if (error) {
             fastify.log.warn(`[OAUTH_CANCELLED] Provider: ${provider} returned error query param: ${error}`);
             return oauthError(reply, 'Authentication was cancelled or denied by the user.');
          }
          
          const verifier = request.cookies[`oauth_${provider}_verifier`];
          const savedState = request.cookies[`oauth_${provider}_state`];
          
          // FIX 3: Dynamic error message so you know exactly which provider dropped the session
          if (!config?.clientId || !code || !verifier || state !== savedState) {
            fastify.log.error(`[OAUTH_SECURITY_MISMATCH] Provider: ${provider}. Code exists: ${!!code}, Verifier exists: ${!!verifier}, Expected State: ${savedState}, Received State: ${state}`);
            return oauthError(reply, `${providerName} login session mismatch or expired. Please try logging in again.`);
          }
          
          reply.clearCookie(`oauth_${provider}_state`, { path: '/' });
          reply.clearCookie(`oauth_${provider}_verifier`, { path: '/' });
          
          let profile;
          if (provider === 'google') {
            const token = await axios.post(config.token, new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: oauthCallback(provider), grant_type: 'authorization_code', code_verifier: verifier }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
            profile = await verifyGoogleIdentity(token, config.clientId);
          } else if (provider === 'github') {
            // FIX 4: Removed code_verifier from GitHub POST request to strictly follow GitHub's OAuth Web Application flow.
            const token = await axios.post(config.token, { code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: oauthCallback(provider) }, { headers: { Accept: 'application/json' } });
            const headers = { Authorization: `Bearer ${token.data.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'AfriStory-App' };
            const result = await axios.get('https://api.github.com/user', { headers });
            const emails = await axios.get('https://api.github.com/user/emails', { headers });
            const verifiedEmail = emails.data.find(e => e.primary && e.verified) || emails.data.find(e => e.verified);
            profile = { providerId: String(result.data.id), email: result.data.email || verifiedEmail?.email, emailVerified: true, name: result.data.name || result.data.login, picture: result.data.avatar_url };
          }
          
          const user = await findOrCreateSocialUser(provider, profile);
          
          fastify.log.info(`[OAUTH_SUCCESS] User logged in via ${provider}: ${user.email}`);
          reply.setCookie('token', generateToken(user._id), authCookieOptions);
          return reply.redirect('/app.html');
        } catch (error) {
          fastify.log.error(`[OAUTH_CRITICAL_ERROR] Provider: ${provider}. Details: ${error.message}\nStack: ${error.stack}`);
          return oauthError(reply, `Social login failed: ${error.message}`);
        }
      },
    });
  }
}
