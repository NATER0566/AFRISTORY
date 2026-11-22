import crypto from 'node:crypto';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Wallet from '../models/Wallet.js';
import { verifyAuth, generateToken, authCookieOptions } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { isValidEmail, isValidUsername } from '../utils/helpers.js';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { sendVerificationCodeEmail, sendPasswordResetEmail, isResendReady } from '../config/resend.js';

const generateCode = () => String(Math.floor(100000 + Math.random() * 900000));
const codeExpiry = (minutes) => new Date(Date.now() + minutes * 60 * 1000);

function getDynamicCallbackUrl(request, provider) {
  const protocol = request.headers['x-forwarded-proto'] || (process.env.NODE_ENV === 'production' ? 'https' : 'http');
  const host = request.headers.host || request.hostname;
  return `${protocol}://${host}/api/auth/${provider}/callback`;
}

const oauthError = (reply, message) => reply.redirect(`/?authError=${encodeURIComponent(message)}`);
const createState = () => crypto.randomBytes(24).toString('hex');
const createCodeVerifier = () => crypto.randomBytes(32).toString('base64url');
const createCodeChallenge = verifier => crypto.createHash('sha256').update(verifier).digest('base64url');

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

function getRegisteredProviders(user) {
  const providers = [];
  if (user?.authProviders?.googleId) providers.push('Google');
  if (user?.authProviders?.githubId) providers.push('GitHub');
  if (user?.authProviders?.appleSub) providers.push('Apple');
  return providers;
}

function validatePasswordFormat(password) {
  if (typeof password !== 'string' || password.length === 0) {
    return 'Password is missing. Please enter a password.';
  }
  if (password.length < 8) {
    return 'Password is too short. Use at least 8 characters (including uppercase, lowercase, and a number).';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must include at least one uppercase letter (A-Z).';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must include at least one lowercase letter (a-z).';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must include at least one number (0-9).';
  }
  return null;
}

async function findOrCreateSocialUser(provider, profile) {
  const field = providerField(provider);
  if (!field || !profile.providerId) throw new Error('Provider identity is incomplete');

  let user = await User.findOne({ [`authProviders.${field}`]: profile.providerId });
  if (!user && profile.email && profile.emailVerified) {
    user = await User.findOne({ email: profile.email.toLowerCase() });
  }

  // Block deleted, banned, or deactivated accounts from logging back in via OAuth
  if (user) {
    if (user.isDeleted === true || user.deletedAt || user.status === 'deleted' || user.isActive === false) {
      throw new Error('This account has been removed or deactivated and no longer has access to AfriStory.');
    }
  }

  if (!user && !profile.email) throw new Error('The provider did not return an email address');

  if (!user) {
    const rawBase = (profile.name || profile.email.split('@')[0]).replace(/[^a-zA-Z0-9_]/g, '');
    const baseUsername = (rawBase.length >= 5 ? rawBase : `${rawBase}user`).slice(0, 24);
    let username = baseUsername;
    let suffix = 1;
    while (await User.exists({ username })) {
      username = `${baseUsername.slice(0, 28 - String(suffix).length)}${suffix++}`;
    }

    user = new User({
      username,
      email: profile.email.toLowerCase(),
      passwordHash: null,
      authProviders: { [field]: profile.providerId },
      isVerified: true,
      isActive: true,
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
  fastify.post('/register', async (request, reply) => {
    try {
      const body = request.body || {};
      const cleanUsername = typeof body.username === 'string' ? body.username.trim() : '';
      const normalizedEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const confirmPassword = body.confirmPassword;

      // Support common frontend policy-checkbox field names if passed
      const policyFieldProvided =
        body.acceptPolicies !== undefined ||
        body.agreeTerms !== undefined ||
        body.termsAccepted !== undefined ||
        body.acceptedTerms !== undefined;
      const acceptedPolicies = Boolean(
        body.acceptPolicies ?? body.agreeTerms ?? body.termsAccepted ?? body.acceptedTerms
      );

      // 1. Validate EVERY field BEFORE touching the database
      if (!cleanUsername) {
        return sendError(reply, 'Username is missing. Please enter a username (at least 5 characters).', 400);
      }
      if (cleanUsername.length < 5) {
        return sendError(reply, 'Username must be at least 5 characters long (letters, numbers, or underscores).', 400);
      }
      if (cleanUsername.length > 30) {
        return sendError(reply, 'Username cannot exceed 30 characters.', 400);
      }
      if (!isValidUsername(cleanUsername)) {
        return sendError(reply, 'Username can only use letters, numbers, and underscores (no spaces or special symbols).', 400);
      }

      if (!normalizedEmail) {
        return sendError(reply, 'Email address is missing. Please enter your email address.', 400);
      }
      if (!isValidEmail(normalizedEmail)) {
        return sendError(reply, 'Invalid email format. Please enter a valid email (e.g., name@example.com).', 400);
      }

      const passwordError = validatePasswordFormat(password);
      if (passwordError) {
        return sendError(reply, passwordError, 400);
      }

      if (confirmPassword !== undefined && password !== confirmPassword) {
        return sendError(reply, 'Passwords do not match. Please enter the exact same password in both fields.', 400);
      }

      if (policyFieldProvided && !acceptedPolicies) {
        return sendError(reply, 'Please tick the box to accept the Terms of Service and Privacy Policy before registering.', 400);
      }

      if (!isResendReady()) {
        fastify.log.error(`[REGISTER_CONFIG_ERROR] Resend is not configured for ${normalizedEmail}`);
        return sendError(reply, 'Email service is temporarily unavailable. Please try again shortly.', 503);
      }

      // 2. Check existing user & tell them exact login method if registered via Google/GitHub/Apple
      const existingByEmail = await User.findOne({ email: normalizedEmail });
      if (existingByEmail) {
        if (existingByEmail.isDeleted === true || existingByEmail.deletedAt || existingByEmail.isActive === false) {
          return sendError(reply, 'This account has been deactivated or removed. Contact support@afristory.live for help.', 403);
        }

        const socialProviders = getRegisteredProviders(existingByEmail);
        if (socialProviders.length > 0 && !existingByEmail.passwordHash) {
          return sendError(
            reply,
            `You already registered with ${socialProviders.join(' or ')}. Please go to Login and continue with ${socialProviders.join(' or ')}.`,
            409
          );
        }

        return sendError(reply, 'This email is already registered. Please log in instead.', 409);
      }

      const existingByUsername = await User.findOne({ username: cleanUsername });
      if (existingByUsername) {
        return sendError(reply, 'That username is already taken. Please choose a different username.', 409);
      }

      // 3. Create account & roll back immediately if verification email fails to send
      const verificationCode = generateCode();
      const newUser = new User({
        username: cleanUsername,
        email: normalizedEmail,
        passwordHash: password,
        role: 'USER',
        isVerified: false,
        isActive: true,
        verificationCode,
        verificationCodeExpires: codeExpiry(15),
      });

      await newUser.save();

      try {
        await sendVerificationCodeEmail({ email: newUser.email, code: verificationCode });
        await Wallet.create({ userId: newUser._id });
      } catch (emailError) {
        // Prevent partial/unusable account from blocking retry
        await User.deleteOne({ _id: newUser._id }).catch(() => {});
        fastify.log.error(`[REGISTER_EMAIL_ROLLBACK] Rolled back ${normalizedEmail} after email error: ${emailError.message}`);
        return sendError(reply, 'Could not send the verification email right now. Please try again in a moment.', 503);
      }

      fastify.log.info(`[REGISTER_SUCCESS] User created: ${newUser.email}`);
      return sendSuccess(
        reply,
        { userId: newUser._id, username: newUser.username, email: newUser.email, role: newUser.role },
        'Registration successful! Check your email for your 6-digit verification code.',
        201
      );
    } catch (error) {
      fastify.log.error(`[REGISTER_CRITICAL_ERROR] Details: ${error.message}\nStack: ${error.stack}`);
      return sendError(reply, 'Registration failed due to a server error. Please try again.', 500, error.message);
    }
  });

  fastify.post('/login', async (request, reply) => {
    try {
      const { email, password } = request.body || {};
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

      if (!normalizedEmail) return sendError(reply, 'Email address is missing. Please enter your email.', 400);
      if (!password) return sendError(reply, 'Password is missing. Please enter your password.', 400);

      const user = await User.findOne({ email: normalizedEmail });
      if (!user) {
        return sendError(reply, 'No account found with this email address. Please register first.', 404);
      }

      if (user.isDeleted === true || user.deletedAt || !user.isActive) {
        return sendError(reply, 'This account has been removed or deactivated. Please contact support@afristory.live.', 403);
      }

      const socialProviders = getRegisteredProviders(user);
      if (!user.passwordHash && socialProviders.length > 0) {
        return sendError(
          reply,
          `This account was registered using ${socialProviders.join(' or ')}. Please click "Continue with ${socialProviders[0]}" to log in.`,
          400
        );
      }

      const passwordMatch = await user.comparePassword(password);
      if (!passwordMatch) {
        return sendError(reply, 'Incorrect password. Please check your password and try again.', 401);
      }

      if (!user.isVerified) {
        if (!isResendReady()) {
          return sendError(reply, 'Email delivery is not configured on the server.', 503);
        }

        user.verificationCode = generateCode();
        user.verificationCodeExpires = codeExpiry(15);
        await user.save();
        try {
          await sendVerificationCodeEmail({ email: user.email, code: user.verificationCode });
        } catch (emailError) {
          return sendError(reply, 'Verification email failed to send.', 503);
        }
        return reply.status(403).send({
          success: false,
          code: 'UNVERIFIED',
          message: 'Please verify your email before logging in. A new 6-digit code has been sent.',
        });
      }

      user.lastLogin = new Date();
      await user.save();

      const token = generateToken(user._id);
      reply.setCookie('token', token, authCookieOptions);

      return sendSuccess(reply, { userId: user._id, username: user.username, email: user.email, role: user.role }, 'Login successful! Welcome back.');
    } catch (error) {
      fastify.log.error(`[LOGIN_CRITICAL_ERROR] Details: ${error.message}\nStack: ${error.stack}`);
      return sendError(reply, 'Login failed due to a server error.', 500, error.message);
    }
  });

  fastify.post('/logout', async (request, reply) => {
    reply.clearCookie('token', { path: '/' });
    return sendSuccess(reply, null, 'Logout successful');
  });

  fastify.post('/verify-email', async (request, reply) => {
    try {
      const { email, code } = request.body || {};
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

      if (!normalizedEmail) return sendError(reply, 'Email address is required for verification.', 400);
      if (!code) return sendError(reply, 'Verification code is required.', 400);

      const user = await User.findOne({ email: normalizedEmail });
      if (!user) {
        return sendError(reply, 'Invalid request. This email is not registered.', 400);
      }

      if (user.isVerified) {
        return sendError(reply, 'Your account is already verified. You can log in.', 400);
      }

      if (user.verificationCode !== String(code).trim() || !user.verificationCodeExpires || user.verificationCodeExpires <= new Date()) {
        return sendError(reply, 'Invalid or expired verification code. Please request a new one.', 400);
      }

      user.isVerified = true;
      user.verificationCode = null;
      user.verificationCodeExpires = null;
      await user.save();

      const token = generateToken(user._id);
      reply.setCookie('token', token, authCookieOptions);

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

      if (!normalizedEmail) return sendError(reply, 'Email address is required.', 400);

      const user = await User.findOne({ email: normalizedEmail });
      if (!user) {
        return sendError(reply, 'This email is not registered in our system.', 404);
      }
      if (user.isVerified) {
        return sendError(reply, 'Your account is already verified. You can log in.', 400);
      }

      if (!isResendReady()) {
        return sendError(reply, 'Email delivery is not configured on the server.', 503);
      }

      user.verificationCode = generateCode();
      user.verificationCodeExpires = codeExpiry(15);
      await user.save();

      try {
        await sendVerificationCodeEmail({ email: user.email, code: user.verificationCode });
      } catch (emailError) {
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
        return sendError(reply, 'This email is not registered in our system.', 404);
      }

      const socialProviders = getRegisteredProviders(user);
      if (!user.passwordHash && socialProviders.length > 0) {
        return sendError(
          reply,
          `This account uses ${socialProviders.join(' or ')} login and does not have a password. Please sign in with ${socialProviders[0]}.`,
          400
        );
      }

      if (!isResendReady()) {
        return sendError(reply, 'Email delivery is not configured on the server.', 503);
      }

      user.resetPasswordCode = generateCode();
      user.resetPasswordExpires = codeExpiry(15);
      await user.save();

      try {
        await sendPasswordResetEmail({ email: user.email, code: user.resetPasswordCode });
      } catch (emailError) {
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

      if (!normalizedEmail) return sendError(reply, 'Email address is required.', 400);
      if (!code) return sendError(reply, 'Reset code is required.', 400);

      const passwordError = validatePasswordFormat(newPassword);
      if (passwordError) return sendError(reply, passwordError, 400);

      const user = await User.findOne({ email: normalizedEmail });

      if (!user || user.resetPasswordCode !== String(code).trim() || !user.resetPasswordExpires || user.resetPasswordExpires <= new Date()) {
        return sendError(reply, 'Invalid or expired reset code. Please request a new password reset OTP.', 400);
      }

      user.passwordHash = newPassword;
      user.resetPasswordCode = null;
      user.resetPasswordExpires = null;
      await user.save();

      return sendSuccess(reply, null, 'Password reset successfully. You can now log in.');
    } catch (error) {
      fastify.log.error(`[RESET_PW_CRITICAL_ERROR] Details: ${error.message}\nStack: ${error.stack}`);
      return sendError(reply, 'Failed to reset password', 500, error.message);
    }
  });

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
      try {
        const existingToken = request.cookies?.token;
        if (existingToken && process.env.JWT_SECRET) {
          const decoded = jwt.verify(existingToken, process.env.JWT_SECRET);
          const currentUser = await User.findById(decoded.userId || decoded.id).select('isActive isDeleted deletedAt');
          if (currentUser && currentUser.isActive !== false && !currentUser.isDeleted && !currentUser.deletedAt) {
            return reply.redirect('/app.html');
          }
          reply.clearCookie('token', { path: '/' });
        }
      } catch (err) {}

      const config = providerConfig(provider);
      if (!config?.clientId || !config.clientSecret) {
        return oauthError(reply, `${provider.charAt(0).toUpperCase() + provider.slice(1)} login is not configured properly.`);
      }

      const state = createState();
      const verifier = createCodeVerifier();

      reply.setCookie(`oauth_${provider}_state`, state, cookieOptions);
      reply.setCookie(`oauth_${provider}_verifier`, verifier, cookieOptions);

      reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      reply.header('Pragma', 'no-cache');
      reply.header('Expires', '0');

      const dynamicCallbackUrl = getDynamicCallbackUrl(request, provider);
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: dynamicCallbackUrl,
        response_type: 'code',
        scope: config.scope,
        state,
      });

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
            return oauthError(reply, 'Authentication was cancelled or denied by the user.');
          }

          const verifier = request.cookies[`oauth_${provider}_verifier`];
          const savedState = request.cookies[`oauth_${provider}_state`];

          if (!config?.clientId || !code || !verifier || state !== savedState) {
            return oauthError(reply, `${providerName} login session mismatch or expired. Please try logging in again.`);
          }

          reply.clearCookie(`oauth_${provider}_state`, { path: '/' });
          reply.clearCookie(`oauth_${provider}_verifier`, { path: '/' });

          const dynamicCallbackUrl = getDynamicCallbackUrl(request, provider);
          let profile;

          if (provider === 'google') {
            const token = await axios.post(
              config.token,
              new URLSearchParams({
                code,
                client_id: config.clientId,
                client_secret: config.clientSecret,
                redirect_uri: dynamicCallbackUrl,
                grant_type: 'authorization_code',
                code_verifier: verifier,
              }),
              { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            );
            profile = await verifyGoogleIdentity(token, config.clientId);
          } else if (provider === 'github') {
            const token = await axios.post(
              config.token,
              { code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: dynamicCallbackUrl },
              { headers: { Accept: 'application/json' } }
            );
            const headers = { Authorization: `Bearer ${token.data.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'AfriStory-App' };
            const result = await axios.get('https://api.github.com/user', { headers });
            const emails = await axios.get('https://api.github.com/user/emails', { headers });
            const verifiedEmail = emails.data.find(e => e.primary && e.verified) || emails.data.find(e => e.verified);
            profile = {
              providerId: String(result.data.id),
              email: result.data.email || verifiedEmail?.email,
              emailVerified: true,
              name: result.data.name || result.data.login,
              picture: result.data.avatar_url,
            };
          }

          const user = await findOrCreateSocialUser(provider, profile);

          fastify.log.info(`[OAUTH_SUCCESS] User logged in via ${provider}: ${user.email}`);
          reply.setCookie('token', generateToken(user._id), authCookieOptions);
          return reply.redirect('/app.html');
        } catch (error) {
          fastify.log.error(`[OAUTH_CRITICAL_ERROR] Provider: ${provider}. Details: ${error.message}\nStack: ${error.stack}`);
          return oauthError(reply, error.message || 'Social login failed.');
        }
      },
    });
  }
}
