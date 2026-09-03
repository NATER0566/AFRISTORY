import crypto from 'crypto';

export function generateReference(prefix = 'TXN') {
  const safePrefix = String(prefix || 'TXN').replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'TXN';
  return `${safePrefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

export function generateOrderId() {
  return generateReference('ORDER');
}

export function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function isValidUsername(username) {
  if (typeof username !== 'string') return false;
  const usernameRegex = /^[a-zA-Z0-9_.\s]{3,30}$/;
  return usernameRegex.test(username);
}

export function paginate(page = 1, limit = 10) {
  const parsedPage = Number.parseInt(page, 10);
  const parsedLimit = Number.parseInt(limit, 10);
  const p = Math.max(1, Number.isFinite(parsedPage) ? parsedPage : 1);
  const l = Math.min(100, Math.max(1, Number.isFinite(parsedLimit) ? parsedLimit : 10));
  const skip = (p - 1) * l;
  return { skip, limit: l, page: p };
}

export function formatDecimal(value) {
  if (value === null || value === undefined || value === '') return 0;
  const number = Number(value.toString());
  return Number.isFinite(number) ? number : 0;
}

export function generateSecureToken(length = 32) {
  const byteLength = Number.parseInt(length, 10);
  if (!Number.isInteger(byteLength) || byteLength <= 0) {
    throw new RangeError('Token length must be a positive integer');
  }
  return crypto.randomBytes(byteLength).toString('hex');
}

export function isResetTime(lastResetDate) {
  const last = new Date(lastResetDate);
  if (Number.isNaN(last.getTime())) return true;

  const now = new Date();
  return (
    now.getUTCFullYear() !== last.getUTCFullYear() ||
    now.getUTCMonth() !== last.getUTCMonth() ||
    now.getUTCDate() !== last.getUTCDate()
  );
}
