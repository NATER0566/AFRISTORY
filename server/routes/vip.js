import Subscription from '../models/Subscription.js';
import User from '../models/User.js';
import FinancialConfig from '../models/FinancialConfig.js';
import Wallet from '../models/Wallet.js';
import { verifyAuth } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { createNotification } from '../utils/notificationService.js';
import { purchaseVipPackage } from '../services/ledgerService.js';

const defaultConfig = {
  key: 'default',
  coinPackages: {
    STARTER: { coins: 100, naira: 200, promotionalCoins: 0 },
    PLUS: { coins: 300, naira: 600, promotionalCoins: 0 },
    PREMIUM: { coins: 1000, naira: 2000, promotionalCoins: 0 },
    ELITE: { coins: 3000, naira: 6000, promotionalCoins: 0 },
  },
  vipPackages: {
    VIP_STARTER: { purchasedCoinPrice: 0, vipCreditsGranted: 0, active: false },
    VIP_PLUS: { purchasedCoinPrice: 0, vipCreditsGranted: 0, active: false },
    VIP_PREMIUM: { purchasedCoinPrice: 0, vipCreditsGranted: 0, active: false },
  },
  promoRewardAmount: 5,
};

async function loadFinancialConfig() {
  return FinancialConfig.findOneAndUpdate(
    { key: 'default' },
    { $setOnInsert: defaultConfig },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

export default async function vipRoutes(fastify) {
  fastify.get('/me/status', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);

      await Subscription.updateMany(
        { userId: request.user._id, status: 'ACTIVE', expiresAt: { $lt: new Date() } },
        { $set: { status: 'EXPIRED' } }
      );
      const subscription = await Subscription.findOne({
        userId: request.user._id,
        status: 'ACTIVE',
        expiresAt: { $gt: new Date() },
      });
      sendSuccess(reply, {
        isSubscribed: Boolean(subscription),
        subscription: subscription
          ? {
              tier: subscription.tier,
              expiresAt: subscription.expiresAt,
              renewalDate: subscription.renewalDate,
            }
          : null,
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch subscription status', 500, error.message);
    }
  });

  fastify.get('/plans', async (request, reply) => {
    try {
      const config = await loadFinancialConfig();
      sendSuccess(reply, config.vipPackages);
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch VIP packages', 500, error.message);
    }
  });

  fastify.post('/subscribe', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);
      const { packageKey, tier, paymentMethod = 'wallet', reference } = request.body || {};
      if (paymentMethod !== 'wallet') {
        return sendError(reply, 'VIP credits can only be purchased with purchased Story Coins.', 400);
      }
      const key = packageKey || tier;
      if (!key) return sendError(reply, 'VIP package is required.', 400);

      const result = await purchaseVipPackage({ userId: request.user._id, packageKey: key, reference });
      createNotification({
        userId: request.user._id,
        type: 'SYSTEM',
        title: 'VIP Unlock Credits Added',
        message: `${result.vipCreditsGranted} VIP Unlock Credits were added to your wallet.`,
        targetUrl: '#discover',
        dedupeKey: `vip_credits_${result.transaction._id}`,
      }).catch((error) => fastify.log.error('VIP notification error:', error));

      const wallet = await Wallet.findOne({ userId: request.user._id });
      sendSuccess(
        reply,
        {
          transaction: result.transaction,
          vipCreditsGranted: result.vipCreditsGranted,
          vipCredits: Number(wallet.vipCredits.toString()),
          purchasedCoins: Number(wallet.purchasedCoins.toString()),
        },
        'VIP Unlock Credits purchased successfully',
        201
      );
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, error.message || 'Failed to purchase VIP Unlock Credits', error.statusCode || 500);
    }
  });

  fastify.post('/subscribe/verify', async (request, reply) =>
    sendError(reply, 'Direct time-based VIP purchases are no longer available.', 410)
  );

  // Keep legacy passes readable/cancellable until their existing expiry; no new timed passes are issued.
  fastify.post('/cancel', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);
      const subscription = await Subscription.findOne({
        userId: request.user._id,
        status: 'ACTIVE',
      });
      if (!subscription) return sendError(reply, 'No active Gate Pass found', 404);

      subscription.status = 'CANCELLED';
      await subscription.save();
      await User.findByIdAndUpdate(request.user._id, { subscriptionExpiresAt: null });
      sendSuccess(reply, null, 'Gate Pass cancelled successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to cancel Gate Pass', 500, error.message);
    }
  });
}
