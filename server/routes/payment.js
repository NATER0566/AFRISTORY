import paystackClient from '../config/paystack.js';
import Transaction from '../models/Transaction.js';
import Wallet from '../models/Wallet.js';
import CreatorEarning from '../models/CreatorEarning.js';
import FinancialConfig from '../models/FinancialConfig.js';
import User from '../models/User.js';
import { verifyAuth } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { generateReference, formatDecimal } from '../utils/helpers.js';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { createNotification } from '../utils/notificationService.js';
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
    (existingTransaction
      ? legacyPackage?.naira ?? currentPackage?.naira
      : currentPackage?.naira ?? legacyPackage?.naira)
  );
}

function normalizePackages(rawPackages = {}) {
  const source = rawPackages?.toObject ? rawPackages.toObject() : { ...rawPackages };
  if (source.GROWTH && !source.PLUS) {
    source.PLUS = {
      coins: Number(source.GROWTH.coins || DEFAULT_COIN_PACKAGES.PLUS.coins),
      naira: Number(source.GROWTH.naira || DEFAULT_COIN_PACKAGES.PLUS.naira),
      promotionalCoins: 0,
      active: source.GROWTH.active !== false,
    };
  }
  delete source.GROWTH;

  const normalized = {};
  for (const [key, defaults] of Object.entries(DEFAULT_COIN_PACKAGES)) {
    const entry = source[key] || defaults;
    const coins = Number(entry.coins || defaults.coins);
    const naira = Number(entry.naira || defaults.naira);
    normalized[key] = {
      coins,
      naira,
      promotionalCoins: 0, // Purchased packages never bundle promotional coins
      active: entry.active !== false,
    };
  }

  for (const [key, entry] of Object.entries(source)) {
    if (!normalized[key] && entry && typeof entry === 'object') {
      normalized[key] = {
        coins: Number(entry.coins || 0),
        naira: Number(entry.naira || 0),
        promotionalCoins: 0,
        active: entry.active !== false,
      };
    }
  }

  return normalized;
}

async function getCoinPackages() {
  const config = await FinancialConfig.findOneAndUpdate(
    { key: 'default' },
    {
      $setOnInsert: {
        key: 'default',
        coinPackages: DEFAULT_COIN_PACKAGES,
        vipPackages: {
          VIP_STARTER: { purchasedCoinPrice: 100, vipCreditsGranted: 120, active: true },
          VIP_PLUS: { purchasedCoinPrice: 250, vipCreditsGranted: 325, active: true },
          VIP_PREMIUM: { purchasedCoinPrice: 500, vipCreditsGranted: 700, active: true },
        },
        promoRewardAmount: 5,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const normalized = normalizePackages(config.coinPackages);
  if (config.coinPackages?.GROWTH) {
    await FinancialConfig.updateOne(
      { _id: config._id },
      { $set: { coinPackages: normalized } }
    );
  }
  return normalized;
}

function decimal(value) {
  return mongoose.Types.Decimal128.fromString(Number(value).toFixed(2));
}

export default async function paymentRoutes(fastify) {
  // Get configurable purchased coin packages (₦2/coin standard, no promo coins bundled)
  fastify.get('/packages', async (request, reply) => {
    try {
      return sendSuccess(reply, await getCoinPackages());
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to fetch packages', 500, error.message);
    }
  });

  // Initialize Paystack payment transaction (viewer pays exact advertised price, zero surcharge)
  fastify.post('/initialize-transaction', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const requestedKey = String(request.body?.packageKey || '').trim().toUpperCase();
      const packageKey = requestedKey === 'GROWTH' ? 'PLUS' : requestedKey;
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
      if (!wallet) {
        return sendError(reply, 'Wallet not found', 404);
      }

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
          amount: Math.round(Number(coinPackage.naira) * 100),
          reference,
          metadata: {
            userId: request.user._id.toString(),
            coins: coinPackage.coins,
            packageKey,
          },
        });

        if (response.data.status === true) {
          return sendSuccess(
            reply,
            {
              authorizationUrl: response.data.data.authorization_url,
              accessCode: response.data.data.access_code,
              reference,
            },
            'Payment initialized successfully'
          );
        }

        await Transaction.updateOne({ reference, status: 'PENDING' }, { $set: { status: 'FAILED' } });
        return sendError(reply, 'Payment initialization failed', 400);
      } catch (error) {
        await Transaction.updateOne({ reference, status: 'PENDING' }, { $set: { status: 'FAILED' } });
        fastify.log.error('Paystack API error:', error.response?.data || error.message);
        return sendError(reply, 'Payment service error', 500, error.message);
      }
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to initialize payment', 500, error.message);
    }
  });

  // Verify Paystack payment and credit Purchased Story Coins (Paystack fee absorbed by AFRISTORY's 60%)
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

        if (!transaction.metadata || transaction.metadata.userId !== request.user._id.toString()) {
          return sendError(reply, 'Invalid transaction metadata', 400);
        }

        const existingTransaction = await Transaction.findOne({ reference });
        if (existingTransaction?.status === 'SUCCESS') {
          const currentWallet = await Wallet.findOne({ userId: request.user._id });
          return sendSuccess(
            reply,
            currentWallet
              ? {
                  coins: Number(existingTransaction.amount),
                  newBalance: formatDecimal(currentWallet.storyCoins),
                  purchasedCoins: formatDecimal(currentWallet.purchasedCoins),
                  promotionalCoins: formatDecimal(currentWallet.promotionalCoins),
                  vipCredits: formatDecimal(currentWallet.vipCredits),
                }
              : null,
            'Payment already processed'
          );
        }

        const rawKey = String(transaction.metadata.packageKey || '').toUpperCase();
        const packageKey = rawKey === 'GROWTH' ? 'PLUS' : rawKey;
        const coinPackages = await getCoinPackages();
        const currentPackage = coinPackages[packageKey];
        const legacyPackage = LEGACY_COIN_PACKAGES[rawKey] || LEGACY_COIN_PACKAGES[packageKey];
        const expected = expectedPackagePrice(existingTransaction, currentPackage, legacyPackage);
        const coins = Number(existingTransaction?.amount ?? transaction.metadata.coins);
        const paidNaira = Number(transaction.amount) / 100;
        const providerFeeNaira = Number(transaction.fees || 0) / 100;

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
          providerFeeNaira,
          paystackTransactionId: transaction.id,
          metadata: {
            packageKey,
            paystackReference: transaction.reference,
            currency: transaction.currency,
            providerFeeNaira,
          },
        });

        const wallet = result.wallet || (await Wallet.findOne({ userId: request.user._id }));

        createNotification({
          userId: request.user._id,
          type: 'PAYMENT_SUCCESS',
          title: 'Payment Successful 🪙',
          message: `Your wallet has been credited with ${coins} Purchased Story Coins.`,
          targetUrl: '#wallet',
          icon: 'https://ui-avatars.com/api/?name=AfriStory&background=d4a017&color=fff&size=192',
          dedupeKey: `pay_verify_${reference}`,
        }).catch((err) => fastify.log.error('Push error:', err));

        return sendSuccess(reply, {
          coins,
          newBalance: formatDecimal(wallet.storyCoins),
          purchasedCoins: formatDecimal(wallet.purchasedCoins),
          promotionalCoins: formatDecimal(wallet.promotionalCoins),
          vipCredits: formatDecimal(wallet.vipCredits),
        });
      } catch (error) {
        fastify.log.error('Paystack verification error:', error.response?.data || error.message);
        return sendError(reply, 'Payment verification failed', 500, error.message);
      }
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to verify payment', 500, error.message);
    }
  });

  // Paystack signed webhook for payment confirmation
  fastify.post('/webhook/paystack', async (request, reply) => {
    try {
      const hash = crypto
        .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
        .update(JSON.stringify(request.body))
        .digest('hex');

      const signature = request.headers['x-paystack-signature'];
      if (
        !signature ||
        hash.length !== signature.length ||
        !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature))
      ) {
        return sendError(reply, 'Invalid signature', 401);
      }

      const event = request.body;
      if (event.event !== 'charge.success') {
        return sendSuccess(reply, null, 'Event ignored');
      }

      const transaction = event.data;
      const reference = transaction.reference;

      const existingTransaction = await Transaction.findOne({ reference });
      if (existingTransaction?.status === 'SUCCESS') {
        return sendSuccess(reply, null, 'Already processed');
      }

      const userId = transaction.metadata?.userId;
      const coinPackages = await getCoinPackages();
      const rawKey = String(transaction.metadata?.packageKey || '').toUpperCase();
      const packageKey = rawKey === 'GROWTH' ? 'PLUS' : rawKey;
      const currentPackage = coinPackages[packageKey];
      const legacyPackage = LEGACY_COIN_PACKAGES[rawKey] || LEGACY_COIN_PACKAGES[packageKey];
      const expected = expectedPackagePrice(existingTransaction, currentPackage, legacyPackage);
      const coins = Number(existingTransaction?.amount ?? transaction.metadata?.coins);
      const paidNaira = Number(transaction.amount) / 100;
      const providerFeeNaira = Number(transaction.fees || 0) / 100;

      if (!userId || !Number.isFinite(coins) || coins <= 0) {
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
        providerFeeNaira,
        paystackTransactionId: transaction.id,
        metadata: {
          packageKey,
          paystackReference: reference,
          currency: transaction.currency,
          providerFeeNaira,
        },
      });

      createNotification({
        userId,
        type: 'PAYMENT_SUCCESS',
        title: 'Payment Successful 🪙',
        message: `Your wallet has been credited with ${coins} Purchased Story Coins.`,
        targetUrl: '#wallet',
        icon: 'https://ui-avatars.com/api/?name=AfriStory&background=d4a017&color=fff&size=192',
        dedupeKey: `pay_webhook_${reference}`,
      }).catch((err) => fastify.log.error('Push error:', err));

      return sendSuccess(reply, null, 'Webhook processed');
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Webhook processing failed', 500, error.message);
    }
  });

  // Atomic Creator Payout Request — reserves availableCreatorEarnings & writes PENDING PAYOUT transaction
  fastify.post('/request-payout', async (request, reply) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      await verifyAuth(request, reply);
      if (!request.user) {
        await session.abortTransaction();
        return sendError(reply, 'Unauthorized', 401);
      }

      const { amount, bankCode, accountNumber, accountName = '' } = request.body || {};
      if (!amount || !bankCode || !accountNumber) {
        await session.abortTransaction();
        return sendError(reply, 'Amount, bank code, and account number are required', 400);
      }

      const requestedAmount = Number(amount);
      if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
        await session.abortTransaction();
        return sendError(reply, 'Invalid payout amount', 400);
      }

      const wallet = await Wallet.findOne({ userId: request.user._id }).session(session);
      if (!wallet) {
        await session.abortTransaction();
        return sendError(reply, 'Wallet not found', 404);
      }

      const availableEarnings = Number(formatDecimal(wallet.availableCreatorEarnings || 0));
      if (availableEarnings < requestedAmount) {
        await session.abortTransaction();
        return sendError(
          reply,
          'Insufficient available creator earnings. Pending earnings must be reconciled before withdrawal.',
          400
        );
      }

      // Cross-check reconciled AVAILABLE CreatorEarning ledger records so withdrawable balance never exceeds earned allocations
      const availableRecords = await CreatorEarning.find({
        userId: request.user._id,
        status: 'AVAILABLE',
      }).session(session);

      if (availableRecords.length > 0) {
        const verifiedAvailableSum = availableRecords.reduce(
          (sum, rec) => sum + Number(formatDecimal(rec.creatorAmountNaira || 0)),
          0
        );
        if (verifiedAvailableSum + 0.01 < requestedAmount) {
          await session.abortTransaction();
          return sendError(reply, 'Requested amount exceeds verified available creator earnings', 400);
        }
      }

      const nextAvailable = Math.max(0, availableEarnings - requestedAmount);
      wallet.availableCreatorEarnings = decimal(nextAvailable);
      if (wallet.lockedEarnings !== undefined) {
        const currentLocked = Number(formatDecimal(wallet.lockedEarnings || 0));
        wallet.lockedEarnings = decimal(Math.max(0, currentLocked - requestedAmount));
      }
      await wallet.save({ session });

      const reference = generateReference('PAYOUT');
      const payoutTx = await Transaction.create(
        [
          {
            walletId: wallet._id,
            userId: request.user._id,
            type: 'PAYOUT',
            source: 'PAYOUT',
            amount: decimal(requestedAmount),
            grossNaira: decimal(requestedAmount),
            creatorShareNaira: decimal(requestedAmount),
            platformShareNaira: decimal(0),
            providerFeeNaira: decimal(0),
            reference,
            status: 'PENDING',
            metadata: {
              bankCode: String(bankCode).trim(),
              accountNumber: String(accountNumber).trim(),
              accountName: String(accountName).trim(),
              reservedFromAvailable: requestedAmount,
            },
          },
        ],
        { session }
      );

      await session.commitTransaction();

      return sendSuccess(reply, {
        message: 'Payout request submitted',
        reference,
        transactionId: payoutTx[0]._id,
        status: 'PENDING',
        amount: formatDecimal(requestedAmount),
        availableCreatorEarnings: formatDecimal(nextAvailable),
      });
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      fastify.log.error(error);
      return sendError(reply, 'Failed to request payout', 500, error.message);
    } finally {
      await session.endSession();
    }
  });
}
