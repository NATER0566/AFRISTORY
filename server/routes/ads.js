import User from '../models/User.js';
import Unlock from '../models/Unlock.js';
import Episode from '../models/Episode.js';
import Creator from '../models/Creator.js';
import Wallet from '../models/Wallet.js';
import Transaction from '../models/Transaction.js';
import { verifyAuth } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { isResetTime, generateReference } from '../utils/helpers.js';
import mongoose from 'mongoose';

const AD_REWARD_COINS = 10;

export default async function adsRoutes(fastify, opts) {
  // Check ad unlock availability
  fastify.get('/unlocks/remaining', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const user = await User.findById(request.user._id);

      // Reset ad unlocks if day has passed
      if (isResetTime(user.adUnlocksResetDate)) {
        user.adUnlocksRemaining = 3;
        user.adUnlocksResetDate = new Date();
        await user.save();
      }

      sendSuccess(reply, {
        adUnlocksRemaining: user.adUnlocksRemaining,
        adUnlocksResetDate: user.adUnlocksResetDate,
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch ad unlock status', 500, error.message);
    }
  });

  // Verify ad completion and unlock episode
  fastify.post('/verify-completion', async (request, reply) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        await session.abortTransaction();
        return sendError(reply, 'Unauthorized', 401);
      }

      const { episodeId, adPayload } = request.body || {};

      if (!episodeId || !adPayload) {
        await session.abortTransaction();
        return sendError(reply, 'Episode ID and ad payload are required', 400);
      }

      const user = await User.findById(request.user._id).session(session);

      if (!user) {
        await session.abortTransaction();
        return sendError(reply, 'User not found', 404);
      }

      // Check if ad unlocks have reset
      if (isResetTime(user.adUnlocksResetDate)) {
        user.adUnlocksRemaining = 3;
        user.adUnlocksResetDate = new Date();
      }

      if (user.adUnlocksRemaining <= 0) {
        await session.abortTransaction();
        return sendError(reply, 'No ad unlocks remaining today', 429);
      }

      const episode = await Episode.findById(episodeId).session(session);

      if (!episode) {
        await session.abortTransaction();
        return sendError(reply, 'Episode not found', 404);
      }

      if (!episode.adUnlockable) {
        await session.abortTransaction();
        return sendError(reply, 'Episode is not available for ad unlock', 400);
      }

      // Check if already unlocked
      const existingUnlock = await Unlock.findOne({
        userId: user._id,
        episodeId,
        isActive: true,
      }).session(session);

      if (existingUnlock) {
        await session.abortTransaction();
        return sendError(reply, 'Episode already unlocked', 400);
      }

      // TODO: Validate adPayload with actual ad network (Google AdSense, Unity Ads)
      // For now, we trust the payload is valid. In production:
      // - Verify signature with ad network API
      // - Check timestamp is recent
      // - Ensure payload hasn't been replayed

      // Create unlock
      const unlock = new Unlock({
        userId: user._id,
        episodeId,
        seriesId: episode.seriesId,
        method: 'AD',
      });
      await unlock.save({ session });

      // Deduct ad unlock
      user.adUnlocksRemaining -= 1;
      await user.save({ session });

      // Update episode stats
      episode.totalAdUnlocks += 1;
      await episode.save({ session });

      // Award coins to creator (20% of normal cost)
      const creatorReward = Number(episode.coinCost) * 0.2;
      const series = await (await import('../models/Series.js')).default.findById(episode.seriesId).session(session);
      if (!series) {
        await session.abortTransaction();
        return sendError(reply, 'Series not found', 404);
      }
      const creator = await Creator.findById(series.creatorId).session(session);
      if (!creator) {
        await session.abortTransaction();
        return sendError(reply, 'Creator not found', 404);
      }
      const creatorWallet = await Wallet.findOne({ userId: creator.userId }).session(session);
      if (!creatorWallet) {
        await session.abortTransaction();
        return sendError(reply, 'Creator wallet not found', 404);
      }

      creatorWallet.lockedEarnings = mongoose.Types.Decimal128.fromString((Number(creatorWallet.lockedEarnings.toString()) + creatorReward).toFixed(2));
      creatorWallet.totalEarned = mongoose.Types.Decimal128.fromString((Number(creatorWallet.totalEarned.toString()) + creatorReward).toFixed(2));
      await creatorWallet.save({ session });

      // Log transaction
      const reference = generateReference('AD_UNLOCK');
      const transaction = new Transaction({
        walletId: creatorWallet._id,
        userId: creator.userId,
        type: 'AD_REWARD',
        amount: mongoose.Types.Decimal128.fromString(creatorReward.toFixed(2)),
        reference,
        description: `Ad unlock reward for episode: ${episode.title}`,
        status: 'SUCCESS',
      });
      await transaction.save({ session });

      await session.commitTransaction();

      sendSuccess(reply, {
        unlocked: true,
        episodeId,
        adUnlocksRemaining: user.adUnlocksRemaining,
      });
    } catch (error) {
      await session.abortTransaction();
      fastify.log.error(error);
      sendError(reply, 'Failed to verify ad completion', 500, error.message);
    } finally {
      session.endSession();
    }
  });

  // Webhook for ad network (Google AdSense, Unity Ads, etc.)
  // Implement idempotency with reference IDs
  fastify.post('/webhook', async (request, reply) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { userId, episodeId, reference, signature } = request.body;

      if (!userId || !episodeId || !reference) {
        await session.abortTransaction();
        return sendError(reply, 'Missing required fields', 400);
      }

      // Check for duplicate (idempotency)
      const existingTransaction = await Transaction.findOne({
        reference,
      }).session(session);

      if (existingTransaction) {
        // Already processed
        await session.abortTransaction();
        return sendSuccess(reply, { duplicate: true }, 'Already processed');
      }

      // TODO: Verify signature with ad network's public key
      // if (!verifySignature(request.body, signature)) {
      //   await session.abortTransaction();
      //   return sendError(reply, 'Invalid signature', 401);
      // }

      const user = await User.findById(userId).session(session);
      const episode = await Episode.findById(episodeId).session(session);

      if (!user || !episode) {
        await session.abortTransaction();
        return sendError(reply, 'User or episode not found', 404);
      }

      // Check if already unlocked
      const existingUnlock = await Unlock.findOne({
        userId,
        episodeId,
        isActive: true,
      }).session(session);

      if (existingUnlock) {
        await session.abortTransaction();
        return sendSuccess(reply, null, 'Already unlocked');
      }

      // Create unlock
      const unlock = new Unlock({
        userId,
        episodeId,
        seriesId: episode.seriesId,
        method: 'AD',
      });
      await unlock.save({ session });

      episode.totalAdUnlocks += 1;
      await episode.save({ session });

      await session.commitTransaction();

      sendSuccess(reply, { success: true });
    } catch (error) {
      await session.abortTransaction();
      fastify.log.error(error);
      sendError(reply, 'Webhook processing failed', 500, error.message);
    } finally {
      session.endSession();
    }
  });
}
