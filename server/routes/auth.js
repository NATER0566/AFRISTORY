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

// 🛠️ FIX: Automatically use Render URL in production, localhost in testing
const serverUrl = process.env.NODE_ENV === 'production' 
  ? 'https://afristory.onrender.com' 
  : 'http://localhost:3000';

const oauthCallback = provider => `${serverUrl}/api/auth/${provider}/callback`;

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
  // Register
  fastify.post('/register', async (request, reply) => {
    try {
      const { username, email, password, confirmPassword } = request.body || {};
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

      // Validation
      if (!username || !email || !password) {
        return sendError(reply, 'All fields are required', 400);
      }

      if (!isValidUsername(username)) {
        return sendError(
          reply,
          'Username must be 3-30 characters and contain only letters, numbers, and underscores',
          400
        );
      }

      if (!isValidEmail(normalizedEmail)) {
        return sendError(reply, 'Invalid email format', 400);
      }

      if (password.length < 8) {
        return sendError(reply, 'Password must be at least 8 characters', 400);
      }

      if (confirmPassword && password !== confirmPassword) {
        return sendError(reply, 'Passwords do not match', 400);
      }

      if (!isResendReady()) {
        return sendError(reply, 'CODE READY — REAL CREDENTIAL REQUIRED: set a valid RESEND_API_KEY and verified RESEND_FROM_EMAIL in your .env before OTP email can be sent.', 503);
      }

      // Check if user exists
      const existingUser = await User.findOne({
        $or: [{ email: normalizedEmail }, { username }],
      });

      if (existingUser) {
        return sendError(reply, 'Email or username already exists', 409);
      }

      // Create user
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
      } catch (emailError) {
        fastify.log.error({ err: emailError }, 'Verification email delivery failed');
        return sendError(reply, 'Verification email could not be delivered. Configure a valid Resend email sender and API key before continuing.', 503);
      }

      // Create wallet
      await Wallet.create({
        userId: newUser._id,
      });

      // Generate token
      const token = generateToken(newUser._id);

      reply.setCookie('token', token, authCookieOptions);

      return sendSuccess(
        reply,
        {
          userId: newUser._id,
          username: newUser.username,
          email: newUser.email,
          role: newUser.role,
        },
        'Registration successful',
        201
      );
    } catch (error) {
      console.error('\n🚨🚨🚨 REGISTRATION SERVER CRASH TRACE 🚨🚨🚨');
      console.error(error);
      console.error('🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨\n');
      
      fastify.log.error(error);
      return sendError(reply, 'Registration failed', 500, error.message);
    }
  });

  // Login
  fastify.post('/login', async (request, reply) => {
    try {
      const { email, password } = request.body || {};
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

      if (!email || !password) {
        return sendError(reply, 'Email and password are required', 400);
      }

      const user = await User.findOne({ email: normalizedEmail });

      if (!user) {
        return sendError(reply, 'Invalid email or password', 401);
      }

      const passwordMatch = await user.comparePassword(password);

      if (!passwordMatch) {
        return sendError(reply, 'Invalid email or password', 401);
      }

      if (!user.isActive) {
        return sendError(reply, 'Your account has been deactivated', 403);
      }

      if (!isResendReady()) {
        return sendError(reply, 'CODE READY — REAL CREDENTIAL REQUIRED: set a valid RESEND_API_KEY and verified RESEND_FROM_EMAIL in your .env before OTP email can be sent.', 503);
      }

      if (!user.isVerified) {
        user.verificationCode = generateCode();
        user.verificationCodeExpires = codeExpiry(15);
        await user.save();
        try {
          await sendVerificationCodeEmail({ email: user.email, code: user.verificationCode });
        } catch (emailError) {
          fastify.log.error({ err: emailError }, 'Verification email delivery failed');
          return sendError(reply, 'Verification email could not be delivered. Configure a valid Resend email sender and API key before continuing.', 503);
        }
        return reply.status(403).send({
          success: false,
          code: 'UNVERIFIED',
          message: 'Please verify your email before logging in',
        });
      }

      // Update last login
      user.lastLogin = new Date();
      await user.save();

      // Generate token
      const token = generateToken(user._id);

      reply.setCookie('token', token, authCookieOptions);

      return sendSuccess(
        reply,
        {
          userId: user._id,
          username: user.username,
          email: user.email,
          role: user.role,
        },
        'Login successful'
      );
    } catch (error) {
      console.error('\n🚨🚨🚨 LOGIN SERVER CRASH TRACE 🚨🚨🚨');
      console.error(error);
      fastify.log.error(error);
      return sendError(reply, 'Login failed', 500, error.message);
    }
  });

  // Logout
  fastify.post('/logout', async (request, reply) => {
    reply.clearCookie('token');
    return sendSuccess(reply, null, 'Logout successful');
  });

  // Get current user
  fastify.get('/me', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      return sendSuccess(reply, {
        userId: request.user._id,
        username: request.user.username,
        email: request.user.email,
        role: request.user.role,
        // PHASE 3E CLEANUP: Removed adUnlocksRemaining from response payload
        profileImage: request.user.profile?.avatarUrl || request.user.profileImage || null,
        profile: request.user.profile || {
          displayName: request.user.username,
          avatarUrl: request.user.profileImage || null,
          coverUrl: null,
          country: '',
          region: '',
          preferredLanguage: 'English',
          favoriteGenres: [],
          favoriteCultures: [],
          additionalLanguages: [],
        },
        displayName: request.user.profile?.displayName || request.user.username,
      });
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to fetch user', 500, error.message);
    }
  });

  // Forgot password
  fastify.post('/forgot-password', async (request, reply) => {
    try {
      const { email } = request.body || {};

      if (!email) {
        return sendError(reply, 'Email is required', 400);
      }

      const user = await User.findOne({ email: email.trim().toLowerCase() });

      if (!user) {
        return sendSuccess(reply, null, 'If email exists, reset link has been sent', 200);
      }

      if (!isResendReady()) {
        return sendError(reply, 'CODE READY — REAL CREDENTIAL REQUIRED: set a valid RESEND_API_KEY and verified RESEND_FROM_EMAIL in your .env before password reset email can be sent.', 503);
      }

      user.resetPasswordCode = generateCode();
      user.resetPasswordExpires = codeExpiry(15);
      await user.save();
      try {
        await sendPasswordResetEmail({ email: user.email, code: user.resetPasswordCode });
      } catch (emailError) {
        fastify.log.error({ err: emailError }, 'Password reset email delivery failed');
        return sendError(reply, 'Password reset email could not be delivered. Configure a valid Resend sender and API key before continuing.', 503);
      }
      return sendSuccess(reply, null, 'If email exists, reset link has been sent', 200);
    } catch (error) {
      console.error('\n🚨🚨🚨 FORGOT PASSWORD CRASH TRACE 🚨🚨🚨');
      console.error(error);
      fastify.log.error(error);
      return sendError(reply, 'Failed to process request', 500, error.message);
    }
  });

  // Verify email with the one-time code issued during registration or login.
  fastify.post('/verify-email', async (request, reply) => {
    try {
      const { email, code } = request.body || {};
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
      const user = await User.findOne({ email: normalizedEmail });

      if (!user || !/^\d{6}$/.test(String(code || '')) || user.isVerified ||
        user.verificationCode !== String(code) || !user.verificationCodeExpires ||
        user.verificationCodeExpires <= new Date()) {
        return sendError(reply, 'Invalid or expired verification code', 400);
      }

      user.isVerified = true;
      user.verificationCode = null;
      user.verificationCodeExpires = null;
      await user.save();

      const token = generateToken(user._id);
      reply.setCookie('token', token, authCookieOptions);
      return sendSuccess(reply, null, 'Email verified successfully');
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to verify email', 500, error.message);
    }
  });

  // Issue a fresh email verification code.
  fastify.post('/resend-otp', async (request, reply) => {
    try {
      const { email } = request.body || {};
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
      const user = await User.findOne({ email: normalizedEmail });

      if (!user || user.isVerified) {
        return sendError(reply, 'Unable to resend verification code', 400);
      }

      if (!isResendReady()) {
        return sendError(reply, 'CODE READY — REAL CREDENTIAL REQUIRED: set a valid RESEND_API_KEY and verified RESEND_FROM_EMAIL in your .env before OTP email can be sent.', 503);
      }

      user.verificationCode = generateCode();
      user.verificationCodeExpires = codeExpiry(15);
      await user.save();
      try {
        await sendVerificationCodeEmail({ email: user.email, code: user.verificationCode });
      } catch (emailError) {
        fastify.log.error({ err: emailError }, 'Verification email delivery failed');
        return sendError(reply, 'Verification email could not be delivered. Configure a valid Resend sender and API key before continuing.', 503);
      }
      return sendSuccess(reply, null, 'Verification code sent');
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to resend verification code', 500, error.message);
    }
  });

  // Verify the reset code and let the User save hook hash the new password.
  fastify.post('/reset-password', async (request, reply) => {
    try {
      const { email, code, newPassword } = request.body || {};
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
      const user = await User.findOne({ email: normalizedEmail });

      if (!user || !/^\d{6}$/.test(String(code || '')) || typeof newPassword !== 'string' ||
        newPassword.length < 6 || user.resetPasswordCode !== String(code) ||
        !user.resetPasswordExpires || user.resetPasswordExpires <= new Date()) {
        return sendError(reply, 'Invalid or expired reset code', 400);
      }

      user.passwordHash = newPassword;
      user.resetPasswordCode = null;
      user.resetPasswordExpires = null;
      await user.save();
      return sendSuccess(reply, null, 'Password reset successfully');
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to reset password', 500, error.message);
    }
  });

  for (const provider of ['google', 'apple', 'github']) {
    fastify.get(`/${provider}`, async (request, reply) => {
      const config = providerConfig(provider);
      if (!config?.clientId || !config.clientSecret) return oauthError(reply, `${provider} login is not configured`);
      const state = createState();
      const verifier = createCodeVerifier();
      const nonce = provider === 'apple' ? createState() : null;
      reply.setCookie(`oauth_${provider}_state`, state, cookieOptions);
      reply.setCookie(`oauth_${provider}_verifier`, verifier, cookieOptions);
      if (nonce) reply.setCookie(`oauth_${provider}_nonce`, nonce, cookieOptions);
      const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: oauthCallback(provider), response_type: 'code', scope: config.scope, state });
      params.set('code_challenge', createCodeChallenge(verifier));
      params.set('code_challenge_method', 'S256');
      if (provider === 'google') params.set('access_type', 'online');
      if (provider === 'apple') { params.set('response_mode', 'query'); params.set('nonce', nonce); }
      return reply.redirect(`${config.authorization}?${params}`);
    });

    fastify.route({
      method: provider === 'apple' ? ['GET', 'POST'] : 'GET',
      url: `/${provider}/callback`,
      handler: async (request, reply) => {
        try {
          const config = providerConfig(provider);
          const callbackData = request.body && Object.keys(request.body).length ? request.body : request.query || {};
          const { code, state, error } = callbackData;
          if (error) return oauthError(reply, 'Authentication was cancelled');
          const verifier = request.cookies[`oauth_${provider}_verifier`];
          const nonce = request.cookies[`oauth_${provider}_nonce`];
          if (!config?.clientId || !config.clientSecret || !code || !verifier || state !== request.cookies[`oauth_${provider}_state`]) {
            return oauthError(reply, 'Social login could not be verified');
          }
          reply.clearCookie(`oauth_${provider}_state`, { path: '/' });
          reply.clearCookie(`oauth_${provider}_verifier`, { path: '/' });
          if (nonce) reply.clearCookie(`oauth_${provider}_nonce`, { path: '/' });
          let profile;
          if (provider === 'google') {
            const token = await axios.post(config.token, new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: oauthCallback(provider), grant_type: 'authorization_code', code_verifier: verifier }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
            profile = await verifyGoogleIdentity(token, config.clientId);
          } else if (provider === 'github') {
            const token = await axios.post(config.token, { code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: oauthCallback(provider), code_verifier: verifier }, { headers: { Accept: 'application/json' } });
            if (!token.data.access_token) throw new Error('GitHub did not return an access token');
            const headers = { Authorization: `Bearer ${token.data.access_token}`, Accept: 'application/vnd.github+json' };
            const result = await axios.get('https://api.github.com/user', { headers });
            const emails = await axios.get('https://api.github.com/user/emails', { headers });
            const verifiedEmail = emails.data.find(email => email.primary && email.verified) || emails.data.find(email => email.verified);
            profile = { providerId: String(result.data.id), email: result.data.email || verifiedEmail?.email, emailVerified: Boolean(verifiedEmail?.verified), name: result.data.name || result.data.login, picture: result.data.avatar_url };
          } else {
            const token = await axios.post(config.token, new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: oauthCallback(provider), grant_type: 'authorization_code', code_verifier: verifier }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
            profile = await verifyAppleIdentity(token.data.id_token, config.clientId, nonce);
          }
          const user = await findOrCreateSocialUser(provider, profile);
          reply.setCookie('token', generateToken(user._id), authCookieOptions);
          return reply.redirect('/app.html');
        } catch (error) {
          fastify.log.error(error);
          return oauthError(reply, 'Social login failed');
        }
      },
    });
  }

  // Set PIN
  fastify.post('/set-pin', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { pin, confirmPin } = request.body || {};

      if (!pin || !confirmPin) {
        return sendError(reply, 'PIN and confirmation are required', 400);
      }

      if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
        return sendError(reply, 'PIN must be exactly 4 digits', 400);
      }

      if (pin !== confirmPin) {
        return sendError(reply, 'PINs do not match', 400);
      }

      const user = await User.findById(request.user._id);
      user.pinHash = pin;
      await user.save();

      return sendSuccess(reply, null, 'PIN set successfully');
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to set PIN', 500, error.message);
    }
  });
}
