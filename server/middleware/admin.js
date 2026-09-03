import { verifyAdmin as enforceAdmin } from './auth.js';

/**
 * Admin Middleware
 * Verifies JWT token AND enforces ADMIN role
 * Blocks any non-admin user with 403 Forbidden
 */
export async function verifyAdmin(request, reply) {
  return enforceAdmin(request, reply);
}
