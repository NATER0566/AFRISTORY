import mongoose from 'mongoose';
import Reward from '../models/Reward.js';
import RewardClaim from '../models/RewardClaim.js';
import RewardAudit from '../models/RewardAudit.js';
import Wallet from '../models/Wallet.js';
import Transaction from '../models/Transaction.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import History from '../models/History.js';
import Favorite from '../models/Favorite.js';
import { verifyAuth, verifyAdmin } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { generateReference, formatDecimal } from '../utils/helpers.js';
import { createNotification } from '../utils/notificationService.js'; // NEW: Central push orchestrator

const timezone = process.env.REWARD_TIMEZONE || 'Africa/Lagos';
const periodKey = (date = new Date(), type = 'once') => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
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
    { $or: [{ startAt: null }, { startAt: {$lte: new Date() } }] },
    { $or: [{ endAt: null }, { endAt: {$gt: new Date() } }] },
  ],
});

// FIXED: Restored the missing dateDistance function to prevent backend crashes on Daily check-ins
const dateDistance = (left, right) => Math.round((new Date(`${left}T12:00:00Z`) - new Date(`${right}T12:00:00Z`)) / 86400000);

async function ensureDefaultRewards() {
  const defaults = [
    { name: 'Welcome to AfroStory', description: 'A one-time welcome gift for verified members.', type: 'ONE_TIME', category: 'welcome', rewardAmount: 20, metadata: { key: 'welcome' } },
    { name: 'Daily Check-in', description: 'Return each day to keep your story streak alive.', type: 'DAILY', category: 'daily', rewardAmount: 5, recurrenceType: 'daily', maxClaimsPerUser: null, metadata: { schedule: [5, 5, 10, 10, 15, 15, 30] } },
    { name: 'Complete Your Profile', description: 'Add the essentials that shape your discoveries.', type: 'PROFILE', category: 'profile', rewardAmount: 20, metadata: { key: 'profile_complete' } },
    { name: 'First Story Saved', description: 'Save a story to return to later.', type: 'DISCOVERY', category: 'discovery', rewardAmount: 5, metadata: { key: 'first_save' } },
    { name: 'First Story Favorited', description: 'Mark a story that deserves a place in your favorites.', type: 'DISCOVERY', category: 'discovery', rewardAmount: 5, metadata: { key: 'first_favorite' } },
  ];
  const socialDefaults = [
    ['Facebook', 'https://www.facebook.com/profile.php?id=61579451935484', 20, 'Follow us on Facebook', 'social_facebook'],
    ['Instagram', 'https://www.instagram.com/natergracecode/', 20, 'Follow us on Instagram', 'social_instagram'],
    ['YouTube', process.env.REWARD_SOCIAL_YOUTUBE_URL, 25, 'Subscribe to AfroStory on YouTube', 'social_youtube'],
    ['TikTok', process.env.REWARD_SOCIAL_TIKTOK_URL, 20, 'Follow AfroStory on TikTok', 'social_tiktok'],
    ['X', process.env.REWARD_SOCIAL_X_URL, 20, 'Follow AfroStory on X', 'social_x'],
  ];
  socialDefaults.forEach(([platform, targetUrl, rewardAmount, name, taskId]) => {
    if (targetUrl) defaults.push({
      name,
      description: `Connect with AFROSTORY on ${platform}. Follow the account, then claim this one-time reward. External follow verification is not implemented.`,
      type: 'SOCIAL',
      category: 'social',
      rewardAmount,
      verificationMode: 'server',
      maxClaimsPerUser: 1,
      metadata: { key: taskId, taskId, platform, targetUrl, externalVerification: 'not_implemented' },
    });
  });
  for (const item of defaults) {
    const update = item.type === 'SOCIAL' ? { $set: { ...item, status: 'ACTIVE' }, $setOnInsert: { createdAt: new Date() } } : {$setOnInsert: { ...item, status: 'ACTIVE' } };
    await Reward.updateOne({ 'metadata.key': item.metadata.key }, update, { upsert: true });
  }
}

async function profileEligible(user, reward) {
  if (reward.metadata?.key !== 'profile_complete') return true;
  const profile = user.profile || {};
  return Boolean(profile.displayName && (profile.avatarUrl || user.profileImage) && profile.country && profile.preferredLanguage && profile.favoriteGenres?.length);
}

async function getEligibility(user, reward, claims) {
  const claim = claims.find(item => item.rewardId.toString() === reward._id.toString() && item.status !== 'REJECTED');
  if (claim) return { state: claim.status === 'PENDING' ? 'PENDING_VERIFICATION' : 'CLAIMED', reason: claim.status === 'PENDING' ? 'Waiting for verification.' : 'Reward already claimed.' };
  if (reward.endAt && reward.endAt <= new Date()) return { state: 'EXPIRED', reason: 'This reward has expired.' };
  const key = reward.metadata?.key;
  if (key === 'welcome') return user.isVerified ? { state: 'CLAIMABLE', reason: 'Welcome reward ready.' } : { state: 'LOCKED', reason: 'Verify your email to unlock this reward.' };
  if (key === 'first_save') return await Favorite.exists({ userId: user._id }) ? { state: 'CLAIMABLE', reason: 'Your first story is saved.' } : { state: 'LOCKED', reason: 'Save a story to unlock this reward.' };
  if (key === 'first_favorite') return await Favorite.exists({ userId: user._id }) ? { state: 'CLAIMABLE', reason: 'Your first story is favorited.' } : { state: 'LOCKED', reason: 'Favorite a story to unlock this reward.' };
  if (key === 'profile_complete') return (await profileEligible(user, reward)) ? { state: 'CLAIMABLE', reason: 'Your profile is complete.' } : { state: 'LOCKED', reason: 'Complete your profile to unlock this reward.' };
  if (reward.type === 'SOCIAL' || reward.verificationMode === 'manual_claim' || reward.verificationMode === 'admin_verified') return { state: 'CLAIMABLE', reason: 'Visit the official account, then claim this one-time reward.' };
  if (reward.metadata?.requiresHistory) return await History.exists({ userId: user._id }) ? { state: 'CLAIMABLE', reason: 'Requirement completed.' } : { state: 'LOCKED', reason: 'Watch an eligible story to unlock this reward.' };
  return { state: 'CLAIMABLE', reason: 'Reward ready to claim.' };
}

async function issueReward({ reward, user, request, session, period, metadata = {}, approved = false }) {
  const taskId = reward.metadata?.taskId || null;
  const existing = await RewardClaim.findOne(taskId
    ? { userId: user._id, $or: [{ taskId }, { rewardId: reward._id, periodKey: period }] }
    : { rewardId: reward._id, userId: user._id, periodKey: period }).session(session);
  if (existing) return { claim: existing, duplicate: true };
  if (!(await profileEligible(user, reward))) throw new Error('Reward eligibility requirements are not complete');
  if (reward.endAt && reward.endAt <= new Date()) throw new Error('Reward has expired');
  if (reward.recurrenceType === 'once' && reward.maxClaimsPerUser && await RewardClaim.countDocuments({ rewardId: reward._id, userId: user._id }).session(session) >= reward.maxClaimsPerUser) throw new Error('Per-user reward limit reached');
  if (reward.maxClaims && await RewardClaim.countDocuments({ rewardId: reward._id }).session(session) >= reward.maxClaims) throw new Error('Reward claim limit reached');
  if (!approved && !taskId && (reward.type === 'SOCIAL' || reward.verificationMode === 'manual_claim' || reward.verificationMode === 'admin_verified')) {
    const pending = await RewardClaim.create([{ rewardId: reward._id, userId: user._id, amount: reward.rewardAmount, periodKey: period, referenceId: generateReference('PENDING'), status: 'PENDING', metadata }], { session });
    return { claim: pending[0], pending: true };
  }
  const eligibility = await getEligibility(user, reward, []);
  if (eligibility.state !== 'CLAIMABLE') throw new Error(eligibility.reason);

  const wallet = await Wallet.findOne({ userId: user._id }).session(session);
  if (!wallet) throw new Error('Wallet not found');
  const before = Number(wallet.storyCoins.toString());
  const previousClaims = await RewardClaim.countDocuments({ rewardId: reward._id, userId: user._id }).session(session);
  const schedule = Array.isArray(reward.metadata?.schedule) && reward.metadata.schedule.length ? reward.metadata.schedule : null;
  const amount = schedule ? Number(schedule[previousClaims % schedule.length]) : reward.rewardAmount;
  const after = before + amount;
  wallet.storyCoins = mongoose.Types.Decimal128.fromString(after.toFixed(2));
  wallet.totalEarned = mongoose.Types.Decimal128.fromString((Number(wallet.totalEarned.toString()) + amount).toFixed(2));
  await wallet.save({ session });

  if (reward.metadata?.schedule) {
    const today = periodKey(new Date(), 'daily');
    const previousDay = user.rewardStats?.lastCheckInAt ? periodKey(user.rewardStats.lastCheckInAt, 'daily') : null;
    const consecutive = previousDay && dateDistance(today, previousDay) === 1;
    user.rewardStats.currentStreak = consecutive ? (user.rewardStats.currentStreak || 0) + 1 : 1;
    user.rewardStats.bestStreak = Math.max(user.rewardStats.bestStreak || 0, user.rewardStats.currentStreak);
    user.rewardStats.totalCheckInDays = (user.rewardStats.totalCheckInDays || 0) + 1;
    user.rewardStats.currentRewardDay = (previousClaims % 7) + 1;
    user.rewardStats.lastCheckInAt = new Date();
    await user.save({ session });
  }

  const referenceId = generateReference('REWARD');
  const claim = await RewardClaim.create([{ rewardId: reward._id, taskId, userId: user._id, amount, periodKey: period, referenceId, verifiedAt: reward.verificationMode === 'server' ? new Date() : null, metadata }], { session });
  await Transaction.create([{ walletId: wallet._id, userId: user._id, type: 'BONUS', amount: mongoose.Types.Decimal128.fromString(amount.toFixed(2)), reference: referenceId, description: reward.name, status: 'SUCCESS', balanceBefore: mongoose.Types.Decimal128.fromString(before.toFixed(2)), balanceAfter: mongoose.Types.Decimal128.fromString(after.toFixed(2)), metadata: { source: reward.type, rewardId: reward._id } }], { session });
  await RewardAudit.create([{ userId: user._id, rewardId: reward._id, claimId: claim[0]._id, amount, source: reward.type, action: 'ISSUED', status: 'SUCCESS', referenceId, ip: request.ip, userAgent: request.headers['user-agent'] }], { session });
  
  // NOTE: Notification.create is deliberately removed from here so we can dispatch the Push + DB save AFTER the transaction commits
  return { claim: claim[0], balance: after, amount, rewardName: reward.name, rewardId: reward._id };
}

export default async function rewardRoutes(fastify) {
  fastify.get('/me', async (request, reply) => {
    try {
      if (!(await verifyAuth(request, reply))) return;
      await ensureDefaultRewards();
      const rewards = await Reward.find(activeQuery()).sort({ category: 1, createdAt: 1 });
      const claims = await RewardClaim.find({ userId: request.user._id, rewardId: { $in: rewards.map(reward => reward._id) } });
      const claimMap = new Map(claims.map(claim => [`${claim.rewardId}:${claim.periodKey}`, claim]));
      const wallet = await Wallet.findOne({ userId: request.user._id });
      const daily = rewards.find(reward => reward.metadata?.schedule);
      const todayClaim = daily && claimMap.get(`${daily._id}:${periodKey(new Date(), 'daily')}`);
      const dailyClaims = daily ? await RewardClaim.countDocuments({ rewardId: daily._id, userId: request.user._id }) : 0;
      const dailyAmount = daily?.metadata?.schedule?.length ? daily.metadata.schedule[dailyClaims % daily.metadata.schedule.length] : daily?.rewardAmount;
      const history = await Transaction.find({ userId: request.user._id }).sort({ createdAt: -1 }).limit(20);
      const rewardStates = await Promise.all(rewards.map(async reward => ({ ...reward.toObject(), eligibility: await getEligibility(request.user, reward, claims), claimed: Boolean(claimMap.get(`${reward._id}:${periodKey(new Date(), reward.recurrenceType)}`)) })));
      sendSuccess(reply, { balance: wallet ? formatDecimal(wallet.storyCoins) : 0, streak: request.user.rewardStats || {}, daily: daily ? { ...daily.toObject(), rewardAmount: dailyAmount, claimed: Boolean(todayClaim), periodKey: periodKey(new Date(), 'daily') } : null, rewards: rewardStates, history: history.map(item => ({ ...item.toObject(), amount: formatDecimal(item.amount) })) });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to load rewards', 500, error.message);
    }
  });

  fastify.post('/:rewardId/claim', async (request, reply) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      if (!(await verifyAuth(request, reply))) { await session.abortTransaction(); return; }
      const reward = await Reward.findOne({ _id: request.params.rewardId, ...activeQuery() }).session(session);
      if (!reward) { await session.abortTransaction(); return sendError(reply, 'Reward is unavailable', 404); }
      const result = await issueReward({ reward, user: request.user, request, session, period: periodKey(new Date(), reward.recurrenceType) });
      if (result.duplicate) { await session.abortTransaction(); return sendError(reply, 'Reward already claimed for this period', 409); }
      await session.commitTransaction();

      // NEW: Trigger DB Notification + Push asynchronously OUTSIDE the transaction
      if (!result.pending && result.claim) {
        createNotification({
          userId: request.user._id,
          type: 'REWARD_EARNED',
          title: `You earned ${result.amount} coins 🎉`,
          message: result.rewardName,
          targetUrl: '#rewards',
          data: { rewardId: result.rewardId, claimId: result.claim._id },
          dedupeKey: `reward_${result.claim._id}`
        }).catch(err => fastify.log.error('Push error:', err));
      }

      sendSuccess(reply, { claim: result.claim, balance: result.balance || null, pending: Boolean(result.pending) }, result.pending ? 'Reward submitted for verification' : 'Reward claimed');
    } catch (error) {
      await session.abortTransaction();
      if (error?.code === 11000) return sendError(reply, 'Reward already claimed', 409);
      fastify.log.error(error);
      sendError(reply, error.message || 'Failed to claim reward', 400);
    } finally { session.endSession(); }
  });

  fastify.get('/admin/list', async (request, reply) => {
    try { if (!(await verifyAdmin(request, reply))) return; const rewards = await Reward.find().sort({ createdAt: -1 }); sendSuccess(reply, rewards); } catch (error) { sendError(reply, 'Failed to fetch rewards', 500, error.message); }
  });

  fastify.post('/admin', async (request, reply) => {
    try { if (!(await verifyAdmin(request, reply))) return; const reward = await Reward.create({ ...request.body, createdBy: request.user._id }); sendSuccess(reply, reward, 'Reward created', 201); } catch (error) { sendError(reply, 'Failed to create reward', 400, error.message); }
  });

  fastify.post('/admin/claims/:claimId/approve', async (request, reply) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      if (!(await verifyAdmin(request, reply))) { await session.abortTransaction(); return; }
      const claim = await RewardClaim.findOne({ _id: request.params.claimId, status: 'PENDING' }).session(session);
      if (!claim) { await session.abortTransaction(); return sendError(reply, 'Pending claim not found', 404); }
      const reward = await Reward.findById(claim.rewardId).session(session);
      const user = await User.findById(claim.userId).session(session);
      if (!reward || !user) { await session.abortTransaction(); return sendError(reply, 'Reward or user not found', 404); }
      const result = await issueReward({ reward, user, request, session, period: `${claim.periodKey}:approved`, approved: true, metadata: { approvedClaimId: claim._id } });
      claim.status = 'CLAIMED';
      claim.verifiedAt = new Date();
      await claim.save({ session });
      await session.commitTransaction();

      // NEW: Trigger DB Notification + Push asynchronously OUTSIDE the transaction
      if (result.claim) {
        createNotification({
          userId: user._id,
          type: 'REWARD_EARNED',
          title: `You earned ${result.amount} coins 🎉`,
          message: result.rewardName,
          targetUrl: '#rewards',
          data: { rewardId: result.rewardId, claimId: result.claim._id },
          dedupeKey: `reward_${result.claim._id}`
        }).catch(err => fastify.log.error('Push error:', err));
      }

      sendSuccess(reply, result, 'Reward claim approved');
    } catch (error) {
      await session.abortTransaction();
      sendError(reply, 'Failed to approve reward claim', 400, error.message);
    } finally { session.endSession(); }
  });

  fastify.post('/admin/grant', async (request, reply) => {
    const session = await mongoose.startSession(); session.startTransaction();
    try { 
      if (!(await verifyAdmin(request, reply))) { await session.abortTransaction(); return; } 
      const { userId, amount, reason = 'Administrative reward' } = request.body || {}; 
      if (!userId || !Number.isInteger(Number(amount)) || Number(amount) <= 0) { await session.abortTransaction(); return sendError(reply, 'User and positive amount are required', 400); } 
      const user = await User.findById(userId).session(session); 
      if (!user) { await session.abortTransaction(); return sendError(reply, 'User not found', 404); } 
      const wallet = await Wallet.findOne({ userId }).session(session); 
      if (!wallet) { await session.abortTransaction(); return sendError(reply, 'Wallet not found', 404); } 
      const before = Number(wallet.storyCoins.toString()); 
      const after = before + Number(amount); 
      const referenceId = generateReference('ADMIN'); 
      wallet.storyCoins = mongoose.Types.Decimal128.fromString(after.toFixed(2)); 
      wallet.totalEarned = mongoose.Types.Decimal128.fromString((Number(wallet.totalEarned.toString()) + Number(amount)).toFixed(2)); 
      await wallet.save({ session }); 
      await Transaction.create([{ walletId: wallet._id, userId, type: 'BONUS', amount: mongoose.Types.Decimal128.fromString(Number(amount).toFixed(2)), reference: referenceId, description: reason, status: 'SUCCESS', balanceBefore: before, balanceAfter: after, metadata: { source: 'ADMIN', adminId: request.user._id } }], { session }); 
      await RewardAudit.create([{ userId, amount: Number(amount), source: 'ADMIN', action: 'ISSUED', status: 'SUCCESS', referenceId, adminId: request.user._id, reason, ip: request.ip, userAgent: request.headers['user-agent'] }], { session }); 
      await session.commitTransaction(); 

      // NEW: Notify the user they received an admin grant
      createNotification({
        userId,
        type: 'REWARD_EARNED',
        title: `You received ${amount} coins 🪙`,
        message: reason,
        targetUrl: '#wallet',
        dedupeKey: `admin_grant_${referenceId}`
      }).catch(err => fastify.log.error('Push error:', err));

      sendSuccess(reply, { balance: after }, 'Reward granted'); 
    } catch (error) { 
      await session.abortTransaction(); 
      sendError(reply, 'Failed to grant reward', 400, error.message); 
    } finally { session.endSession(); }
  });
}
