import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import User from '../models/User.js';
import { sendError } from '../utils/response.js';

dotenv.config();

const COOKIE_NAME = 'token';
const TOKEN_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function getJwtSecret() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    const errorMsg = 'JWT_SECRET must be configured with at least 32 characters';
    console.error(`[MIDDLEWARE_CONFIG_CRITICAL] ${errorMsg}`);
    throw new Error(errorMsg);
  }
  return process.env.JWT_SECRET;
}

export async function verifyAuth(request, reply) {
  try {
    const token = request.cookies?.[COOKIE_NAME];

    if (!token) {
      console.warn(`[MIDDLEWARE_NO_TOKEN] Blocked access to ${request.url}: No token cookie provided.`);
      return sendError(reply, 'Unauthorized - no token provided', 401);
    }

    const decoded = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'],
    });
    
    if (!decoded.id || typeof decoded.id !== 'string') {
      console.warn(`[MIDDLEWARE_INVALID_PAYLOAD] Blocked access to ${request.url}: Token decoded but missing valid ID. Payload: ${JSON.stringify(decoded)}`);
      return sendError(reply, 'Unauthorized - invalid token', 401);
    }

    const user = await User.findById(decoded.id);

    if (!user) {
      console.warn(`[MIDDLEWARE_USER_NOT_FOUND] Blocked access to ${request.url}: Token contains ID ${decoded.id} but user does not exist in the database.`);
      return sendError(reply, 'Unauthorized - user not found or inactive', 401);
    }

    if (!user.isActive) {
      console.warn(`[MIDDLEWARE_USER_INACTIVE] Blocked access to ${request.url}: User ${user.email} is deactivated.`);
      return sendError(reply, 'Unauthorized - user not found or inactive', 401);
    }

    // CRITICAL FIX: Strictly prevent unverified users from bypassing the OTP check
    if (!user.isVerified) {
      console.warn(`[MIDDLEWARE_UNVERIFIED_ACCESS] Blocked access to ${request.url}: User ${user.email} is not verified. Routing back to OTP screen.`);
      return reply.status(403).send({ success: false, code: 'UNVERIFIED', message: 'Verification required' });
    }

    request.user = user;
    return true;
  } catch (error) {
    // Only log as an error if it's not a standard expiration, to keep Render logs clean from routine timeouts
    if (error.name === 'TokenExpiredError') {
      console.info(`[MIDDLEWARE_TOKEN_EXPIRED] User token expired for access to ${request.url}`);
    } else {
      console.error(`[MIDDLEWARE_JWT_ERROR] Failed to verify token for ${request.url}. Details: ${error.message}\nStack: ${error.stack}`);
    }
    return sendError(reply, 'Unauthorized - invalid token', 401);
  }
}

export async function verifyAdmin(request, reply) {
  if (!(await verifyAuth(request, reply))) return false;

  if (!request.user || request.user.role !== 'ADMIN') {
    console.warn(`[MIDDLEWARE_ADMIN_FORBIDDEN] User ${request.user?.email} (Role: ${request.user?.role}) attempted to access admin route ${request.url}`);
    if (reply.sent) return false;
    sendError(reply, 'Forbidden - admin access required', 403);
    return false;
  }
  return true;
}

export async function verifyCreator(request, reply) {
  if (!(await verifyAuth(request, reply))) return false;

  if (!request.user || (request.user.role !== 'CREATOR' && request.user.role !== 'ADMIN')) {
    console.warn(`[MIDDLEWARE_CREATOR_FORBIDDEN] User ${request.user?.email} (Role: ${request.user?.role}) attempted to access creator route ${request.url}`);
    if (reply.sent) return false;
    sendError(reply, 'Forbidden - creator access required', 403);
    return false;
  }
  return true;
}

export function generateToken(userId, expiresIn = '7d') {
  return jwt.sign({ id: userId.toString() }, getJwtSecret(), {
    expiresIn,
    algorithm: 'HS256',
  });
}

export const authCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: TOKEN_MAX_AGE_SECONDS,
};
