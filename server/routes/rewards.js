import mongoose from 'mongoose';
import Reward from '../models/Reward.js';
import RewardClaim from '../models/RewardClaim.js';
import RewardAudit from '../models/RewardAudit.js';
import Wallet from '../models/Wallet.js';
import Transaction from '../models/Transaction.js';
import User from '../models/User.js';
import History from '../models/History.js';
import Favorite from '../models/Favorite.js';
import { verifyAuth, verifyAdmin } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { generateReference, formatDecimal } from '../utils/helpers.js';
import { createNotification } from '../utils/notificationService.js';
import { verifyAndConsumeRobinAdsReward } from '../utils/robinAdsService.js';
import { creditPromotionalCoins } from '../services/ledgerService.js';

const timezone = process.env.REWARD_TIMEZONE || 'Africa/Lagos';

const periodKey = (date = new Date(), type = 'once', uniqueToken = '') => {
  if (type === 'per_ad' || type === 'unlimited') {
    return uniqueToken ? `ad:${uniqueToken}` : `ad:${Date.now()}`;
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const day = `${values.year}-${values.month}-${values.day}`;
  if (type === 'daily') return day;
  if (type === 'monthly') return day.slice(0, 7);
  if (type === 'weekly') {
    const current = new Date(`${day}T12:00:00Z`);
    const weekDay = current.getUTCDay() || 7;
    current.setUTCDate(current.getUTCDate() - weekDay + 1);
    return `${current.getUTCFullYear()}-W${String(Math.ceil((current.getUTCDate() + 6) / 7)).padStart(2, '0')}`;
  }
  return 'once';
};

const activeQuery = () => ({
  status: 'ACTIVE',
  $and: [
    { $or: [{ startAt: null }, { startAt: { $lte: new Date() } }] },
    { $or: [{ endAt: null }, { endAt: { $gt: new Date() } }] },
  ],
});

const dateDistance = (left, right) =>
  Math.round((new Date(`${left}T12:00:00Z`) - new Date(`${right}T12:00:00Z`)) / 86400000);

function walletBalances(wallet) {
  if (!wallet) {
    return {
      balance: 0,
      promotionalCoins: 0,
      purchasedCoins: 0,
      legacyRestrictedCoins: 0,
      vipCredits: 0,
      totalStoryCoins: 0,
    };
  }
  const promotionalCoins = formatDecimal(wallet.promotionalCoins || 0);
  const purchasedCoins = formatDecimal(wallet.purchasedCoins || 0);
  const legacyRestrictedCoins = formatDecimal(wallet.legacyRestrictedCoins || 0);
  const vipCredits = formatDecimal(wallet.vipCredits || 0);
  const totalStoryCoins = formatDecimal(
    wallet.storyCoins ?? purchasedCoins + promotionalCoins + legacyRestrictedCoins
  );
  return {
    balance: promotionalCoins,
    promotionalCoins,
    purchasedCoins,
    legacyRestrictedCoins,
    vipCredits,
    totalStoryCoins,
  };
}

async function ensureDefaultRewards() {
  const defaults = [
    {
      name: 'Welcome to AfroStory',
      description: 'A one-time welcome gift for verified members.',
      type: 'ONE_TIME',
      category: 'welcome',
      rewardAmount: 5,
      recurrenceType: 'once',
      maxClaimsPerUser: 1,
      metadata: { key: 'welcome' },
    },
    {
      name: 'Daily Check-in',
      description: 'Return each day to keep your story streak alive.',
      type: 'DAILY',
      category: 'daily',
      rewardAmount: 5,
      recurrenceType: 'daily',
      maxClaimsPerUser: null,
      metadata: { key: 'daily_checkin', schedule: [5, 5, 5, 5, 5, 5, 5] },
    },
    {
      name: 'Complete Your Profile',
      description: 'Complete your profile and verify a sponsor ad to earn 5 promotional coins.',
      type: 'PROFILE',
      category: 'profile',
      rewardAmount: 5,
      recurrenceType: 'once',
      maxClaimsPerUser: 1,
      verificationMode: 'ad',
      metadata: { key: 'profile_complete', requiresAd: true },
    },
    {
      name: 'Watch Ads & Earn Coins',
      description: 'Complete a verified sponsor ad to earn 5 promotional coins.',
      type: 'DAILY',
      category: 'ads',
      rewardAmount: 5,
      recurrenceType: 'per_ad',
      maxClaimsPerUser: null,
      verificationMode: 'ad',
      metadata: { key: 'watch_ads', requiresAd: true },
    },
    {
      name: 'First Story Saved',
      description: 'Save a story to return to later.',
      type: 'DISCOVERY',
      category: 'discovery',
      rewardAmount: 5,
      recurrenceType: 'once',
      maxClaimsPerUser: 1,
      metadata: { key: 'first_save' },
    },
    {
      name: 'First Story Favorited',
      description: 'Mark a story that deserves a place in your favorites.',
      type: 'DISCOVERY',
      category: 'discovery',
      rewardAmount: 5,
      recurrenceType: 'once',
      maxClaimsPerUser: 1,
      metadata: { key: 'first_favorite' },
    },
  ];

  const socialDefaults = [
    ['Facebook', 'https://www.facebook.com/profile.php?id=61579451935484', 5, 'Follow us on Facebook', 'social_facebook'],
    ['Instagram', 'https://www.instagram.com/natergracecode/', 5, 'Follow us on Instagram', 'social_instagram'],
    ['YouTube', process.env.REWARD_SOCIAL_YOUTUBE_URL, 5, 'Subscribe to AfroStory on YouTube', 'social_youtube'],
    ['TikTok', process.env.REWARD_SOCIAL_TIKTOK_URL, 5, 'Follow AfroStory on TikTok', 'social_tiktok'],
    ['X', process.env.REWARD_SOCIAL_X_URL, 5, 'Follow AfroStory on X', 'social_x'],
  ];

  socialDefaults.forEach(([platform, targetUrl, rewardAmount, name, taskId]) => {
    if (targetUrl) {
      defaults.push({
        name,
        description: `Connect with AFROSTORY on ${platform}. Follow the account, then claim this one-time reward.`,
        type: 'SOCIAL',
        category: 'social',
        rewardAmount,
        recurrenceType: 'once',
        verificationMode: 'server',
        maxClaimsPerUser: 1,
        metadata: { key: taskId, taskId, platform, targetUrl },
      });
    }
  });

  for (const item of defaults) {
    const enforcedFields = {
      rewardAmount: 5,
      ...(item.metadata?.key === 'watch_ads'
        ? {
            recurrenceType: 'per_ad',
            verificationMode: 'ad',
            'metadata.requiresAd': true,
          }
        : {}),
      ...(item.metadata?.key === 'profile_complete'
        ? {
            verificationMode: 'ad',
            'metadata.requiresAd': true,
          }
        : {}),
      ...(item.metadata?.schedule ? { 'metadata.schedule': [5, 5, 5, 5, 5, 5, 5] } : {}),
      ...(item.type === 'SOCIAL' ? { status: 'ACTIVE', ...item } : {}),
    };

    await Reward.updateOne(
      { 'metadata.key': item.metadata.key },
      {
        $set: enforcedFields,
        $setOnInsert: { ...item, status: 'ACTIVE', createdAt: new Date() },
      },
      { upsert: true }
    );
  }
}

async function profileEligible(user, reward) {
  if (reward.metadata?.key !== 'profile_complete') return true;
  const profile = user.profile || {};
  return Boolean(
    profile.displayName &&
      (profile.avatarUrl || user.profileImage) &&
      profile.country &&
      profile.preferredLanguage &&
      profile.favoriteGenres?.length
  );
}

async function getEligibility(user, reward, claims) {
  const isPerAd = reward.recurrenceType === 'per_ad' || reward.recurrenceType === 'unlimited';
  if (!isPerAd) {
    const currentPeriod = periodKey(new Date(), reward.recurrenceType);
    const claim = claims.find(
      (item) =>
        item.rewardId.toString() === reward._id.toString() &&
        item.status !== 'REJECTED' &&
        (item.status === 'PENDING' || item.periodKey === currentPeriod)
    );
    if (claim) {
      return {
        state: claim.status === 'PENDING' ? 'PENDING_VERIFICATION' : 'CLAIMED',
        reason: claim.status === 'PENDING' ? 'Waiting for verification.' : 'Reward already claimed.',
      };
    }
  }

  if (reward.endAt && reward.endAt <= new Date()) {
    return { state: 'EXPIRED', reason: 'This reward has expired.' };
  }

  const key = reward.metadata?.key;
  if (key === 'welcome') {
    return user.isVerified
      ? { state: 'CLAIMABLE', reason: 'Welcome reward ready.' }
      : { state: 'LOCKED', reason: 'Verify your email to unlock this reward.' };
  }
  if (key === 'first_save') {
    return (await Favorite.exists({ userId: user._id }))
      ? { state: 'CLAIMABLE', reason: 'Your first story is saved.' }
      : { state: 'LOCKED', reason: 'Save a story to unlock this reward.' };
  }
  if (key === 'first_favorite') {
    return (await Favorite.exists({ userId: user._id }))
      ? { state: 'CLAIMABLE', reason: 'Your first story is favorited.' }
      : { state: 'LOCKED', reason: 'Favorite a story to unlock this reward.' };
  }
  if (key === 'profile_complete') {
    return (await profileEligible(user, reward))
      ? { state: 'CLAIMABLE', reason: 'Profile complete. Watch a short ad to claim 5 coins.' }
      : { state: 'LOCKED', reason: 'Complete your profile to unlock this reward.' };
  }
  if (
    reward.type === 'SOCIAL' ||
    reward.verificationMode === 'manual_claim' ||
    reward.verificationMode === 'admin_verified'
  ) {
    return {
      state: 'CLAIMABLE',
      reason: 'Visit the official account, then claim this one-time reward.',
    };
  }
  if (reward.metadata?.requiresHistory) {
    return (await History.exists({ userId: user._id }))
      ? { state: 'CLAIMABLE', reason: 'Requirement completed.' }
      : { state: 'LOCKED', reason: 'Watch an eligible story to unlock this reward.' };
  }
  return { state: 'CLAIMABLE', reason: 'Reward ready to claim.' };
}

async function issueReward({
  reward,
  user,
  request,
  session,
  period,
  metadata = {},
  approved = false,
  adVerification = null,
}) {
  const taskId = reward.metadata?.taskId || null;
  const existing = await RewardClaim.findOne(
    taskId
      ? { userId: user._id, $or: [{ taskId }, { rewardId: reward._id, periodKey: period }] }
      : { rewardId: reward._id, userId: user._id, periodKey: period }
  ).session(session);
  if (existing) return { claim: existing, duplicate: true };

  if (!(await profileEligible(user, reward))) {
    throw new Error('Reward eligibility requirements are not complete');
  }
  if (reward.endAt && reward.endAt <= new Date()) {
    throw new Error('Reward has expired');
  }
  if (
    reward.recurrenceType === 'once' &&
    reward.maxClaimsPerUser &&
    (await RewardClaim.countDocuments({ rewardId: reward._id, userId: user._id }).session(session)) >=
      reward.maxClaimsPerUser
  ) {
    throw new Error('Per-user reward limit reached');
  }
  if (
    reward.maxClaims &&
    (await RewardClaim.countDocuments({ rewardId: reward._id }).session(session)) >= reward.maxClaims
  ) {
    throw new Error('Reward claim limit reached');
  }

  if (
    !approved &&
    !taskId &&
    (reward.type === 'SOCIAL' ||
      reward.verificationMode === 'manual_claim' ||
      reward.verificationMode === 'admin_verified')
  ) {
    const pendingMetadata = adVerification
      ? { ...metadata, provider: 'ROBINADS', robinsRewardId: adVerification.rewardId }
      : metadata;
    const pending = await RewardClaim.create(
      [
        {
          rewardId: reward._id,
          userId: user._id,
          amount: 5,
          periodKey: period,
          referenceId: generateReference('PENDING'),
          status: 'PENDING',
          metadata: pendingMetadata,
        },
      ],
      { session }
    );
    return { claim: pending[0], pending: true };
  }

  const eligibility = await getEligibility(user, reward, []);
  if (eligibility.state !== 'CLAIMABLE') {
    throw new Error(eligibility.reason);
  }

  const previousClaims = await RewardClaim.countDocuments({
    rewardId: reward._id,
    userId: user._id,
  }).session(session);

  // Rule 2: Every promotional reward credits strictly 5 promotional coins
  const amount = 5;

  if (reward.metadata?.schedule) {
    const today = periodKey(new Date(), 'daily');
    const previousDay = user.rewardStats?.lastCheckInAt
      ? periodKey(user.rewardStats.lastCheckInAt, 'daily')
      : null;
    const consecutive = previousDay && dateDistance(today, previousDay) === 1;
    user.rewardStats.currentStreak = consecutive ? (user.rewardStats.currentStreak || 0) + 1 : 1;
    user.rewardStats.bestStreak = Math.max(
      user.rewardStats.bestStreak || 0,
      user.rewardStats.currentStreak
    );
    user.rewardStats.totalCheckInDays = (user.rewardStats.totalCheckInDays || 0) + 1;
    user.rewardStats.currentRewardDay = (previousClaims % 7) + 1;
    user.rewardStats.lastCheckInAt = new Date();
    await user.save({ session });
  }

  const referenceId = generateReference('REWARD');
  const credit = await creditPromotionalCoins({
    userId: user._id,
    reference: referenceId,
    rewardAdId: adVerification?.rewardId || null,
    rewardTargetId: String(reward._id),
    verified: true,
    metadata: {
      rewardId: reward._id,
      rewardKey: reward.metadata?.key || null,
      taskId,
      source: adVerification ? 'ROBINADS' : reward.type,
    },
    session,
  });

  const mergedMetadata = adVerification
    ? { ...metadata, provider: 'ROBINADS', robinsRewardId: adVerification.rewardId }
    : metadata;

  const claim = await RewardClaim.create(
    [
      {
        rewardId: reward._id,
        taskId,
        userId: user._id,
        amount,
        periodKey: period,
        referenceId,
        verifiedAt: reward.verificationMode === 'server' || adVerification ? new Date() : null,
        metadata: mergedMetadata,
      },
    ],
    { session }
  );

  await RewardAudit.create(
    [
      {
        userId: user._id,
        rewardId: reward._id,
        claimId: claim[0]._id,
        amount,
        source: adVerification ? 'ROBINADS' : reward.type,
        action: 'ISSUED',
        status: 'SUCCESS',
        referenceId,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      },
    ],
    { session }
  );

  return {
    claim: claim[0],
    wallet: credit.wallet,
    balance: credit.wallet.totalStoryCoins,
    amount,
    rewardName: reward.name,
    rewardId: reward._id,
  };
}

export default async function rewardRoutes(fastify) {
  fastify.get('/me', async (request, reply) => {
    try {
      if (!(await verifyAuth(request, reply))) return;
      await ensureDefaultRewards();

      const rewards = await Reward.find(activeQuery()).sort({ category: 1, createdAt: 1 });
      const claims = await RewardClaim.find({
        userId: request.user._id,
        rewardId: { $in: rewards.map((reward) => reward._id) },
      });
      const claimMap = new Map(claims.map((claim) => [`${claim.rewardId}:${claim.periodKey}`, claim]));
      const wallet = await Wallet.findOne({ userId: request.user._id });
      const daily = rewards.find((reward) => reward.metadata?.schedule);
      const todayClaim = daily && claimMap.get(`${daily._id}:${periodKey(new Date(), 'daily')}`);
      const watchAdsReward = rewards.find((reward) => reward.metadata?.key === 'watch_ads') || null;

      const history = await Transaction.find({ userId: request.user._id })
        .sort({ createdAt: -1 })
        .limit(20);

      const rewardStates = await Promise.all(
        rewards.map(async (reward) => {
          const isPerAd = reward.recurrenceType === 'per_ad' || reward.recurrenceType === 'unlimited';
          return {
            ...reward.toObject(),
            rewardAmount: 5,
            requiresAd: Boolean(reward.metadata?.requiresAd || reward.verificationMode === 'ad'),
            eligibility: await getEligibility(request.user, reward, claims),
            claimed: isPerAd
              ? false
              : Boolean(
                  claimMap.get(`${reward._id}:${periodKey(new Date(), reward.recurrenceType)}`)
                ),
          };
        })
      );

      const visibleRewards = rewardStates.filter((r) => {
        const isOneTimeCategory = ['ONE_TIME', 'PROFILE', 'DISCOVERY'].includes(r.type);
        if (isOneTimeCategory && r.eligibility.state === 'CLAIMED') return false;
        return true;
      });

      const balances = walletBalances(wallet);

      return sendSuccess(reply, {
        ...balances,
        streak: request.user.rewardStats || {},
        watchAdsReward: watchAdsReward
          ? {
              _id: watchAdsReward._id,
              name: watchAdsReward.name,
              rewardAmount: 5,
              requiresAd: true,
            }
          : null,
        daily: daily
          ? {
              ...daily.toObject(),
              rewardAmount: 5,
              claimed: Boolean(todayClaim),
              periodKey: periodKey(new Date(), 'daily'),
            }
          : null,
        rewards: visibleRewards,
        history: history.map((item) => ({
          ...item.toObject(),
          amount: formatDecimal(item.amount),
        })),
      });
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to load rewards', 500, error.message);
    }
  });

  // Dedicated endpoint for Wallet & Rewards "Watch Ad & Earn Coins" buttons (always 5 promotional coins)
  fastify.post('/watch-ad/claim', async (request, reply) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      if (!(await verifyAuth(request, reply))) {
        await session.abortTransaction();
        return;
      }

      await ensureDefaultRewards();
      const watchAdsReward = await Reward.findOne({
        'metadata.key': 'watch_ads',
        ...activeQuery(),
      }).session(session);

      if (!watchAdsReward) {
        await session.abortTransaction();
        return sendError(reply, 'Watch Ads reward is currently unavailable', 404);
      }

      const {
        provider = 'ROBINADS',
        rewardId: robinsRewardId,
        transactionId,
        token,
        receipt,
      } = request.body || {};

      const normalizedProvider = String(provider).toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!['ROBINADS', 'ROBINSADS'].includes(normalizedProvider)) {
        await session.abortTransaction();
        return sendError(reply, 'Unsupported ad provider. Expected ROBINADS.', 400);
      }

      const resolvedRobinsId = String(
        robinsRewardId ||
          transactionId ||
          receipt?.rewardId ||
          receipt?.transactionId ||
          receipt?.id ||
          ''
      ).trim();

      if (!resolvedRobinsId) {
        await session.abortTransaction();
        return sendError(reply, 'You must watch the full ad to earn 5 promotional coins.', 403);
      }

      const adVerification = await verifyAndConsumeRobinAdsReward({
        userId: request.user._id,
        rewardId: resolvedRobinsId,
        purpose: 'PROMO_REWARD',
        targetId: String(watchAdsReward._id),
        token: token || receipt?.token,
        session,
      });

      const result = await issueReward({
        reward: watchAdsReward,
        user: request.user,
        request,
        session,
        period: periodKey(new Date(), 'per_ad', resolvedRobinsId),
        adVerification,
      });

      if (result.duplicate) {
        await session.abortTransaction();
        return sendError(reply, 'This ad reward has already been claimed', 409);
      }

      const updatedWallet = await Wallet.findOne({ userId: request.user._id }).session(session);
      await session.commitTransaction();

      if (result.claim) {
        createNotification({
          userId: request.user._id,
          type: 'REWARD_EARNED',
          title: 'You earned 5 Promotional Coins 🎉',
          message: 'Verified sponsor ad completed.',
          targetUrl: '#rewards',
          icon: 'https://ui-avatars.com/api/?name=AfriStory&background=d4a017&color=fff&size=192',
          data: { rewardId: result.rewardId, claimId: result.claim._id },
          dedupeKey: `reward_${result.claim._id}`,
        }).catch((err) => fastify.log.error('Push error:', err));
      }

      return sendSuccess(
        reply,
        {
          claim: result.claim,
          amount: 5,
          ...walletBalances(updatedWallet),
        },
        '5 promotional coins credited'
      );
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      if (error?.code === 11000) {
        return sendError(reply, 'This ad reward has already been claimed', 409);
      }
      fastify.log.error(error);
      return sendError(reply, error.message || 'Failed to claim ad reward', error.statusCode || 400);
    } finally {
      await session.endSession();
    }
  });

  fastify.post('/:rewardId/claim', async (request, reply) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      if (!(await verifyAuth(request, reply))) {
        await session.abortTransaction();
        return;
      }

      const {
        method = 'MANUAL',
        provider = 'ROBINADS',
        rewardId: robinsRewardId,
        transactionId,
        token,
        receipt,
      } = request.body || {};

      const reward = await Reward.findOne({
        _id: request.params.rewardId,
        ...activeQuery(),
      }).session(session);
      if (!reward) {
        await session.abortTransaction();
        return sendError(reply, 'Reward is unavailable', 404);
      }

      const requiresAd =
        String(method).toUpperCase() === 'AD' ||
        Boolean(reward.metadata?.requiresAd) ||
        reward.verificationMode === 'ad';

      let adVerification = null;
      let resolvedRobinsId = '';

      if (requiresAd) {
        const normalizedProvider = String(provider).toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!['ROBINADS', 'ROBINSADS'].includes(normalizedProvider)) {
          await session.abortTransaction();
          return sendError(reply, 'Unsupported ad provider. Expected ROBINADS.', 400);
        }

        resolvedRobinsId = String(
          robinsRewardId ||
            transactionId ||
            receipt?.rewardId ||
            receipt?.transactionId ||
            receipt?.id ||
            ''
        ).trim();

        if (!resolvedRobinsId) {
          await session.abortTransaction();
          return sendError(reply, 'You must watch the full ad to claim this reward.', 403);
        }

        adVerification = await verifyAndConsumeRobinAdsReward({
          userId: request.user._id,
          rewardId: resolvedRobinsId,
          purpose: 'PROMO_REWARD',
          targetId: String(reward._id),
          token: token || receipt?.token,
          session,
        });
      }

      const isPerAd = reward.recurrenceType === 'per_ad' || reward.recurrenceType === 'unlimited';
      const period = isPerAd
        ? periodKey(new Date(), 'per_ad', resolvedRobinsId)
        : periodKey(new Date(), reward.recurrenceType);

      const result = await issueReward({
        reward,
        user: request.user,
        request,
        session,
        period,
        adVerification,
      });

      if (result.duplicate) {
        await session.abortTransaction();
        return sendError(reply, 'Reward already claimed for this period', 409);
      }

      const updatedWallet = await Wallet.findOne({ userId: request.user._id }).session(session);
      await session.commitTransaction();

      if (!result.pending && result.claim) {
        createNotification({
          userId: request.user._id,
          type: 'REWARD_EARNED',
          title: `You earned ${result.amount} coins 🎉`,
          message: result.rewardName,
          targetUrl: '#rewards',
          icon: 'https://ui-avatars.com/api/?name=AfriStory&background=d4a017&color=fff&size=192',
          data: { rewardId: result.rewardId, claimId: result.claim._id },
          dedupeKey: `reward_${result.claim._id}`,
        }).catch((err) => fastify.log.error('Push error:', err));
      }

      return sendSuccess(
        reply,
        {
          claim: result.claim,
          amount: result.amount || 5,
          ...walletBalances(updatedWallet),
          pending: Boolean(result.pending),
        },
        result.pending ? 'Reward submitted for verification' : 'Reward claimed'
      );
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      if (error?.code === 11000) return sendError(reply, 'Reward already claimed', 409);
      fastify.log.error(error);
      return sendError(reply, error.message || 'Failed to claim reward', error.statusCode || 400);
    } finally {
      await session.endSession();
    }
  });

  fastify.get('/admin/list', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;
      const rewards = await Reward.find().sort({ createdAt: -1 });
      return sendSuccess(reply, rewards);
    } catch (error) {
      return sendError(reply, 'Failed to fetch rewards', 500, error.message);
    }
  });

  fastify.post('/admin', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;
      if (Number(request.body?.rewardAmount) !== 5) {
        return sendError(reply, 'Promotional rewards must be exactly 5 coins.', 400);
      }
      const reward = await Reward.create({ ...request.body, createdBy: request.user._id });
      return sendSuccess(reply, reward, 'Reward created', 201);
    } catch (error) {
      return sendError(reply, 'Failed to create reward', 400, error.message);
    }
  });

  fastify.post('/admin/claims/:claimId/approve', async (request, reply) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      if (!(await verifyAdmin(request, reply))) {
        await session.abortTransaction();
        return;
      }
      const claim = await RewardClaim.findOne({
        _id: request.params.claimId,
        status: 'PENDING',
      }).session(session);
      if (!claim) {
        await session.abortTransaction();
        return sendError(reply, 'Pending claim not found', 404);
      }
      const reward = await Reward.findById(claim.rewardId).session(session);
      const user = await User.findById(claim.userId).session(session);
      if (!reward || !user) {
        await session.abortTransaction();
        return sendError(reply, 'Reward or user not found', 404);
      }

      const result = await issueReward({
        reward,
        user,
        request,
        session,
        period: `${claim.periodKey}:approved`,
        approved: true,
        adVerification: claim.metadata?.robinsRewardId
          ? {
              rewardId: claim.metadata.robinsRewardId,
              provider: 'ROBINADS',
              verified: true,
            }
          : null,
        metadata: {
          approvedClaimId: claim._id,
          ...(claim.metadata?.robinsRewardId
            ? {
                provider: 'ROBINADS',
                robinsRewardId: claim.metadata.robinsRewardId,
              }
            : {}),
        },
      });

      claim.status = 'CLAIMED';
      claim.verifiedAt = new Date();
      await claim.save({ session });
      await session.commitTransaction();

      if (result.claim) {
        createNotification({
          userId: user._id,
          type: 'REWARD_EARNED',
          title: `You earned ${result.amount} coins 🎉`,
          message: result.rewardName,
          targetUrl: '#rewards',
          icon: 'https://ui-avatars.com/api/?name=AfriStory&background=d4a017&color=fff&size=192',
          data: { rewardId: result.rewardId, claimId: result.claim._id },
          dedupeKey: `reward_${result.claim._id}`,
        }).catch((err) => fastify.log.error('Push error:', err));
      }

      return sendSuccess(reply, result, 'Reward claim approved');
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      return sendError(reply, 'Failed to approve reward claim', 400, error.message);
    } finally {
      await session.endSession();
    }
  });

  fastify.post('/admin/grant', async (request, reply) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      if (!(await verifyAdmin(request, reply))) {
        await session.abortTransaction();
        return;
      }
      const { userId, amount, reason = 'Administrative reward' } = request.body || {};
      if (!userId || Number(amount) !== 5) {
        await session.abortTransaction();
        return sendError(reply, 'User and exactly 5 promotional coins are required', 400);
      }
      const user = await User.findById(userId).session(session);
      if (!user) {
        await session.abortTransaction();
        return sendError(reply, 'User not found', 404);
      }
      const referenceId = generateReference('ADMIN');
      const credit = await creditPromotionalCoins({
        userId,
        reference: referenceId,
        verified: true,
        metadata: { source: 'ADMIN', adminId: request.user._id, reason },
        session,
      });

      await RewardAudit.create(
        [
          {
            userId,
            amount: 5,
            source: 'ADMIN',
            action: 'ISSUED',
            status: 'SUCCESS',
            referenceId,
            adminId: request.user._id,
            reason,
            ip: request.ip,
            userAgent: request.headers['user-agent'],
          },
        ],
        { session }
      );

      const updatedWallet = await Wallet.findOne({ userId }).session(session);
      await session.commitTransaction();

      createNotification({
        userId,
        type: 'REWARD_EARNED',
        title: 'You received 5 promotional coins 🪙',
        message: reason,
        targetUrl: '#wallet',
        icon: 'https://ui-avatars.com/api/?name=AfriStory&background=d4a017&color=fff&size=192',
        dedupeKey: `admin_grant_${referenceId}`,
      }).catch((err) => fastify.log.error('Push error:', err));

      return sendSuccess(reply, walletBalances(updatedWallet), 'Reward granted');
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      return sendError(reply, 'Failed to grant reward', 400, error.message);
    } finally {
      await session.endSession();
    }
  });
}
