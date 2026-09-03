import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import User from '../models/User.js';
import { sendError } from '../utils/response.js';

dotenv.config();

const COOKIE_NAME = 'token';
const TOKEN_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function getJwtSecret() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters');
  }
  return process.env.JWT_SECRET;
}

export async function verifyAuth(request, reply) {
  try {
    const token = request.cookies?.[COOKIE_NAME];

    if (!token) {
      return sendError(reply, 'Unauthorized - no token provided', 401);
    }

    const decoded = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'],
    });
    if (!decoded.id || typeof decoded.id !== 'string') {
      return sendError(reply, 'Unauthorized - invalid token', 401);
    }

    const user = await User.findById(decoded.id);

    if (!user || !user.isActive) {
      return sendError(reply, 'Unauthorized - user not found or inactive', 401);
    }

    request.user = user;
    return true;
  } catch (error) {
    return sendError(reply, 'Unauthorized - invalid token', 401);
  }
}

export async function verifyAdmin(request, reply) {
  if (!(await verifyAuth(request, reply))) return false;

  if (!request.user || request.user.role !== 'ADMIN') {
    sendError(reply, 'Forbidden - admin access required', 403);
    return false;
  }
  return true;
}

export async function verifyCreator(request, reply) {
  if (!(await verifyAuth(request, reply))) return false;

  if (!request.user || (request.user.role !== 'CREATOR' && request.user.role !== 'ADMIN')) {
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
