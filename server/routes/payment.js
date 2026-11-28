import paystackClient from '../config/paystack.js';
import Transaction from '../models/Transaction.js';
import Wallet from '../models/Wallet.js';
import FinancialConfig from '../models/FinancialConfig.js';
import User from '../models/User.js';
import { verifyAuth } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { generateReference, formatDecimal } from '../utils/helpers.js';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { createNotification } from '../utils/notificationService.js'; // NEW: Central notification service
import { creditPurchasedCoins } from '../services/ledgerService.js';

const DEFAULT_COIN_PACKAGES = {
  STARTER: { coins: 100, naira: 200, promotionalCoins: 0, active: true },
  PLUS: { coins: 300, naira: 600, promotionalCoins: 0, active: true },
  PREMIUM: { coins: 1000, naira: 2000, promotionalCoins: 0, active: true },
  ELITE: { coins: 3000, naira: 6000, promotionalCoins: 0, active: true },
};

const LEGACY_COIN_PACKAGES = {
  STARTER: { coins: 100, naira: 4750 },
  GROWTH: { coins: 300, naira: 12000 },
  PREMIUM: { coins: 1000, naira: 35000 },
  ELITE: { coins: 3000, naira: 95000 },
};

function expectedPackagePrice(existingTransaction, currentPackage, legacyPackage) {
  return (
    existingTransaction?.metadata?.expectedNaira ??
    (existingTransaction ? legacyPackage?.naira ?? currentPackage?.naira : currentPackage?.naira ?? legacyPackage?.naira)
  );
}

async function getCoinPackages() {
  const config = await FinancialConfig.findOneAndUpdate(
    { key: 'default' },
    {
      $setOnInsert: {
        key: 'default',
        coinPackages: DEFAULT_COIN_PACKAGES,
        vipPackages: {
          VIP_STARTER: { purchasedCoinPrice: 0, vipCreditsGranted: 0, active: false },
          VIP_PLUS: { purchasedCoinPrice: 0, vipCreditsGranted: 0, active: false },
          VIP_PREMIUM: { purchasedCoinPrice: 0, vipCreditsGranted: 0, active: false },
        },
        promoRewardAmount: 5,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return config.coinPackages;
}

function decimal(value) {
  return mongoose.Types.Decimal128.fromString(Number(value).toFixed(2));
}

export default async function paymentRoutes(fastify, opts) {
  // Get coin packages
  fastify.get('/packages', async (request, reply) => {
    try {
      sendSuccess(reply, await getCoinPackages());
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
      const coinPackages = await getCoinPackages();

      if (!packageKey || !coinPackages[packageKey]?.active) {
        return sendError(reply, 'Invalid coin package', 400);
      }

      const coinPackage = coinPackages[packageKey];
      const reference = generateReference('PAY');

      const user = await User.findById(request.user._id);

      if (!user) {
        return sendError(reply, 'User not found', 404);
      }

      const wallet = await Wallet.findOne({ userId: request.user._id });
      if (!wallet) return sendError(reply, 'Wallet not found', 404);
      await Transaction.create({
        walletId: wallet._id,
        userId: request.user._id,
        type: 'COIN_PURCHASE',
        source: 'PURCHASED',
        amount: decimal(coinPackage.coins),
        reference,
        grossNaira: decimal(coinPackage.naira),
        status: 'PENDING',
        metadata: { packageKey, expectedNaira: coinPackage.naira },
      });

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
          await Transaction.updateOne({ reference, status: 'PENDING' }, { $set: { status: 'FAILED' } });
          sendError(reply, 'Payment initialization failed', 400);
        }
      } catch (error) {
        await Transaction.updateOne({ reference, status: 'PENDING' }, { $set: { status: 'FAILED' } });
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
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { reference } = request.body || {};

      if (!reference) {
        return sendError(reply, 'Reference is required', 400);
      }

      try {
        const response = await paystackClient.get(`/transaction/verify/${reference}`);

        if (response.data.status === false) {
          return sendError(reply, 'Payment verification failed', 400);
        }

        const transaction = response.data.data;

        if (transaction.status !== 'success') {
          return sendError(reply, 'Payment was not successful', 400);
        }

        // Check if metadata is valid
        if (!transaction.metadata || transaction.metadata.userId !== request.user._id.toString()) {
          return sendError(reply, 'Invalid transaction metadata', 400);
        }

        const existingTransaction = await Transaction.findOne({ reference });

        if (existingTransaction?.status === 'SUCCESS') {
          return sendSuccess(reply, null, 'Payment already processed');
        }

        const packageKey = transaction.metadata.packageKey;
        const currentPackage = (await getCoinPackages())[packageKey];
        const legacyPackage = LEGACY_COIN_PACKAGES[packageKey];
        const expected = expectedPackagePrice(existingTransaction, currentPackage, legacyPackage);
        const coins = Number(existingTransaction?.amount ?? transaction.metadata.coins);
        const paidNaira = Number(transaction.amount) / 100;
        if (
          !Number.isSafeInteger(coins) ||
          coins <= 0 ||
          !Number.isFinite(expected) ||
          paidNaira !== Number(expected) ||
          transaction.currency !== 'NGN' ||
          Number(transaction.metadata.coins) !== coins
        ) {
          return sendError(reply, 'Invalid transaction amount', 400);
        }
        const result = await creditPurchasedCoins({
          userId: request.user._id,
          coins,
          reference,
          grossNaira: paidNaira,
          providerFeeNaira: Number(transaction.fees || 0) / 100,
          paystackTransactionId: transaction.id,
          metadata: {
            packageKey,
            paystackReference: transaction.reference,
            currency: transaction.currency,
          },
        });
        const wallet = result.wallet || await Wallet.findOne({ userId: request.user._id });

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
        fastify.log.error('Paystack verification error:', error.response?.data || error.message);
        sendError(reply, 'Payment verification failed', 500, error.message);
      }
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to verify payment', 500, error.message);
    }
  });

  // Paystack webhook for payment confirmation
  fastify.post('/webhook/paystack', async (request, reply) => {
    try {
      const hash = crypto
        .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
        .update(JSON.stringify(request.body))
        .digest('hex');

      const signature = request.headers['x-paystack-signature'];
      if (!signature || hash.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature))) {
        return sendError(reply, 'Invalid signature', 401);
      }

      const event = request.body;

      if (event.event !== 'charge.success') {
        return sendSuccess(reply, null, 'Event ignored');
      }

      const transaction = event.data;
      const reference = transaction.reference;

      // Check if already processed
      const existingTransaction = await Transaction.findOne({ reference });

      if (existingTransaction?.status === 'SUCCESS') {
        return sendSuccess(reply, null, 'Already processed');
      }

      // Credit coins
      const userId = transaction.metadata.userId;
      const coinPackages = await getCoinPackages();
      const packageKey = transaction.metadata?.packageKey;
      const currentPackage = coinPackages[packageKey];
      const legacyPackage = LEGACY_COIN_PACKAGES[packageKey];
      const expected = expectedPackagePrice(existingTransaction, currentPackage, legacyPackage);
      const coins = Number(existingTransaction?.amount ?? transaction.metadata?.coins);
      const paidNaira = Number(transaction.amount) / 100;
      if (!transaction.metadata?.userId || !Number.isFinite(coins) || coins <= 0) {
        return sendError(reply, 'Invalid transaction metadata', 400);
      }
      if (
        !Number.isFinite(expected) ||
        paidNaira !== Number(expected) ||
        transaction.currency !== 'NGN' ||
        transaction.status !== 'success' ||
        Number(transaction.metadata?.coins) !== coins
      ) {
        return sendError(reply, 'Payment amount does not match the selected coin package', 400);
      }

      await creditPurchasedCoins({
        userId,
        coins,
        reference,
        grossNaira: paidNaira,
        providerFeeNaira: Number(transaction.fees || 0) / 100,
        paystackTransactionId: transaction.id,
        metadata: {
          packageKey,
          paystackReference: reference,
          currency: transaction.currency,
        },
      });

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
      fastify.log.error(error);
      sendError(reply, 'Webhook processing failed', 500, error.message);
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
