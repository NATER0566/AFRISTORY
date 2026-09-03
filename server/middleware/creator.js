import { verifyCreator as enforceCreator } from './auth.js';

/**
 * Creator Middleware
 * Verifies JWT token AND enforces CREATOR or ADMIN role
 * Blocks users with USER role with 403 Forbidden
 */
export async function verifyCreator(request, reply) {
  return enforceCreator(request, reply);
}
