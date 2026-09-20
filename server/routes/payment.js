import paystackClient from '../config/paystack.js';
import Transaction from '../models/Transaction.js';
import Wallet from '../models/Wallet.js';
import User from '../models/User.js';
import { verifyAuth } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { generateReference, formatDecimal } from '../utils/helpers.js';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { createNotification } from '../utils/notificationService.js'; // NEW: Central notification service

// Coin packages
const COIN_PACKAGES = {
  STARTER: { coins: 100, price: 10.0, naira: 4750 },
  GROWTH: { coins: 300, price: 25.0, naira: 12000 },
  PREMIUM: { coins: 1000, price: 75.0, naira: 35000 },
  ELITE: { coins: 3000, price: 200.0, naira: 95000 },
};

export default async function paymentRoutes(fastify, opts) {
  // Get coin packages
  fastify.get('/packages', async (request, reply) => {
    try {
      sendSuccess(reply, COIN_PACKAGES);
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch packages', 500, error.message);
    }
  });

  // Initialize payment transaction
  fastify.post('/initialize-transaction', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { packageKey } = request.body || {};

      if (!packageKey || !COIN_PACKAGES[packageKey]) {
        return sendError(reply, 'Invalid coin package', 400);
      }

      const coinPackage = COIN_PACKAGES[packageKey];
      const reference = generateReference('PAY');

      const user = await User.findById(request.user._id);

      if (!user) {
        return sendError(reply, 'User not found', 404);
      }

      try {
        const response = await paystackClient.post('/transaction/initialize', {
          email: user.email,
          amount: coinPackage.naira * 100,
          reference,
          metadata: {
            userId: request.user._id.toString(),
            coins: coinPackage.coins,
            packageKey,
          },
        });

        if (response.data.status === true) {
          // Store reference for verification
          sendSuccess(
            reply,
            {
              authorizationUrl: response.data.data.authorization_url,
              accessCode: response.data.data.access_code,
              reference,
            },
            'Payment initialized successfully'
          );
        } else {
          sendError(reply, 'Payment initialization failed', 400);
        }
      } catch (error) {
        fastify.log.error('Paystack API error:', error.response?.data || error.message);
        sendError(reply, 'Payment service error', 500, error.message);
      }
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to initialize payment', 500, error.message);
    }
  });

  // Verify payment and credit coins
  fastify.post('/verify-transaction', async (request, reply) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        await session.abortTransaction();
        return sendError(reply, 'Unauthorized', 401);
      }

      const { reference } = request.body || {};

      if (!reference) {
        await session.abortTransaction();
        return sendError(reply, 'Reference is required', 400);
      }

      try {
        const response = await paystackClient.get(`/transaction/verify/${reference}`);

        if (response.data.status === false) {
          await session.abortTransaction();
          return sendError(reply, 'Payment verification failed', 400);
        }

        const transaction = response.data.data;

        if (transaction.status !== 'success') {
          await session.abortTransaction();
          return sendError(reply, 'Payment was not successful', 400);
        }

        // Check if metadata is valid
        if (!transaction.metadata || transaction.metadata.userId !== request.user._id.toString()) {
          await session.abortTransaction();
          return sendError(reply, 'Invalid transaction metadata', 400);
        }

        // Check if already processed (idempotency)
        const existingTransaction = await Transaction.findOne({
          reference,
        }).session(session);

        if (existingTransaction) {
          await session.abortTransaction();
          return sendSuccess(reply, null, 'Payment already processed');
        }

        // Credit coins to user wallet
        const coins = Number(transaction.metadata.coins);
        if (!Number.isFinite(coins) || coins <= 0) {
          await session.abortTransaction();
          return sendError(reply, 'Invalid transaction amount', 400);
        }
        const wallet = await Wallet.findOne({ userId: request.user._id }).session(session);

        if (!wallet) {
          await session.abortTransaction();
          return sendError(reply, 'Wallet not found', 404);
        }

        wallet.storyCoins = mongoose.Types.Decimal128.fromString((Number(wallet.storyCoins.toString()) + coins).toFixed(2));
        await wallet.save({ session });

        // Create transaction record
        const txn = new Transaction({
          walletId: wallet._id,
          userId: request.user._id,
          type: 'FUND',
          amount: mongoose.Types.Decimal128.fromString(coins.toFixed(2)),
          reference,
          description: `Purchased ${transaction.metadata.coins} coins`,
          status: 'SUCCESS',
          metadata: {
            paystackTransactionId: transaction.id,
            paystackReference: transaction.reference,
          },
        });

        await txn.save({ session });

        await session.commitTransaction();

        // NEW: Notify user of successful payment asynchronously + BEAUTIFUL BRANDING
        createNotification({
          userId: request.user._id,
          type: 'PAYMENT_SUCCESS',
          title: 'Payment Successful 🪙',
          message: `Your wallet has been credited with ${coins} coins.`,
          targetUrl: '#wallet',
          icon: 'https://ui-avatars.com/api/?name=AfriStory&background=d4a017&color=fff&size=192', // ADDED GOLD BRANDING
          dedupeKey: `pay_verify_${reference}`
        }).catch(err => fastify.log.error('Push error:', err));

        sendSuccess(reply, {
          coins: transaction.metadata.coins,
          newBalance: formatDecimal(wallet.storyCoins),
        });
      } catch (error) {
        await session.abortTransaction();
        fastify.log.error('Paystack verification error:', error.response?.data || error.message);
        sendError(reply, 'Payment verification failed', 500, error.message);
      }
    } catch (error) {
      await session.abortTransaction();
      fastify.log.error(error);
      sendError(reply, 'Failed to verify payment', 500, error.message);
    } finally {
      session.endSession();
    }
  });

  // Paystack webhook for payment confirmation
  fastify.post('/webhook/paystack', async (request, reply) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const hash = crypto
        .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
        .update(JSON.stringify(request.body))
        .digest('hex');

      const signature = request.headers['x-paystack-signature'];
      if (!signature || hash.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature))) {
        await session.abortTransaction();
        return sendError(reply, 'Invalid signature', 401);
      }

      const event = request.body;

      if (event.event !== 'charge.success') {
        await session.abortTransaction();
        return sendSuccess(reply, null, 'Event ignored');
      }

      const transaction = event.data;
      const reference = transaction.reference;

      // Check if already processed
      const existingTransaction = await Transaction.findOne({
        reference,
      }).session(session);

      if (existingTransaction) {
        await session.abortTransaction();
        return sendSuccess(reply, null, 'Already processed');
      }

      // Credit coins
      const userId = transaction.metadata.userId;
      const coins = Number(transaction.metadata?.coins);
      if (!transaction.metadata?.userId || !Number.isFinite(coins) || coins <= 0) {
        await session.abortTransaction();
        return sendError(reply, 'Invalid transaction metadata', 400);
      }
      const wallet = await Wallet.findOne({ userId }).session(session);

      if (!wallet) {
        await session.abortTransaction();
        return sendError(reply, 'Wallet not found', 404);
      }

      wallet.storyCoins = mongoose.Types.Decimal128.fromString((Number(wallet.storyCoins.toString()) + coins).toFixed(2));
      await wallet.save({ session });

      const txn = new Transaction({
        walletId: wallet._id,
        userId,
        type: 'FUND',
        amount: mongoose.Types.Decimal128.fromString(coins.toFixed(2)),
        reference,
        description: `Purchased ${transaction.metadata.coins} coins via webhook`,
        status: 'SUCCESS',
        metadata: {
          paystackTransactionId: transaction.id,
        },
      });

      await txn.save({ session });

      await session.commitTransaction();

      // NEW: Notify user of successful payment via webhook asynchronously + BEAUTIFUL BRANDING
      createNotification({
        userId,
        type: 'PAYMENT_SUCCESS',
        title: 'Payment Successful 🪙',
        message: `Your wallet has been credited with ${coins} coins.`,
        targetUrl: '#wallet',
        icon: 'https://ui-avatars.com/api/?name=AfriStory&background=d4a017&color=fff&size=192', // ADDED GOLD BRANDING
        dedupeKey: `pay_webhook_${reference}`
      }).catch(err => fastify.log.error('Push error:', err));

      sendSuccess(reply, null, 'Webhook processed');
    } catch (error) {
      await session.abortTransaction();
      fastify.log.error(error);
      sendError(reply, 'Webhook processing failed', 500, error.message);
    } finally {
      session.endSession();
    }
  });

  // Request payout
  fastify.post('/request-payout', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { amount, bankCode, accountNumber } = request.body || {};

      if (!amount || !bankCode || !accountNumber) {
        return sendError(reply, 'Amount, bank code, and account number are required', 400);
      }

      const wallet = await Wallet.findOne({ userId: request.user._id });

      if (!wallet) {
        return sendError(reply, 'Wallet not found', 404);
      }

      const requestedAmount = Number(amount);
      const lockedEarnings = Number(wallet.lockedEarnings.toString());

      if (!Number.isFinite(requestedAmount) || requestedAmount <= 0 || lockedEarnings < requestedAmount) {
        return sendError(reply, 'Insufficient locked earnings', 400);
      }

      // TODO: Implement actual payout processing via Paystack Transfer API
      // For now, just validate the request

      sendSuccess(reply, {
        message: 'Payout request submitted',
        status: 'PENDING',
        amount,
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to request payout', 500, error.message);
    }
  });
}
