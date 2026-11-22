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
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

function isUserBlockedOrDeleted(user) {
  if (!user) return false;
  return (
    user.isActive === false ||
    user.isDeleted === true ||
    Boolean(user.deletedAt) ||
    user.status === 'deleted' ||
    user.status === 'suspended' ||
    user.status === 'banned'
  );
}

function validatePasswordFormat(password) {
  if (typeof password !== 'string' || password.length === 0) {
    return 'Password is missing. Please enter a password.';
  }
  if (password.length < 8) {
    return 'Password is too short. Please enter at least 8 characters including an uppercase letter, a lowercase letter, and a number.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password format invalid: please include at least one uppercase letter (A-Z).';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password format invalid: please include at least one lowercase letter (a-z).';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password format invalid: please include at least one number (0-9).';
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

  // Strictly block deleted, banned, or deactivated users from logging in via Google/GitHub/Apple
  if (isUserBlockedOrDeleted(user)) {
    throw new Error('This account has been deleted or deactivated and no longer has access to AfriStory.');
  }

  if (!user && !profile.email) throw new Error('The provider did not return an email address');

  if (!user) {
    const rawBase = (profile.name || profile.email.split('@')[0]).replace(/[^a-zA-Z0-9_]/g, '');
    const baseUsername = (rawBase.length >= 5 ? rawBase : `${rawBase}story`).slice(0, 24);
    let username = baseUsername;
    let suffix = 1;
    while (await User.exists({ username: { $regex: new RegExp(`^${escapeRegex(username)}$`, 'i') } })) {
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
    await Wallet.findOneAndUpdate(
      { userId: user._id },
      { $setOnInsert: { userId: user._id } },
      { upsert: true, new: true }
    );
  } else {
    // Keep existing active user synchronized with latest provider metadata
    user.authProviders = { ...(user.authProviders?.toObject?.() || user.authProviders || {}), [field]: profile.providerId };
    user.isVerified = true;
    user.lastLogin = new Date();
    if (profile.picture && !user.profileImage) user.profileImage = profile.picture;
    if (profile.name && (!user.profile || !user.profile.displayName)) {
      user.profile = { ...(user.profile?.toObject?.() || user.profile || {}), displayName: profile.name };
    }
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

      const policyKeys = ['acceptPolicies', 'agreeTerms', 'termsAccepted', 'acceptedTerms', 'policiesAccepted', 'agree', 'terms'];
      const presentPolicyKey = policyKeys.find((key) => body[key] !== undefined);
      const acceptedPolicies = presentPolicyKey ? Boolean(body[presentPolicyKey]) : true;

      // 1. Validate all inputs completely BEFORE saving anything to MongoDB
      if (!cleanUsername) {
        fastify.log.warn('[REGISTER_VALIDATION_ERROR] Missing username');
        return sendError(reply, 'Username is missing. Please type a username with at least 5 characters.', 400);
      }
      if (cleanUsername.length < 5) {
        fastify.log.warn(`[REGISTER_VALIDATION_ERROR] Username too short: ${cleanUsername}`);
        return sendError(reply, 'Username is too short. Please type a username with at least 5 characters (letters, numbers, or underscores).', 400);
      }
      if (cleanUsername.length > 30) {
        fastify.log.warn(`[REGISTER_VALIDATION_ERROR] Username too long: ${cleanUsername}`);
        return sendError(reply, 'Username is too long. Please keep your username within 30 characters.', 400);
      }
      if (!isValidUsername(cleanUsername)) {
        fastify.log.warn(`[REGISTER_VALIDATION_ERROR] Invalid username format: ${cleanUsername}`);
        return sendError(reply, 'Invalid username format. Use at least 5 characters with only letters, numbers, and underscores (no spaces or special symbols).', 400);
      }

      if (!normalizedEmail) {
        fastify.log.warn('[REGISTER_VALIDATION_ERROR] Missing email');
        return sendError(reply, 'Email address is missing. Please type your email address.', 400);
      }
      if (!isValidEmail(normalizedEmail)) {
        fastify.log.warn(`[REGISTER_VALIDATION_ERROR] Invalid email format: ${normalizedEmail}`);
        return sendError(reply, 'Invalid email format. Please enter a valid email address (for example, name@example.com).', 400);
      }

      const passwordError = validatePasswordFormat(password);
      if (passwordError) {
        fastify.log.warn(`[REGISTER_VALIDATION_ERROR] Password validation failed for ${normalizedEmail}`);
        return sendError(reply, passwordError, 400);
      }

      if (confirmPassword !== undefined && password !== confirmPassword) {
        fastify.log.warn(`[REGISTER_VALIDATION_ERROR] Passwords do not match for ${normalizedEmail}`);
        return sendError(reply, 'Passwords do not match. Please type the exact same password in both fields.', 400);
      }

      if (!acceptedPolicies) {
        fastify.log.warn(`[REGISTER_VALIDATION_ERROR] Policies not accepted for ${normalizedEmail}`);
        return sendError(reply, 'Please accept the Terms of Service and Privacy Policy before registering.', 400);
      }

      if (!isResendReady()) {
        fastify.log.error(`[REGISTER_CONFIG_ERROR] Resend is not configured for ${normalizedEmail}`);
        return sendError(reply, 'Email delivery is temporarily unavailable. Please try again shortly.', 503);
      }

      // 2. Check existing accounts & give direct instructions for Google/GitHub users
      const existingByEmail = await User.findOne({ email: normalizedEmail });
      if (existingByEmail) {
        if (isUserBlockedOrDeleted(existingByEmail)) {
          return sendError(reply, 'This account has been deleted or deactivated and cannot be registered again.', 403);
        }

        const socialProviders = getRegisteredProviders(existingByEmail);
        if (socialProviders.length > 0 && !existingByEmail.passwordHash) {
          const methodText = socialProviders.join(' or ');
          return sendError(
            reply,
            `You have already registered using ${methodText}. Please go and log in using ${methodText}.`,
            409
          );
        }

        return sendError(reply, 'You have already been registered with this email. Please log in instead.', 409);
      }

      const existingByUsername = await User.findOne({
        username: { $regex: new RegExp(`^${escapeRegex(cleanUsername)}$`, 'i') },
      });
      if (existingByUsername) {
        return sendError(reply, 'This username is already taken. Please choose another username.', 409);
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
        fastify.log.info(`[REGISTER_EMAIL_SENT] Verification code sent to ${newUser.email}`);
      } catch (emailError) {
        await User.deleteOne({ _id: newUser._id }).catch(() => {});
        fastify.log.error(`[REGISTER_EMAIL_ERROR] Rolled back ${normalizedEmail} after email error: ${emailError.message}`);
        return sendError(reply, 'Failed to send verification email. Your account was not created—please try again.', 503);
      }

      await Wallet.findOneAndUpdate(
        { userId: newUser._id },
        { $setOnInsert: { userId: newUser._id } },
        { upsert: true, new: true }
      );

      fastify.log.info(`[REGISTER_SUCCESS] User created successfully, awaiting verification: ${newUser.email}`);
      return sendSuccess(
        reply,
        { userId: newUser._id, username: newUser.username, email: newUser.email, role: newUser.role },
        'Registration successful! A 6-digit verification code has been sent to your email.',
        201
      );
    } catch (error) {
      if (error?.code === 11000) {
        const duplicateField = Object.keys(error.keyPattern || {})[0];
        if (duplicateField === 'email') {
          return sendError(reply, 'You have already been registered with this email. Please log in instead.', 409);
        }
        return sendError(reply, 'This username is already taken. Please choose another username.', 409);
      }
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
        fastify.log.warn(`[LOGIN_EMAIL_NOT_FOUND] Non-existent email: ${normalizedEmail}`);
        return sendError(reply, 'No account found with this email address. Please register first.', 404);
      }

      if (isUserBlockedOrDeleted(user)) {
        fastify.log.warn(`[LOGIN_BLOCKED] Deleted/deactivated account attempted login: ${normalizedEmail}`);
        return sendError(reply, 'This account has been deleted or deactivated. Please contact support@afristory.live.', 403);
      }

      const socialProviders = getRegisteredProviders(user);
      if (!user.passwordHash && socialProviders.length > 0) {
        const methodText = socialProviders.join(' or ');
        return sendError(
          reply,
          `You registered using ${methodText}. Please log in using ${methodText}.`,
          400
        );
      }

      const passwordMatch = await user.comparePassword(password);
      if (!passwordMatch) {
        fastify.log.warn(`[LOGIN_INVALID_PASSWORD] Wrong password for: ${normalizedEmail}`);
        return sendError(reply, 'Incorrect password. Please try again.', 401);
      }

      if (!user.isVerified) {
        fastify.log.warn(`[LOGIN_UNVERIFIED] Unverified user logged in: ${normalizedEmail}. Routing to OTP.`);
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

      fastify.log.info(`[LOGIN_SUCCESS] User logged in securely: ${user.email}`);
      return sendSuccess(reply, { userId: user._id, username: user.username, email: user.email, role: user.role }, 'Login successful! Welcome back.');
    } catch (error) {
      fastify.log.error(`[LOGIN_CRITICAL_ERROR] Details: ${error.message}\nStack: ${error.stack}`);
      return sendError(reply, 'Login failed due to a server error.', 500, error.message);
    }
  });

  fastify.post('/logout', async (request, reply) => {
    reply.clearCookie('token', { path: '/' });
    fastify.log.info('[LOGOUT_SUCCESS] User logged out and cookie cleared.');
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

      if (isUserBlockedOrDeleted(user)) {
        return sendError(reply, 'This account has been deleted or deactivated.', 403);
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

      fastify.log.info(`[VERIFY_SUCCESS] User ${normalizedEmail} verified their email.`);
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
      if (isUserBlockedOrDeleted(user)) {
        return sendError(reply, 'This account has been deleted or deactivated.', 403);
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

      if (isUserBlockedOrDeleted(user)) {
        return sendError(reply, 'This account has been deleted or deactivated.', 403);
      }

      const socialProviders = getRegisteredProviders(user);
      if (!user.passwordHash && socialProviders.length > 0) {
        const methodText = socialProviders.join(' or ');
        return sendError(
          reply,
          `You registered using ${methodText} and do not have a password. Please log in using ${methodText}.`,
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

      if (isUserBlockedOrDeleted(user)) {
        return sendError(reply, 'This account has been deleted or deactivated.', 403);
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

      if (isUserBlockedOrDeleted(request.user)) {
        reply.clearCookie('token', { path: '/' });
        return sendError(reply, 'This account has been deleted or deactivated.', 403);
      }

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
          const tokenUserId = decoded.userId || decoded.id || decoded._id || decoded.sub;
          if (tokenUserId) {
            const currentUser = await User.findById(tokenUserId);
            if (currentUser && !isUserBlockedOrDeleted(currentUser)) {
              fastify.log.info(`[OAUTH_INTERCEPTED] User clicked ${provider} with an active valid account. Bypassing redirect.`);
              return reply.redirect('/app.html');
            }
          }
          // Clear stale cookie if the user was deleted or deactivated
          reply.clearCookie('token', { path: '/' });
        }
      } catch (err) {
        reply.clearCookie('token', { path: '/' });
      }

      const config = providerConfig(provider);
      if (!config?.clientId || !config.clientSecret) {
        fastify.log.error(`[OAUTH_SETUP_ERROR] Provider ${provider} is missing client ID or secret.`);
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
            fastify.log.warn(`[OAUTH_CANCELLED] Provider: ${provider} returned error: ${error}`);
            return oauthError(reply, 'Authentication was cancelled or denied by the user.');
          }

          const verifier = request.cookies[`oauth_${provider}_verifier`];
          const savedState = request.cookies[`oauth_${provider}_state`];

          if (!config?.clientId || !code || !verifier || state !== savedState) {
            fastify.log.error(`[OAUTH_SECURITY_MISMATCH] Provider: ${provider}. Expected State: ${savedState}, Received State: ${state}`);
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

          if (!profile) {
            throw new Error(`${providerName} authentication is not configured on this callback.`);
          }

          const user = await findOrCreateSocialUser(provider, profile);

          fastify.log.info(`[OAUTH_SUCCESS] User logged in via ${provider}: ${user.email}`);
          reply.setCookie('token', generateToken(user._id), authCookieOptions);
          return reply.redirect('/app.html');
        } catch (error) {
          reply.clearCookie('token', { path: '/' });
          fastify.log.error(`[OAUTH_CRITICAL_ERROR] Provider: ${provider}. Details: ${error.message}\nStack: ${error.stack}`);
          return oauthError(reply, error.message || 'Social login failed.');
        }
      },
    });
  }
}
