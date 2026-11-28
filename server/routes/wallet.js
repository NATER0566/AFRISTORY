import mongoose from 'mongoose';
import Transaction from '../models/Transaction.js';
import Unlock from '../models/Unlock.js';
import User from '../models/User.js';
import Episode from '../models/Episode.js';
import Series from '../models/Series.js';
import Wallet from '../models/Wallet.js';
import { verifyAuth } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { formatDecimal, paginate } from '../utils/helpers.js';
import { unlockEpisode as unlockEpisodeWithLedger } from '../services/ledgerService.js';
import { verifyAndConsumeRobinAdsReward } from '../utils/robinAdsService.js';

export default async function walletRoutes(fastify) {
  fastify.get('/me/balance', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);
      const wallet = await Wallet.findOne({ userId: request.user._id });
      if (!wallet) return sendError(reply, 'Wallet not found', 404);
      sendSuccess(reply, {
        storyCoins: formatDecimal(wallet.storyCoins),
        purchasedCoins: formatDecimal(wallet.purchasedCoins),
        promotionalCoins: formatDecimal(wallet.promotionalCoins),
        legacyRestrictedCoins: formatDecimal(wallet.legacyRestrictedCoins),
        vipCredits: formatDecimal(wallet.vipCredits),
        pendingCreatorEarnings: formatDecimal(wallet.pendingCreatorEarnings),
        availableCreatorEarnings: formatDecimal(wallet.availableCreatorEarnings),
        withdrawnCreatorEarnings: formatDecimal(wallet.withdrawnCreatorEarnings),
        totalSpent: formatDecimal(wallet.totalSpent),
        lockedEarnings: formatDecimal(wallet.lockedEarnings),
        totalWithdrawn: formatDecimal(wallet.totalWithdrawn),
        totalEarned: formatDecimal(wallet.totalEarned),
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch wallet', 500, error.message);
    }
  });

  fastify.get('/me/transactions', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);
      const { page = 1, limit = 10 } = request.query;
      const { skip, limit: pageLimit, page: currentPage } = paginate(page, limit);
      const wallet = await Wallet.findOne({ userId: request.user._id });
      if (!wallet) return sendError(reply, 'Wallet not found', 404);
      const transactions = await Transaction.find({ walletId: wallet._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageLimit);
      const total = await Transaction.countDocuments({ walletId: wallet._id });
      sendSuccess(reply, {
        transactions: transactions.map((item) => ({
          ...item.toObject(),
          amount: formatDecimal(item.amount),
          grossNaira: formatDecimal(item.grossNaira),
          creatorShareNaira: formatDecimal(item.creatorShareNaira),
          platformShareNaira: formatDecimal(item.platformShareNaira),
          providerFeeNaira: formatDecimal(item.providerFeeNaira),
        })),
        pagination: {
          page: currentPage,
          limit: pageLimit,
          total,
          pages: Math.ceil(total / pageLimit),
        },
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch transactions', 500, error.message);
    }
  });

  fastify.post('/unlock-episode', async (request, reply) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      await verifyAuth(request, reply);
      if (!request.user) {
        await session.abortTransaction();
        return sendError(reply, 'Unauthorized', 401);
      }

      const {
        episodeId,
        method = 'PURCHASED',
        rewardId,
        transactionId,
        receipt,
      } = request.body || {};
      if (!episodeId) {
        await session.abortTransaction();
        return sendError(reply, 'Episode ID is required', 400);
      }

      const existing = await Unlock.findOne({
        userId: request.user._id,
        episodeId,
        isActive: true,
      }).session(session);
      if (existing) {
        await session.abortTransaction();
        return sendSuccess(reply, { unlocked: true, replay: true, method: existing.method });
      }

      const user = await User.findById(request.user._id).session(session);
      if (
        user?.subscriptionExpiresAt &&
        new Date(user.subscriptionExpiresAt) > new Date()
      ) {
        await session.abortTransaction();
        return sendError(reply, 'You already have an active legacy Gate Pass.', 409);
      }

      const normalizedMethod = String(method).toUpperCase();
      const mappedMethod = {
        COIN: 'PURCHASED',
        PURCHASED: 'PURCHASED',
        PROMOTIONAL: 'PROMOTIONAL',
        VIP_CREDIT: 'VIP_CREDIT',
        AD: 'DIRECT_AD',
        DIRECT_AD: 'DIRECT_AD',
      }[normalizedMethod];
      if (!mappedMethod) {
        await session.abortTransaction();
        return sendError(reply, 'Invalid episode unlock method.', 400);
      }

      const resolvedRewardId = String(
        rewardId || transactionId || receipt?.rewardId || receipt?.transactionId || receipt?.id || ''
      ).trim();
      if (mappedMethod === 'DIRECT_AD' && receipt?.token) {
        const episode = await Episode.findById(episodeId).session(session);
        const series = episode ? await Series.findById(episode.seriesId).session(session) : null;
        if (!episode || !series) {
          await session.abortTransaction();
          return sendError(reply, 'Episode or creator not found.', 404);
        }
        await verifyAndConsumeRobinAdsReward({
          userId: request.user._id,
          rewardId: resolvedRewardId,
          token: receipt.token,
          purpose: 'DIRECT_EPISODE_UNLOCK',
          targetId: String(episode._id),
          creatorId: series.creatorId,
          session,
        });
      }
      const result = await unlockEpisodeWithLedger({
        userId: request.user._id,
        episodeId,
        method: mappedMethod,
        rewardId: resolvedRewardId || null,
        session,
      });
      await session.commitTransaction();
      return sendSuccess(
        reply,
        { unlocked: true, replay: Boolean(result.replay), method: mappedMethod, rewardId: resolvedRewardId || null },
        result.replay ? 'Episode already unlocked' : 'Episode unlocked successfully'
      );
    } catch (error) {
      await session.abortTransaction();
      fastify.log.error(error);
      return sendError(reply, error.message || 'Failed to unlock episode', error.statusCode || 500);
    } finally {
      await session.endSession();
    }
  });

  fastify.post('/add-funds', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);
      return sendError(reply, 'Use /api/payment/initialize-transaction', 400);
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to add funds', 500, error.message);
    }
  });
}
