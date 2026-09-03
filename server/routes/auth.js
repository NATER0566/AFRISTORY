import User from '../models/User.js';
import Wallet from '../models/Wallet.js';
import { verifyAuth, generateToken, authCookieOptions } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { isValidEmail, isValidUsername } from '../utils/helpers.js';

const generateCode = () => String(Math.floor(100000 + Math.random() * 900000));
const codeExpiry = (minutes) => new Date(Date.now() + minutes * 60 * 1000);

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
      console.log(`[AUTH] Verification code for ${newUser.email}: ${newUser.verificationCode}`);

      // Create wallet
      await Wallet.create({
        userId: newUser._id,
      });

      // Generate token
      const token = generateToken(newUser._id);

      reply.setCookie('token', token, authCookieOptions);

      sendSuccess(
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
      fastify.log.error(error);
      sendError(reply, 'Registration failed', 500, error.message);
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

      if (!user.isVerified) {
        user.verificationCode = generateCode();
        user.verificationCodeExpires = codeExpiry(15);
        await user.save();
        console.log(`[AUTH] Verification code for ${user.email}: ${user.verificationCode}`);
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

      sendSuccess(
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
      fastify.log.error(error);
      sendError(reply, 'Login failed', 500, error.message);
    }
  });

  // Logout
  fastify.post('/logout', async (request, reply) => {
    reply.clearCookie('token');
    sendSuccess(reply, null, 'Logout successful');
  });

  // Get current user
  fastify.get('/me', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      sendSuccess(reply, {
        userId: request.user._id,
        username: request.user.username,
        email: request.user.email,
        role: request.user.role,
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch user', 500, error.message);
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
        // Don't reveal if email exists
        return sendSuccess(reply, null, 'If email exists, reset link has been sent', 200);
      }

      user.resetPasswordCode = generateCode();
      user.resetPasswordExpires = codeExpiry(15);
      await user.save();
      console.log(`[AUTH] Password reset code for ${user.email}: ${user.resetPasswordCode}`);
      sendSuccess(reply, null, 'If email exists, reset link has been sent', 200);
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to process request', 500, error.message);
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
      sendSuccess(reply, null, 'Email verified successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to verify email', 500, error.message);
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

      user.verificationCode = generateCode();
      user.verificationCodeExpires = codeExpiry(15);
      await user.save();
      console.log(`[AUTH] Verification code for ${user.email}: ${user.verificationCode}`);
      sendSuccess(reply, null, 'Verification code sent');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to resend verification code', 500, error.message);
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
      sendSuccess(reply, null, 'Password reset successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to reset password', 500, error.message);
    }
  });

  for (const provider of ['google', 'apple', 'github']) {
    fastify.get(`/${provider}`, async (request, reply) => {
      sendSuccess(reply, null, 'SSO coming soon');
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

      sendSuccess(reply, null, 'PIN set successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to set PIN', 500, error.message);
    }
  });
}
