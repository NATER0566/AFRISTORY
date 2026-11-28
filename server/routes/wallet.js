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

function formatWalletSnapshot(wallet) {
  const purchasedCoins = formatDecimal(wallet?.purchasedCoins || 0);
  const promotionalCoins = formatDecimal(wallet?.promotionalCoins || 0);
  const legacyRestrictedCoins = formatDecimal(wallet?.legacyRestrictedCoins || 0);
  const vipCredits = formatDecimal(wallet?.vipCredits || 0);
  const spendablePromotionalCoins = formatDecimal(promotionalCoins + legacyRestrictedCoins);

  return {
    storyCoins: formatDecimal(wallet?.storyCoins ?? purchasedCoins + spendablePromotionalCoins),
    purchasedCoins,
    promotionalCoins,
    legacyRestrictedCoins,
    spendablePromotionalCoins,
    vipCredits,
    hasVipCredits: vipCredits > 0,
    pendingCreatorEarnings: formatDecimal(wallet?.pendingCreatorEarnings || 0),
    availableCreatorEarnings: formatDecimal(wallet?.availableCreatorEarnings || 0),
    withdrawnCreatorEarnings: formatDecimal(wallet?.withdrawnCreatorEarnings || 0),
    totalSpent: formatDecimal(wallet?.totalSpent || 0),
    lockedEarnings: formatDecimal(wallet?.lockedEarnings || 0),
    totalWithdrawn: formatDecimal(wallet?.totalWithdrawn || 0),
    totalEarned: formatDecimal(wallet?.totalEarned || 0),
  };
}

export default async function walletRoutes(fastify) {
  fastify.get('/me/balance', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);
      const wallet = await Wallet.findOne({ userId: request.user._id });
      if (!wallet) return sendError(reply, 'Wallet not found', 404);
      return sendSuccess(reply, formatWalletSnapshot(wallet));
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to fetch wallet', 500, error.message);
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

      return sendSuccess(reply, {
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
      return sendError(reply, 'Failed to fetch transactions', 500, error.message);
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
        const wallet = await Wallet.findOne({ userId: request.user._id }).session(session);
        await session.abortTransaction();
        return sendSuccess(
          reply,
          {
            unlocked: true,
            replay: true,
            method: existing.method,
            balances: wallet ? formatWalletSnapshot(wallet) : null,
          },
          'Episode already unlocked'
        );
      }

      const user = await User.findById(request.user._id).session(session);
      if (
        user?.subscriptionExpiresAt &&
        new Date(user.subscriptionExpiresAt) > new Date()
      ) {
        const wallet = await Wallet.findOne({ userId: request.user._id }).session(session);
        await session.abortTransaction();
        return sendSuccess(
          reply,
          {
            unlocked: true,
            replay: true,
            method: 'LEGACY_SUBSCRIPTION',
            balances: wallet ? formatWalletSnapshot(wallet) : null,
          },
          'Access granted via existing active pass'
        );
      }

      const normalizedMethod = String(method).toUpperCase();
      const mappedMethod = {
        COIN: 'PURCHASED',
        PURCHASED: 'PURCHASED',
        PROMOTIONAL: 'PROMOTIONAL',
        PROMO: 'PROMOTIONAL',
        VIP_CREDIT: 'VIP_CREDIT',
        VIP: 'VIP_CREDIT',
        AD: 'DIRECT_AD',
        DIRECT_AD: 'DIRECT_AD',
      }[normalizedMethod];

      if (!mappedMethod) {
        await session.abortTransaction();
        return sendError(reply, 'Invalid episode unlock method.', 400);
      }

      const episode = await Episode.findById(episodeId).session(session);
      const series = episode ? await Series.findById(episode.seriesId).session(session) : null;
      if (!episode || !series) {
        await session.abortTransaction();
        return sendError(reply, 'Episode or creator not found.', 404);
      }

      const walletBefore = await Wallet.findOne({ userId: request.user._id }).session(session);
      if (!walletBefore) {
        await session.abortTransaction();
        return sendError(reply, 'Wallet not found', 404);
      }

      const requiredCost = Number(episode.coinCost || 0);
      if (mappedMethod === 'VIP_CREDIT' && Number(walletBefore.vipCredits || 0) < requiredCost) {
        await session.abortTransaction();
        return sendError(
          reply,
          'Your VIP credits are exhausted. Renew your VIP package, watch an ad to unlock this episode, or use your promotional coins if you have enough.',
          400,
          {
            code: 'VIP_CREDITS_EXHAUSTED',
            requiredCredits: requiredCost,
            balances: formatWalletSnapshot(walletBefore),
          }
        );
      }

      const resolvedRewardId = String(
        rewardId || transactionId || receipt?.rewardId || receipt?.transactionId || receipt?.id || ''
      ).trim();

      if (mappedMethod === 'DIRECT_AD' && receipt?.token) {
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

      const updatedWallet = await Wallet.findOne({ userId: request.user._id }).session(session);
      await session.commitTransaction();

      return sendSuccess(
        reply,
        {
          unlocked: true,
          replay: Boolean(result.replay),
          method: mappedMethod,
          rewardId: resolvedRewardId || null,
          balances: updatedWallet ? formatWalletSnapshot(updatedWallet) : null,
        },
        result.replay ? 'Episode already unlocked' : 'Episode unlocked successfully'
      );
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
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
