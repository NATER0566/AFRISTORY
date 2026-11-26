import crypto from 'crypto';
import Unlock from '../models/Unlock.js';
import Transaction from '../models/Transaction.js';
import RewardClaim from '../models/RewardClaim.js';

const ROBINS_WEBSITE_ID = process.env.ROBINS_ADS_WEBSITE_ID || '6b06e5d10354f7305a5bc51b';
const ROBINS_ZONE_ID = process.env.ROBINS_ADS_ZONE_ID || '9824292';
const ROBINS_SECRET = process.env.ROBINS_ADS_SECRET || process.env.JWT_SECRET || 'afristory-robins-ads';

function createHttpError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Generates a signed, single-use reward session ID if requested by the server.
 */
export function createRobinAdsRewardSession({ userId, purpose, targetId }) {
  const nonce = crypto.randomBytes(12).toString('hex');
  const issuedAt = Date.now();
  const raw = `${userId}:${purpose}:${targetId}:${issuedAt}:${nonce}`;
  const sig = crypto.createHmac('sha256', ROBINS_SECRET).update(raw).digest('hex').slice(0, 24);
  return `robins_${issuedAt}_${nonce}_${sig}`;
}

/**
 * Verifies a Robins Ads rewarded completion and ensures the rewardId has never been consumed before.
 */
export async function verifyAndConsumeRobinAdsReward({
  userId,
  rewardId,
  purpose = 'EPISODE_UNLOCK',
  targetId = '',
  session = null,
}) {
  if (!userId) {
    throw createHttpError('User authentication required for ad verification.', 401);
  }

  const cleanRewardId = String(rewardId || '').trim();
  if (!cleanRewardId || cleanRewardId.length < 8 || cleanRewardId.length > 180) {
    throw createHttpError('Invalid or missing Robins Ads reward session ID.', 400);
  }

  // 1. Atomic replay protection across Unlocks, Transactions, and RewardClaims
  const [usedInUnlock, usedInTx, usedInClaim] = await Promise.all([
    Unlock.exists({ transactionId: cleanRewardId }).session(session),
    Transaction.exists({
      $or: [
        { externalReference: cleanRewardId },
        { 'metadata.robinsRewardId': cleanRewardId },
      ],
    }).session(session),
    RewardClaim.exists({ 'metadata.robinsRewardId': cleanRewardId }).session(session),
  ]);

  if (usedInUnlock || usedInTx || usedInClaim) {
    throw createHttpError('This sponsor ad reward has already been used.', 409);
  }

  // 2. Optional Server-to-Server verification with Robins Ads API if configured in .env
  const verifyEndpoint = process.env.ROBINS_ADS_VERIFY_URL;
  if (verifyEndpoint) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const url = new URL(verifyEndpoint);
      url.searchParams.set('website_id', ROBINS_WEBSITE_ID);
      url.searchParams.set('zone_id', ROBINS_ZONE_ID);
      url.searchParams.set('reward_id', cleanRewardId);
      url.searchParams.set('user_id', String(userId));
      if (process.env.ROBINS_ADS_API_KEY) {
        url.searchParams.set('api_key', process.env.ROBINS_ADS_API_KEY);
      }

      const res = await fetch(url.toString(), {
        method: 'GET',
        signal: controller.signal,
      });

      if (!res.ok) {
        throw createHttpError('Robins Ads verification rejected this session.', 403);
      }

      const payload = await res.json().catch(() => ({}));
      if (payload.valid === false || payload.verified === false || payload.success === false) {
        throw createHttpError(payload.message || 'Sponsor ad could not be verified.', 403);
      }
    } catch (err) {
      if (err.statusCode) throw err;
      throw createHttpError('Unable to verify sponsor ad with Robins Ads right now.', 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    verified: true,
    provider: 'ROBINADS',
    websiteId: ROBINS_WEBSITE_ID,
    zoneId: ROBINS_ZONE_ID,
    rewardId: cleanRewardId,
    purpose,
    targetId,
    verifiedAt: new Date(),
  };
}

export default {
  createRobinAdsRewardSession,
  verifyAndConsumeRobinAdsReward,
};
