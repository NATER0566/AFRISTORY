import Wallet from '../models/Wallet.js';
import Transaction from '../models/Transaction.js';
import Unlock from '../models/Unlock.js';
import Episode from '../models/Episode.js';
import Creator from '../models/Creator.js';
import User from '../models/User.js';
import Series from '../models/Series.js';
import { verifyAuth } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { generateReference, formatDecimal, paginate } from '../utils/helpers.js';
import mongoose from 'mongoose';

export default async function walletRoutes(fastify, opts) {
  // Get wallet
  fastify.get('/me/balance', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const wallet = await Wallet.findOne({ userId: request.user._id });

      if (!wallet) {
        return sendError(reply, 'Wallet not found', 404);
      }

      const user = await User.findById(request.user._id);

      sendSuccess(reply, {
        storyCoins: formatDecimal(wallet.storyCoins),
        lockedEarnings: formatDecimal(wallet.lockedEarnings),
        totalWithdrawn: formatDecimal(wallet.totalWithdrawn),
        totalEarned: formatDecimal(wallet.totalEarned),
        adUnlocks: user?.adUnlocksRemaining || 0,
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch wallet', 500, error.message);
    }
  });

  // Get transactions
  fastify.get('/me/transactions', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { page = 1, limit = 10 } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      const wallet = await Wallet.findOne({ userId: request.user._id });

      if (!wallet) {
        return sendError(reply, 'Wallet not found', 404);
      }

      const transactions = await Transaction.find({ walletId: wallet._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(l);

      const total = await Transaction.countDocuments({ walletId: wallet._id });

      sendSuccess(reply, {
        transactions: transactions.map(t => ({
          ...t.toObject(),
          amount: formatDecimal(t.amount),
        })),
        pagination: {
          page: p,
          limit: l,
          total,
          pages: Math.ceil(total / l),
        },
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch transactions', 500, error.message);
    }
  });

  // Unlock episode with coins OR ads
  fastify.post('/unlock-episode', async (request, reply) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      // We accept a method ('COIN' or 'AD'). Defaults to COIN.
      const { episodeId, method = 'COIN' } = request.body || {};

      if (!episodeId) {
        await session.abortTransaction();
        return sendError(reply, 'Episode ID is required', 400);
      }

      const user = await User.findById(request.user._id).session(session);

      // --- NEW: VIP GATE PASS PROTECTION ---
      if (user.subscriptionExpiresAt && new Date(user.subscriptionExpiresAt) > new Date()) {
        await session.abortTransaction();
        return sendError(reply, 'You already have an active Gate Pass. No need to unlock!', 400);
      }

      const episode = await Episode.findById(episodeId).session(session);

      if (!episode) {
        await session.abortTransaction();
        return sendError(reply, 'Episode not found', 404);
      }

      if (episode.isFree) {
        await session.abortTransaction();
        return sendError(reply, 'Episode is already free', 400);
      }

      // Check if already unlocked
      const existingUnlock = await Unlock.findOne({
        userId: request.user._id,
        episodeId,
        isActive: true,
      }).session(session);

      if (existingUnlock) {
        await session.abortTransaction();
        return sendError(reply, 'Episode is already unlocked', 400);
      }

      // ============================================
      // LOGIC 1: UNLOCK USING AN AD
      // ============================================
      if (method.toUpperCase() === 'AD') {
        if (!episode.adUnlockable) {
            await session.abortTransaction();
            return sendError(reply, 'This episode cannot be unlocked with an ad.', 400);
        }

        if (!user.adUnlocksRemaining || user.adUnlocksRemaining <= 0) {
            await session.abortTransaction();
            return sendError(reply, 'You have no free ad unlocks remaining today.', 400);
        }

        // Deduct ad unlock from user profile
        user.adUnlocksRemaining -= 1;
        await user.save({ session });

        // Create unlock record
        const unlock = new Unlock({
          userId: request.user._id,
          episodeId,
          seriesId: episode.seriesId,
          method: 'AD',
        });
        await unlock.save({ session });

        // Update episode stats
        episode.totalUnlocks += 1;
        await episode.save({ session });

        await session.commitTransaction();
        return sendSuccess(reply, { unlocked: true, method: 'AD' }, 'Episode unlocked successfully with an Ad');
      }

      // ============================================
      // LOGIC 2: UNLOCK USING COINS
      // ============================================
      const userWallet = await Wallet.findOne({ userId: request.user._id }).session(session);

      if (!userWallet) {
        await session.abortTransaction();
        return sendError(reply, 'Wallet not found', 404);
      }

      const coinCost = Number(episode.coinCost);
      const userBalance = Number(userWallet.storyCoins.toString());

      if (!Number.isFinite(coinCost) || coinCost <= 0 || userBalance < coinCost) {
        await session.abortTransaction();
        return sendError(reply, 'Insufficient coins', 400);
      }

      // Deduct coins from user
      userWallet.storyCoins = mongoose.Types.Decimal128.fromString((userBalance - coinCost).toFixed(2));
      await userWallet.save({ session });

      // Award 60% to creator
      const creatorReward = coinCost * 0.6;
      const series = await Series.findById(episode.seriesId).session(session);

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

      // Create unlock record
      const unlock = new Unlock({
        userId: request.user._id,
        episodeId,
        seriesId: episode.seriesId,
        method: 'COIN',
      });
      await unlock.save({ session });

      // Update episode stats
      episode.totalUnlocks += 1;
      await episode.save({ session });

      // Create transaction record
      const reference = generateReference('UNLOCK');
      const transaction = new Transaction({
        walletId: userWallet._id,
        userId: request.user._id,
        type: 'SPEND',
        amount: mongoose.Types.Decimal128.fromString(coinCost.toFixed(2)),
        reference,
        description: `Unlocked episode: ${episode.title}`,
        status: 'SUCCESS',
      });
      await transaction.save({ session });

      await session.commitTransaction();

      sendSuccess(reply, { unlocked: true, method: 'COIN' }, 'Episode unlocked successfully with Coins');
    } catch (error) {
      await session.abortTransaction();
      fastify.log.error(error);
      sendError(reply, 'Failed to unlock episode', 500, error.message);
    } finally {
      session.endSession();
    }
  });

  // Add funds (placeholder - Paystack integration in payment routes)
  fastify.post('/add-funds', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      sendError(reply, 'Use /api/payment/initialize-transaction', 400);
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to add funds', 500, error.message);
    }
  });
}
