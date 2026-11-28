import Subscription from '../models/Subscription.js';
import User from '../models/User.js';
import FinancialConfig from '../models/FinancialConfig.js';
import Wallet from '../models/Wallet.js';
import { verifyAuth } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { formatDecimal } from '../utils/helpers.js';
import { createNotification } from '../utils/notificationService.js';
import { purchaseVipPackage } from '../services/ledgerService.js';

const PROMO_VIP_REJECTION_MESSAGE =
  'You cannot use promotional coins to purchase VIP access. Please use purchased Story Coins to continue.';

const defaultConfig = {
  key: 'default',
  coinPackages: {
    STARTER: { coins: 100, naira: 200, promotionalCoins: 0, active: true },
    PLUS: { coins: 300, naira: 600, promotionalCoins: 0, active: true },
    PREMIUM: { coins: 1000, naira: 2000, promotionalCoins: 0, active: true },
    ELITE: { coins: 3000, naira: 6000, promotionalCoins: 0, active: true },
  },
  vipPackages: {
    VIP_STARTER: { purchasedCoinPrice: 100, vipCreditsGranted: 120, active: true },
    VIP_PLUS: { purchasedCoinPrice: 250, vipCreditsGranted: 325, active: true },
    VIP_PREMIUM: { purchasedCoinPrice: 500, vipCreditsGranted: 700, active: true },
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

function buildWalletSummary(wallet) {
  const purchasedCoins = formatDecimal(wallet?.purchasedCoins || 0);
  const promotionalCoins = formatDecimal(wallet?.promotionalCoins || 0);
  const legacyRestrictedCoins = formatDecimal(wallet?.legacyRestrictedCoins || 0);
  const vipCredits = formatDecimal(wallet?.vipCredits || 0);
  const totalSpent = formatDecimal(wallet?.totalSpent || 0);
  const storyCoins = formatDecimal(
    wallet?.storyCoins ?? purchasedCoins + promotionalCoins + legacyRestrictedCoins
  );

  return {
    vipCredits,
    hasVipCredits: vipCredits > 0,
    purchasedCoins,
    promotionalCoins,
    legacyRestrictedCoins,
    storyCoins,
    totalSpent,
  };
}

export default async function vipRoutes(fastify) {
  // Returns VIP Unlock Credits status (and any remaining legacy pass until expiry)
  fastify.get('/me/status', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);

      await Subscription.updateMany(
        { userId: request.user._id, status: 'ACTIVE', expiresAt: { $lt: new Date() } },
        { $set: { status: 'EXPIRED' } }
      );

      const [subscription, wallet] = await Promise.all([
        Subscription.findOne({
          userId: request.user._id,
          status: 'ACTIVE',
          expiresAt: { $gt: new Date() },
        }),
        Wallet.findOne({ userId: request.user._id }),
      ]);

      const balances = buildWalletSummary(wallet);
      const hasLegacySubscription = Boolean(subscription);

      return sendSuccess(reply, {
        isVip: balances.hasVipCredits || hasLegacySubscription,
        hasVipCredits: balances.hasVipCredits,
        vipCredits: balances.vipCredits,
        purchasedCoins: balances.purchasedCoins,
        promotionalCoins: balances.promotionalCoins,
        legacyRestrictedCoins: balances.legacyRestrictedCoins,
        storyCoins: balances.storyCoins,
        totalSpent: balances.totalSpent,
        isSubscribed: hasLegacySubscription,
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
      return sendError(reply, 'Failed to fetch VIP status', 500, error.message);
    }
  });

  // Returns Admin-configurable fixed VIP Unlock Credit packages
  fastify.get('/plans', async (request, reply) => {
    try {
      const config = await loadFinancialConfig();
      return sendSuccess(reply, config.vipPackages);
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to fetch VIP packages', 500, error.message);
    }
  });

  // Purchase fixed VIP Unlock Credits strictly with Purchased Story Coins
  fastify.post('/subscribe', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);

      const {
        packageKey,
        tier,
        paymentMethod = 'wallet',
        coinSource,
        source,
        reference,
      } = request.body || {};

      const requestedSource = String(coinSource || source || '').trim().toUpperCase();
      if (requestedSource && requestedSource !== 'PURCHASED') {
        return sendError(reply, PROMO_VIP_REJECTION_MESSAGE, 400);
      }

      if (String(paymentMethod).toLowerCase() !== 'wallet') {
        return sendError(reply, PROMO_VIP_REJECTION_MESSAGE, 400);
      }

      const key = String(packageKey || tier || '').trim().toUpperCase();
      if (!key) {
        return sendError(reply, 'VIP package is required.', 400);
      }

      const result = await purchaseVipPackage({
        userId: request.user._id,
        packageKey: key,
        reference,
      });

      createNotification({
        userId: request.user._id,
        type: 'SYSTEM',
        title: 'VIP Unlock Credits Added',
        message: `${result.vipCreditsGranted} VIP Unlock Credits were added to your wallet.`,
        targetUrl: '#discover',
        dedupeKey: `vip_credits_${result.transaction._id}`,
      }).catch((error) => fastify.log.error('VIP notification error:', error));

      const wallet = await Wallet.findOne({ userId: request.user._id });
      const balances = buildWalletSummary(wallet);

      return sendSuccess(
        reply,
        {
          transaction: result.transaction,
          packageKey: key,
          vipCreditsGranted: result.vipCreditsGranted,
          ...balances,
        },
        'VIP Unlock Credits purchased successfully',
        201
      );
    } catch (error) {
      fastify.log.error(error);
      return sendError(
        reply,
        error.message || 'Failed to purchase VIP Unlock Credits',
        error.statusCode || 400
      );
    }
  });

  fastify.post('/subscribe/verify', async (request, reply) =>
    sendError(
      reply,
      'Direct time-based VIP purchases are no longer available. Purchase VIP Unlock Credits with Purchased Story Coins.',
      410
    )
  );

  // Keep legacy passes readable/cancellable until their existing expiry; no new timed passes are issued
  fastify.post('/cancel', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);

      const subscription = await Subscription.findOne({
        userId: request.user._id,
        status: 'ACTIVE',
      });
      if (!subscription) {
        return sendError(reply, 'No active legacy Gate Pass found', 404);
      }

      subscription.status = 'CANCELLED';
      await subscription.save();
      await User.findByIdAndUpdate(request.user._id, { subscriptionExpiresAt: null });

      return sendSuccess(reply, null, 'Legacy Gate Pass cancelled successfully');
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to cancel legacy Gate Pass', 500, error.message);
    }
  });
}
