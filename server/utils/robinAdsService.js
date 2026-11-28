import AdRewardSession from '../models/AdRewardSession.js';
import Unlock from '../models/Unlock.js';
import Transaction from '../models/Transaction.js';
import RewardClaim from '../models/RewardClaim.js';

const ROBINS_API_BASE = 'https://robinsads.com/api/v1';
const ROBINS_LEGACY_VERIFY_URL = 'https://robinsads.com/api/ads/reward/verify';
const ROBINS_WEBSITE_ID = (
  process.env.ROBINS_ADS_WEBSITE_ID ||
  process.env.ROBINS_WEBSITE_ID ||
  '6b06e5d10354f7305a5bc51b'
).trim();

function getRobinsApiKey() {
  return (
    process.env.ROBINS_ADS_API_KEY ||
    process.env.ROBINADS_API_KEY ||
    ''
  ).trim();
}

function createHttpError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function normalizePurpose(purpose) {
  const normalized = String(purpose || '').toUpperCase();
  if (['REWARD', 'EARN_COINS', 'REWARD_CLAIM', 'PROMO_REWARD'].includes(normalized)) {
    return 'PROMO_REWARD';
  }
  if (['EPISODE_UNLOCK', 'UNLOCK_EPISODE', 'DIRECT_EPISODE_UNLOCK'].includes(normalized)) {
    return 'DIRECT_EPISODE_UNLOCK';
  }
  throw createHttpError('Reward purpose is invalid.', 400);
}

export function getRobinAdsPublicConfig() {
  return {
    provider: 'ROBINADS',
    enabled: Boolean(getRobinsApiKey()),
    websiteId: ROBINS_WEBSITE_ID,
    createEndpoint: '/api/ads/rewards/create',
    statusEndpointBase: '/api/ads/rewards',
  };
}

/**
 * Step 1 (Robins Ads Docs Section 3):
 * Calls POST https://robinsads.com/api/v1/rewards with Bearer ROBINS_ADS_API_KEY
 * and stores the target-bound pending reward session in MongoDB.
 */
export async function createRobinAdsRewardSession({
  userId,
  purpose = 'PROMO_REWARD',
  targetId = null,
  creatorId = null,
  coins = 0,
  ipAddress = null,
  userAgent = null,
}) {
  const normalizedPurpose = normalizePurpose(purpose);
  if (!targetId) throw createHttpError('A reward or episode target is required.', 400);

  const apiKey = getRobinsApiKey();
  if (!apiKey) {
    throw createHttpError(
      'ROBINS_ADS_API_KEY is missing in server environment variables.',
      500
    );
  }

  const enforcedCoins = normalizedPurpose === 'PROMO_REWARD' ? 5 : 0;

  const response = await fetch(`${ROBINS_API_BASE}/rewards`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      website_id: ROBINS_WEBSITE_ID,
      metadata: {
        user_id: String(userId),
        purpose: normalizedPurpose,
        target_id: String(targetId),
        coins: enforcedCoins || Number(coins || 0),
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload?.id || !payload?.popup_url) {
    const reason =
      payload?.error ||
      payload?.message ||
      `Robins Ads API rejected reward creation (HTTP ${response.status}).`;
    throw createHttpError(
      reason,
      response.status >= 400 && response.status < 500 ? response.status : 502
    );
  }

  const expiresAt = payload.expires_at
    ? new Date(payload.expires_at)
    : new Date(Date.now() + 15 * 60 * 1000);

  await AdRewardSession.findOneAndUpdate(
    { rewardId: payload.id },
    {
      $set: {
        userId,
        rewardId: payload.id,
        provider: 'ROBINADS',
        websiteId: payload.website_id || ROBINS_WEBSITE_ID,
        purpose: normalizedPurpose,
        targetId: String(targetId),
        creatorId,
        amount: enforcedCoins,
        status: 'PENDING',
        ipAddress,
        userAgent,
        expiresAt,
        metadata: {
          popup_url: payload.popup_url,
          created_at: payload.created_at || null,
        },
      },
    },
    { upsert: true, new: true }
  );

  return {
    id: payload.id,
    rewardId: payload.id,
    status: payload.status || 'pending',
    purpose: normalizedPurpose,
    targetId: String(targetId),
    website_id: payload.website_id || ROBINS_WEBSITE_ID,
    popup_url: payload.popup_url,
    popupUrl: payload.popup_url,
    expires_at: payload.expires_at || expiresAt.toISOString(),
  };
}

/**
 * Step 3 (Robins Ads Docs Section 3):
 * Polls GET https://robinsads.com/api/v1/rewards/:id until status is
 * "verified", "expired", or "rejected".
 */
export async function checkAndFulfillRobinAdsReward({
  userId,
  rewardId,
  session: dbSession = null,
}) {
  const cleanId = String(rewardId || '').trim();
  if (!cleanId) {
    throw createHttpError('Reward ID is required.', 400);
  }

  const apiKey = getRobinsApiKey();
  if (!apiKey) {
    throw createHttpError('ROBINS_ADS_API_KEY is not configured.', 500);
  }

  const session = await AdRewardSession.findOne({
    rewardId: cleanId,
    ...(userId ? { userId } : {}),
  }).session(dbSession);

  if (!session) {
    throw createHttpError('Reward session not found for this account.', 404);
  }

  if (session.status === 'CONSUMED' || session.status === 'COMPLETED') {
    return {
      id: session.rewardId,
      rewardId: session.rewardId,
      purpose: session.purpose,
      targetId: session.targetId,
      status: 'verified',
      verified: true,
      alreadyConsumed: session.status === 'CONSUMED',
      verified_at: session.verifiedAt,
    };
  }

  if (session.status === 'EXPIRED' || session.status === 'FAILED') {
    return {
      id: session.rewardId,
      rewardId: session.rewardId,
      purpose: session.purpose,
      targetId: session.targetId,
      status: session.status === 'EXPIRED' ? 'expired' : 'rejected',
      verified: false,
    };
  }

  if (session.expiresAt && session.expiresAt <= new Date()) {
    session.status = 'EXPIRED';
    await session.save({ session: dbSession });
    return {
      id: session.rewardId,
      rewardId: session.rewardId,
      purpose: session.purpose,
      targetId: session.targetId,
      status: 'expired',
      verified: false,
    };
  }

  const response = await fetch(
    `${ROBINS_API_BASE}/rewards/${encodeURIComponent(cleanId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

  const reward = await response.json().catch(() => ({}));

  if (!response.ok) {
    const reason =
      reward?.error ||
      reward?.message ||
      `Robins Ads status check failed (HTTP ${response.status}).`;
    throw createHttpError(
      reason,
      response.status >= 400 && response.status < 500 ? response.status : 502
    );
  }

  const remoteStatus = String(reward.status || 'pending').toLowerCase();

  if (remoteStatus === 'verified') {
    session.status = 'COMPLETED';
    session.verifiedAt = reward.verified_at ? new Date(reward.verified_at) : new Date();
    session.metadata = {
      ...(session.metadata || {}),
      robins_reward_id: reward.reward_id || null,
      verified_at: reward.verified_at || session.verifiedAt.toISOString(),
    };
    await session.save({ session: dbSession });

    return {
      id: session.rewardId,
      rewardId: session.rewardId,
      purpose: session.purpose,
      targetId: session.targetId,
      status: 'verified',
      verified: true,
      verified_at: session.verifiedAt,
      metadata: reward.metadata || {},
    };
  }

  if (remoteStatus === 'expired') {
    session.status = 'EXPIRED';
    await session.save({ session: dbSession });
    return {
      id: session.rewardId,
      rewardId: session.rewardId,
      purpose: session.purpose,
      targetId: session.targetId,
      status: 'expired',
      verified: false,
    };
  }

  if (remoteStatus === 'rejected') {
    session.status = 'FAILED';
    await session.save({ session: dbSession });
    return {
      id: session.rewardId,
      rewardId: session.rewardId,
      purpose: session.purpose,
      targetId: session.targetId,
      status: 'rejected',
      verified: false,
    };
  }

  return {
    id: session.rewardId,
    rewardId: session.rewardId,
    purpose: session.purpose,
    targetId: session.targetId,
    status: 'pending',
    verified: false,
  };
}

/**
 * Fallback verification for in-app RobinAds.showInterstitial()
 * (used when popup window is blocked or inside Telegram WebApp).
 */
async function verifyInterstitialCallbackToken({
  impressionId,
  token,
  userId,
  purpose,
  targetId,
  creatorId,
  session: dbSession = null,
}) {
  const cleanImpressionId = String(impressionId || '').trim();
  const cleanToken = String(token || '').trim();
  if (!cleanImpressionId || !cleanToken) {
    throw createHttpError('Missing Robins Ads interstitial impressionId or token.', 400);
  }

  const normalizedPurpose = normalizePurpose(purpose);
  const existing = await AdRewardSession.findOne({ rewardId: cleanImpressionId }).session(dbSession);

  if (existing && ['CONSUMED', 'EXPIRED', 'FAILED'].includes(existing.status)) {
    throw createHttpError('This ad reward has already been used or is no longer valid.', 409);
  }
  if (
    existing &&
    (existing.userId?.toString() !== userId?.toString() ||
      existing.purpose !== normalizedPurpose ||
      existing.targetId !== String(targetId))
  ) {
    throw createHttpError('Ad session does not match this user and target.', 409);
  }

  const response = await fetch(ROBINS_LEGACY_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      impressionId: cleanImpressionId,
      token: cleanToken,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.verified) {
    throw createHttpError('Robins Ads did not verify this interstitial watch.', 400);
  }

  await AdRewardSession.findOneAndUpdate(
    { rewardId: cleanImpressionId },
    {
      $set: {
        userId,
        rewardId: cleanImpressionId,
        provider: 'ROBINADS',
        websiteId: ROBINS_WEBSITE_ID,
        purpose: normalizedPurpose,
        targetId: String(targetId),
        creatorId: creatorId || null,
        amount: normalizedPurpose === 'PROMO_REWARD' ? 5 : 0,
        status: 'CONSUMED',
        verifiedAt: new Date(),
        consumedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    },
    { upsert: true, new: true, session: dbSession }
  );

  return {
    verified: true,
    provider: 'ROBINADS',
    rewardId: cleanImpressionId,
    transactionId: cleanImpressionId,
  };
}

/**
 * Called by wallet.js and rewards.js right before unlocking an episode or crediting coins.
 * Guarantees server-side Robins Ads verification and single-use replay protection.
 */
export async function verifyAndConsumeRobinAdsReward(arg1, arg2, arg3) {
  const params =
    typeof arg1 === 'object' && arg1 !== null
      ? arg1
      : { rewardId: arg1, userId: arg2, ...(typeof arg3 === 'object' && arg3 !== null ? arg3 : {}) };

  const {
    rewardId,
    transactionId,
    token,
    userId,
    purpose = 'PROMO_REWARD',
    targetId = null,
    creatorId = null,
    session: dbSession = null,
  } = params;

  const cleanId = String(rewardId || transactionId || '').trim();
  if (!cleanId) {
    throw createHttpError('Missing Robins Ads rewardId.', 400);
  }

  const normalizedPurpose = normalizePurpose(purpose);
  if (!targetId) throw createHttpError('A reward or episode target is required.', 400);

  // Global duplicate replay check across all ledger collections
  const [alreadyUnlocked, alreadyTx, alreadyClaimed] = await Promise.all([
    Unlock.exists({ $or: [{ transactionId: cleanId }, { rewardId: cleanId }] }).session(dbSession),
    Transaction.exists({ sourceAdIds: cleanId }).session(dbSession),
    RewardClaim.exists({ 'metadata.robinsRewardId': cleanId }).session(dbSession),
  ]);

  if (alreadyUnlocked || alreadyTx || alreadyClaimed) {
    throw createHttpError('This ad reward has already been used.', 409);
  }

  if (token) {
    return verifyInterstitialCallbackToken({
      impressionId: cleanId,
      token,
      userId,
      purpose: normalizedPurpose,
      targetId,
      creatorId,
      session: dbSession,
    });
  }

  const adSession = await AdRewardSession.findOne({
    rewardId: cleanId,
    ...(userId ? { userId } : {}),
    purpose: normalizedPurpose,
    targetId: String(targetId),
    ...(creatorId ? { creatorId } : {}),
    status: { $in: ['PENDING', 'COMPLETED'] },
  }).session(dbSession);

  if (!adSession) {
    throw createHttpError('Ad session is missing, already used, or not bound to this target.', 409);
  }

  if (adSession.expiresAt && adSession.expiresAt <= new Date()) {
    adSession.status = 'EXPIRED';
    await adSession.save({ session: dbSession });
    throw createHttpError('Ad session expired. Please watch the ad again.', 409);
  }

  // Primary Section 3 Reward API verification against GET https://robinsads.com/api/v1/rewards/:id
  const statusResult = await checkAndFulfillRobinAdsReward({
    userId,
    rewardId: cleanId,
    session: dbSession,
  });

  if (!statusResult.verified) {
    throw createHttpError(
      statusResult.status === 'expired'
        ? 'Ad session expired. Please watch the ad again.'
        : statusResult.status === 'rejected'
        ? 'Ad watch failed verification.'
        : 'Please finish watching the full sponsor ad before claiming.',
      400
    );
  }

  // Atomically mark session as CONSUMED so it can never be claimed twice
  const consumed = await AdRewardSession.findOneAndUpdate(
    {
      rewardId: cleanId,
      ...(userId ? { userId } : {}),
      purpose: normalizedPurpose,
      targetId: String(targetId),
      status: 'COMPLETED',
    },
    {
      $set: {
        status: 'CONSUMED',
        consumedAt: new Date(),
      },
    },
    { new: true, session: dbSession }
  );

  if (!consumed) {
    throw createHttpError('This ad reward has already been claimed.', 409);
  }

  return {
    verified: true,
    provider: 'ROBINADS',
    rewardId: cleanId,
    transactionId: cleanId,
  };
}

export const verifyRobinAdsReward = verifyAndConsumeRobinAdsReward;
