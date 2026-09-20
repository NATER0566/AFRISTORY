import Subscription from '../models/Subscription.js';
import User from '../models/User.js';
import { verifyAuth } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import Wallet from '../models/Wallet.js';
import paystackClient from '../config/paystack.js';
import { generateReference } from '../utils/helpers.js';
import { createNotification } from '../utils/notificationService.js'; // NEW: Central notification service

// The VIP passes your platform uses
const VIP_PLANS = {
  DAILY: { price: 10, naira: 500, duration: 1 },
  HALF_WEEK: { price: 25, naira: 1200, duration: 4 },
  WEEKLY: { price: 45, naira: 2200, duration: 7 },
  MONTHLY: { price: 150, naira: 7500, duration: 30 },
};

export default async function vipRoutes(fastify, opts) {
  // Get subscription status
  fastify.get('/me/status', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      // Automatically clean up expired subscriptions
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
        isSubscribed: !!subscription,
        subscription: subscription ? {
          tier: subscription.tier,
          expiresAt: subscription.expiresAt,
          renewalDate: subscription.renewalDate,
        } : null,
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch subscription status', 500, error.message);
    }
  });

  // Get VIP plans
  fastify.get('/plans', async (request, reply) => {
    try {
      sendSuccess(reply, VIP_PLANS);
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch plans', 500, error.message);
    }
  });

  // Subscribe to VIP (The Gate Pass)
  fastify.post('/subscribe', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { tier, paymentMethod = 'wallet' } = request.body || {};

      if (!tier || !VIP_PLANS[tier]) {
        return sendError(reply, 'Invalid subscription tier', 400);
      }

      // Check if already subscribed
      const existingSubscription = await Subscription.findOne({
        userId: request.user._id,
        status: 'ACTIVE',
        expiresAt: { $gt: new Date() },
      });

      if (existingSubscription) {
        return sendError(reply, 'You already have an active Gate Pass!', 409);
      }

      const plan = VIP_PLANS[tier];
      const expiresAt = new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000);

      // --- PAYSTACK DIRECT PAYMENT ---
      if (paymentMethod === 'direct' || paymentMethod === 'paystack') {
        const reference = generateReference('SUB');
        const payment = await paystackClient.post('/transaction/initialize', {
          email: request.user.email,
          amount: plan.naira * 100,
          reference,
          metadata: { userId: request.user._id.toString(), tier },
        });
        return sendSuccess(reply, {
          authorizationUrl: payment.data.data.authorization_url,
          accessCode: payment.data.data.access_code,
          reference,
        }, 'Subscription payment initialized');
      }

      // --- WALLET COIN PAYMENT ---
      if (paymentMethod !== 'wallet') {
        return sendError(reply, 'Invalid payment method', 400);
      }

      const wallet = await Wallet.findOne({ userId: request.user._id });
      if (!wallet) return sendError(reply, 'Wallet not found', 404);
      
      const balance = Number(wallet.storyCoins.toString());
      if (!Number.isFinite(balance) || balance < plan.price) {
        return sendError(reply, `You need ${plan.price} coins for this pass.`, 400);
      }
      
      // Deduct coins
      wallet.storyCoins = (balance - plan.price).toFixed(2);
      await wallet.save();

      // Create new subscription record
      const subscription = new Subscription({
        userId: request.user._id,
        tier,
        expiresAt,
        price: plan.price,
        status: 'ACTIVE',
      });
      await subscription.save();

      // IMPORTANT: Update the user model so middleware and feed know they have access
      const user = await User.findById(request.user._id);
      user.subscriptionExpiresAt = expiresAt;
      await user.save();

      // NEW: Trigger beautiful branded VIP Notification asynchronously
      createNotification({
        userId: request.user._id,
        type: 'SYSTEM',
        title: 'Gate Pass Activated 🌟',
        message: `Your ${tier} VIP pass is active for ${plan.duration} days. Enjoy unlimited stories!`,
        targetUrl: '#discover',
        icon: 'https://ui-avatars.com/api/?name=AfriStory+VIP&background=d4a017&color=fff&size=192', // ADDED GOLD VIP BRANDING
        dedupeKey: `vip_sub_${subscription._id}`
      }).catch(err => fastify.log.error('Push error:', err));

      // Return both the subscription AND the updated user expiration date
      sendSuccess(reply, {
          subscription,
          expiresAt: user.subscriptionExpiresAt 
      }, 'Gate Pass activated successfully', 201);
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to activate Gate Pass', 500, error.message);
    }
  });

  // Complete a direct Paystack subscription payment.
  fastify.post('/subscribe/verify', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);
      
      const { reference } = request.body || {};
      if (!reference) return sendError(reply, 'Payment reference is required', 400);

      const payment = await paystackClient.get(`/transaction/verify/${reference}`);
      const transaction = payment.data.data;
      const tier = transaction?.metadata?.tier;
      
      if (payment.data.status !== true || transaction?.status !== 'success' ||
        transaction.metadata?.userId !== request.user._id.toString() || !VIP_PLANS[tier]) {
        return sendError(reply, 'Payment verification failed', 400);
      }

      // Ensure they don't double-subscribe during webhooks
      const existing = await Subscription.findOne({ paymentReference: reference });
      if (existing) return sendSuccess(reply, existing, 'Already verified', 200);

      const plan = VIP_PLANS[tier];
      const expiresAt = new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000);
      
      const subscription = await Subscription.create({
        userId: request.user._id,
        tier,
        expiresAt,
        price: plan.price,
        paymentReference: reference,
        status: 'ACTIVE',
      });
      
      await User.findByIdAndUpdate(request.user._id, { subscriptionExpiresAt: expiresAt });
      
      // NEW: Trigger beautiful branded VIP Notification asynchronously
      createNotification({
        userId: request.user._id,
        type: 'SYSTEM',
        title: 'Gate Pass Activated 🌟',
        message: `Your ${tier} VIP pass is active for ${plan.duration} days. Enjoy unlimited stories!`,
        targetUrl: '#discover',
        icon: 'https://ui-avatars.com/api/?name=AfriStory+VIP&background=d4a017&color=fff&size=192', // ADDED GOLD VIP BRANDING
        dedupeKey: `vip_sub_${subscription._id}`
      }).catch(err => fastify.log.error('Push error:', err));

      sendSuccess(reply, subscription, 'Gate Pass activated successfully', 201);
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to verify subscription payment', 500, error.message);
    }
  });

  // Cancel subscription
  fastify.post('/cancel', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const subscription = await Subscription.findOne({
        userId: request.user._id,
        status: 'ACTIVE',
      });

      if (!subscription) {
        return sendError(reply, 'No active Gate Pass found', 404);
      }

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
