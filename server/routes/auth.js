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
  fastify.post('/register', async (request, reply) => {
    try {
      const { username, email, password, confirmPassword } = request.body || {};
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

      if (!username || !email || !password) return sendError(reply, 'All fields are required', 400);
      if (!isValidUsername(username)) return sendError(reply, 'Username must be 3-30 characters', 400);
      if (!isValidEmail(normalizedEmail)) return sendError(reply, 'Invalid email format', 400);
      if (password.length < 8) return sendError(reply, 'Password must be at least 8 characters', 400);
      if (confirmPassword && password !== confirmPassword) return sendError(reply, 'Passwords do not match', 400);
      if (!isResendReady()) return sendError(reply, 'Email delivery is not configured on the server.', 503);

      const existingUser = await User.findOne({ $or: [{ email: normalizedEmail }, { username }] });
      if (existingUser) return sendError(reply, 'Email or username already exists', 409);

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
        fastify.log.error(emailError);
        return sendError(reply, 'Verification email failed.', 503);
      }

      await Wallet.create({ userId: newUser._id });
      const token = generateToken(newUser._id);
      reply.setCookie('token', token, authCookieOptions);

      return sendSuccess(reply, { userId: newUser._id, username: newUser.username, email: newUser.email, role: newUser.role }, 'Registration successful', 201);
    } catch (error) {
      return sendError(reply, 'Registration failed', 500, error.message);
    }
  });

  fastify.post('/login', async (request, reply) => {
    try {
      const { email, password } = request.body || {};
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

      if (!email || !password) return sendError(reply, 'Email and password are required', 400);
      
      const user = await User.findOne({ email: normalizedEmail });
      if (!user) return sendError(reply, 'Invalid email or password', 401);
      
      const passwordMatch = await user.comparePassword(password);
      if (!passwordMatch) return sendError(reply, 'Invalid email or password', 401);
      if (!user.isActive) return sendError(reply, 'Account deactivated', 403);

      // FIX: Only check Resend status IF the user actually needs an email sent
      if (!user.isVerified) {
        if (!isResendReady()) return sendError(reply, 'Email delivery is not configured on the server.', 503);
        
        user.verificationCode = generateCode();
        user.verificationCodeExpires = codeExpiry(15);
        await user.save();
        try {
          await sendVerificationCodeEmail({ email: user.email, code: user.verificationCode });
        } catch (emailError) {
          return sendError(reply, 'Verification email failed.', 503);
        }
        return reply.status(403).send({ success: false, code: 'UNVERIFIED', message: 'Please verify your email before logging in' });
      }

      user.lastLogin = new Date();
      await user.save();

      const token = generateToken(user._id);
      reply.setCookie('token', token, authCookieOptions);

      return sendSuccess(reply, { userId: user._id, username: user.username, email: user.email, role: user.role }, 'Login successful');
    } catch (error) {
      return sendError(reply, 'Login failed', 500, error.message);
    }
  });

  fastify.post('/logout', async (request, reply) => {
    reply.clearCookie('token');
    return sendSuccess(reply, null, 'Logout successful');
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
      const config = providerConfig(provider);
      if (!config?.clientId || !config.clientSecret) return oauthError(reply, `${provider} login is not configured`);
      const state = createState();
      const verifier = createCodeVerifier();
      reply.setCookie(`oauth_${provider}_state`, state, cookieOptions);
      reply.setCookie(`oauth_${provider}_verifier`, verifier, cookieOptions);
      const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: oauthCallback(provider), response_type: 'code', scope: config.scope, state });
      params.set('code_challenge', createCodeChallenge(verifier));
      params.set('code_challenge_method', 'S256');
      return reply.redirect(`${config.authorization}?${params}`);
    });

    fastify.route({
      method: 'GET',
      url: `/${provider}/callback`,
      handler: async (request, reply) => {
        try {
          const config = providerConfig(provider);
          const { code, state, error } = request.query || {};
          if (error) return oauthError(reply, 'Authentication cancelled');
          const verifier = request.cookies[`oauth_${provider}_verifier`];
          if (!config?.clientId || !code || !verifier || state !== request.cookies[`oauth_${provider}_state`]) {
            return oauthError(reply, 'Verification failed');
          }
          reply.clearCookie(`oauth_${provider}_state`, { path: '/' });
          reply.clearCookie(`oauth_${provider}_verifier`, { path: '/' });
          
          let profile;
          if (provider === 'google') {
            const token = await axios.post(config.token, new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: oauthCallback(provider), grant_type: 'authorization_code', code_verifier: verifier }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
            profile = await verifyGoogleIdentity(token, config.clientId);
          } else if (provider === 'github') {
            const token = await axios.post(config.token, { code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: oauthCallback(provider), code_verifier: verifier }, { headers: { Accept: 'application/json' } });
            // FIX: Added User-Agent header required by GitHub API
            const headers = { Authorization: `Bearer ${token.data.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'AfriStory-App' };
            const result = await axios.get('https://api.github.com/user', { headers });
            const emails = await axios.get('https://api.github.com/user/emails', { headers });
            const verifiedEmail = emails.data.find(e => e.primary && e.verified) || emails.data.find(e => e.verified);
            profile = { providerId: String(result.data.id), email: result.data.email || verifiedEmail?.email, emailVerified: true, name: result.data.name || result.data.login, picture: result.data.avatar_url };
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
}
