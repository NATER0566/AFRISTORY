import mongoose from 'mongoose';
import User from '../models/User.js';
import Creator from '../models/Creator.js';
import Report from '../models/Report.js';
import Series from '../models/Series.js';
import Episode from '../models/Episode.js';
import Wallet from '../models/Wallet.js';
import CoinLot from '../models/CoinLot.js';
import CreatorEarning from '../models/CreatorEarning.js';
import AdRevenueBatch from '../models/AdRevenueBatch.js';
import Transaction from '../models/Transaction.js';
import Unlock from '../models/Unlock.js';
import AdRewardSession from '../models/AdRewardSession.js';
import FinancialConfig from '../models/FinancialConfig.js';
import { verifyAdmin } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { paginate, formatDecimal } from '../utils/helpers.js';
import { createNotification } from '../utils/notificationService.js';
import { reconcileAdRevenueBatch } from '../services/ledgerService.js';

const DEFAULT_COIN_PACKAGES = {
  STARTER: { coins: 100, naira: 200, promotionalCoins: 0, active: true },
  PLUS: { coins: 300, naira: 600, promotionalCoins: 0, active: true },
  PREMIUM: { coins: 1000, naira: 2000, promotionalCoins: 0, active: true },
  ELITE: { coins: 3000, naira: 6000, promotionalCoins: 0, active: true },
};

const DEFAULT_VIP_PACKAGES = {
  VIP_STARTER: { purchasedCoinPrice: 100, vipCreditsGranted: 120, active: true },
  VIP_PLUS: { purchasedCoinPrice: 250, vipCreditsGranted: 325, active: true },
  VIP_PREMIUM: { purchasedCoinPrice: 500, vipCreditsGranted: 700, active: true },
};

async function getFinancialConfig() {
  return FinancialConfig.findOneAndUpdate(
    { key: 'default' },
    {
      $setOnInsert: {
        key: 'default',
        coinPackages: DEFAULT_COIN_PACKAGES,
        vipPackages: DEFAULT_VIP_PACKAGES,
        promoRewardAmount: 5,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

function toNum(val) {
  if (val === null || val === undefined) return 0;
  return Number(val.toString ? val.toString() : val) || 0;
}

async function computeAdminAccountingSummary() {
  const [
    walletTotalsAgg,
    lotTotalsAgg,
    txTotalsAgg,
    creatorEarningAgg,
    directAdCompletions,
    promoAdCompletions,
    adBatchAgg,
    recentBatches,
  ] = await Promise.all([
    Wallet.aggregate([
      {
        $group: {
          _id: null,
          purchasedCoinsOutstanding: { $sum: { $toDouble: { $ifNull: ['$purchasedCoins', 0] } } },
          promotionalCoinsOutstanding: { $sum: { $toDouble: { $ifNull: ['$promotionalCoins', 0] } } },
          legacyRestrictedCoinsOutstanding: {
            $sum: { $toDouble: { $ifNull: ['$legacyRestrictedCoins', 0] } },
          },
          vipCreditsOutstanding: { $sum: { $toDouble: { $ifNull: ['$vipCredits', 0] } } },
          pendingCreatorEarnings: {
            $sum: { $toDouble: { $ifNull: ['$pendingCreatorEarnings', 0] } },
          },
          availableCreatorEarnings: {
            $sum: { $toDouble: { $ifNull: ['$availableCreatorEarnings', 0] } },
          },
          withdrawnCreatorEarnings: {
            $sum: { $toDouble: { $ifNull: ['$withdrawnCreatorEarnings', 0] } },
          },
        },
      },
    ]),
    CoinLot.aggregate([
      {
        $group: {
          _id: '$source',
          initialCoins: { $sum: { $toDouble: { $ifNull: ['$initialCoins', 0] } } },
          remainingCoins: { $sum: { $toDouble: { $ifNull: ['$remainingCoins', 0] } } },
          cashValueNaira: { $sum: { $toDouble: { $ifNull: ['$cashValueNaira', 0] } } },
          providerFeeNaira: { $sum: { $toDouble: { $ifNull: ['$providerFeeNaira', 0] } } },
        },
      },
    ]),
    Transaction.aggregate([
      { $match: { status: 'SUCCESS' } },
      {
        $group: {
          _id: { type: '$type', source: '$source' },
          totalAmount: { $sum: { $toDouble: { $ifNull: ['$amount', 0] } } },
          totalGrossNaira: { $sum: { $toDouble: { $ifNull: ['$grossNaira', 0] } } },
          totalCreatorShareNaira: {
            $sum: { $toDouble: { $ifNull: ['$creatorShareNaira', 0] } },
          },
          totalPlatformShareNaira: {
            $sum: { $toDouble: { $ifNull: ['$platformShareNaira', 0] } },
          },
          totalProviderFeeNaira: {
            $sum: { $toDouble: { $ifNull: ['$providerFeeNaira', 0] } },
          },
          count: { $sum: 1 },
        },
      },
    ]),
    CreatorEarning.aggregate([
      {
        $group: {
          _id: { source: '$source', status: '$status' },
          grossNaira: { $sum: { $toDouble: { $ifNull: ['$grossNaira', 0] } } },
          creatorAmountNaira: {
            $sum: { $toDouble: { $ifNull: ['$creatorAmountNaira', 0] } },
          },
          platformAmountNaira: {
            $sum: { $toDouble: { $ifNull: ['$platformAmountNaira', 0] } },
          },
          count: { $sum: 1 },
        },
      },
    ]),
    AdRewardSession.countDocuments({
      provider: 'ROBINADS',
      purpose: 'DIRECT_EPISODE_UNLOCK',
      status: { $in: ['COMPLETED', 'CONSUMED'] },
    }),
    AdRewardSession.countDocuments({
      provider: 'ROBINADS',
      purpose: 'PROMO_REWARD',
      status: { $in: ['COMPLETED', 'CONSUMED'] },
    }),
    AdRevenueBatch.aggregate([
      {
        $group: {
          _id: null,
          reconciledRevenueNaira: {
            $sum: { $toDouble: { $ifNull: ['$providerNetRevenueNaira', 0] } },
          },
          allocatedCreatorNaira: {
            $sum: { $toDouble: { $ifNull: ['$creatorShareNaira', 0] } },
          },
          allocatedPlatformNaira: {
            $sum: { $toDouble: { $ifNull: ['$platformShareNaira', 0] } },
          },
        },
      },
    ]),
    AdRevenueBatch.find().sort({ createdAt: -1 }).limit(10).lean(),
  ]);

  const w = walletTotalsAgg[0] || {};
  const lotMap = Object.fromEntries(lotTotalsAgg.map((row) => [row._id, row]));

  let grossPurchasedCoinSalesNaira = 0;
  let purchasedCoinsSold = 0;
  let purchasedCoinsSpent = 0;
  let promotionalCoinsIssued = 0;
  let promotionalCoinsSpent = 0;
  let vipCreditsSold = 0;
  let vipCreditsSpent = 0;
  let paystackProcessingExpensesNaira = 0;

  for (const row of txTotalsAgg) {
    const type = row._id?.type;
    const source = row._id?.source;
    if (type === 'COIN_PURCHASE' && source === 'PURCHASED') {
      grossPurchasedCoinSalesNaira += toNum(row.totalGrossNaira);
      purchasedCoinsSold += toNum(row.totalAmount);
      paystackProcessingExpensesNaira += toNum(row.totalProviderFeeNaira);
    } else if (type === 'PROMO_REWARD' && source === 'PROMOTIONAL') {
      promotionalCoinsIssued += toNum(row.totalAmount);
    } else if (type === 'VIP_PURCHASE') {
      vipCreditsSold += toNum(row.totalAmount);
    } else if (type === 'EPISODE_UNLOCK') {
      if (source === 'PURCHASED') purchasedCoinsSpent += toNum(row.totalAmount);
      if (source === 'PROMOTIONAL') promotionalCoinsSpent += toNum(row.totalAmount);
      if (source === 'VIP_CREDIT') vipCreditsSpent += toNum(row.totalAmount);
    }
  }

  // Fallback to CoinLot totals if historical transactions were migrated into lots
  if (lotMap.PURCHASED) {
    purchasedCoinsSold = Math.max(purchasedCoinsSold, toNum(lotMap.PURCHASED.initialCoins));
    grossPurchasedCoinSalesNaira = Math.max(
      grossPurchasedCoinSalesNaira,
      toNum(lotMap.PURCHASED.cashValueNaira)
    );
    paystackProcessingExpensesNaira = Math.max(
      paystackProcessingExpensesNaira,
      toNum(lotMap.PURCHASED.providerFeeNaira)
    );
  }
  if (lotMap.PROMOTIONAL) {
    promotionalCoinsIssued = Math.max(promotionalCoinsIssued, toNum(lotMap.PROMOTIONAL.initialCoins));
  }

  const creatorEarningsBySource = {
    PURCHASED: 0,
    DIRECT_AD: 0,
    PROMO_AD: 0,
    VIP_CREDIT: 0,
  };
  let recognizedCreatorNaira = 0;
  let recognizedPlatformGrossNaira = 0;

  for (const row of creatorEarningAgg) {
    const src = row._id?.source;
    const creatorAmt = toNum(row.creatorAmountNaira);
    const platformAmt = toNum(row.platformAmountNaira);
    if (src && Object.prototype.hasOwnProperty.call(creatorEarningsBySource, src)) {
      creatorEarningsBySource[src] += creatorAmt;
    }
    recognizedCreatorNaira += creatorAmt;
    recognizedPlatformGrossNaira += platformAmt;
  }

  const adBatchTotals = adBatchAgg[0] || {};
  const actualReconciledAdRevenueNaira = toNum(adBatchTotals.reconciledRevenueNaira);

  // AFRISTORY gross 60% allocation from recognized episode unlocks + reconciled ad batches,
  // with Paystack processing fees absorbed strictly by AFRISTORY's share (never creator's 40%)
  const afristoryGrossAllocationNaira = recognizedPlatformGrossNaira;
  const afristoryNetAfterExpensesNaira =
    afristoryGrossAllocationNaira - paystackProcessingExpensesNaira;

  return {
    grossPurchasedCoinSalesNaira: formatDecimal(grossPurchasedCoinSalesNaira),
    purchasedCoinsSold: formatDecimal(purchasedCoinsSold),
    purchasedCoinsOutstanding: formatDecimal(w.purchasedCoinsOutstanding || 0),
    purchasedCoinsSpent: formatDecimal(purchasedCoinsSpent),
    promotionalCoinsIssued: formatDecimal(promotionalCoinsIssued),
    promotionalCoinsSpent: formatDecimal(promotionalCoinsSpent),
    promotionalCoinsOutstanding: formatDecimal(w.promotionalCoinsOutstanding || 0),
    legacyRestrictedCoinsOutstanding: formatDecimal(w.legacyRestrictedCoinsOutstanding || 0),
    vipCreditsSold: formatDecimal(vipCreditsSold),
    vipCreditsOutstanding: formatDecimal(w.vipCreditsOutstanding || 0),
    vipCreditsSpent: formatDecimal(vipCreditsSpent),
    directEpisodeAdCompletions,
    promotionalAdCompletions,
    actualReconciledAdRevenueNaira: formatDecimal(actualReconciledAdRevenueNaira),
    creatorEarningsBySource: {
      PURCHASED: formatDecimal(creatorEarningsBySource.PURCHASED),
      DIRECT_AD: formatDecimal(creatorEarningsBySource.DIRECT_AD),
      PROMO_AD: formatDecimal(creatorEarningsBySource.PROMO_AD),
      VIP_CREDIT: formatDecimal(creatorEarningsBySource.VIP_CREDIT),
    },
    totalCreatorEarningsAllocatedNaira: formatDecimal(recognizedCreatorNaira),
    paystackProcessingExpensesNaira: formatDecimal(paystackProcessingExpensesNaira),
    afristoryGrossAllocationNaira: formatDecimal(afristoryGrossAllocationNaira),
    afristoryNetAfterExpensesNaira: formatDecimal(afristoryNetAfterExpensesNaira),
    pendingCreatorEarningsNaira: formatDecimal(w.pendingCreatorEarnings || 0),
    withdrawableCreatorEarningsNaira: formatDecimal(w.availableCreatorEarnings || 0),
    withdrawnCreatorEarningsNaira: formatDecimal(w.withdrawnCreatorEarnings || 0),
    recentReconciliationBatches: recentBatches.map((batch) => ({
      ...batch,
      providerNetRevenueNaira: formatDecimal(batch.providerNetRevenueNaira || 0),
      creatorShareNaira: formatDecimal(batch.creatorShareNaira || 0),
      platformShareNaira: formatDecimal(batch.platformShareNaira || 0),
    })),
  };
}

// =========================================================================
// DYNAMIC BANNER SCHEMA (For the index.html Image/Video Slideshow)
// =========================================================================
const bannerSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  mediaUrl: { type: String, required: true },
  mediaType: { type: String, enum: ['IMAGE', 'VIDEO'], required: true },
  targetUrl: { type: String },
  buttonText: { type: String },
  badgeText: { type: String },
  category: { type: String, enum: ['PROMO_IMAGE', 'PROMO_VIDEO', 'TRENDING'], required: true },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});
const Banner = mongoose.models.Banner || mongoose.model('Banner', bannerSchema);

export default async function adminRoutes(fastify) {
  // =========================================================================
  // 1. DASHBOARD ANALYTICS, ACCOUNTING & FINANCIAL CONFIG
  // =========================================================================

  fastify.get('/dashboard/stats', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const [
        totalUsers,
        totalCreators,
        pendingCreators,
        totalSeries,
        totalEpisodes,
        pendingReports,
        pendingPayouts,
        accounting,
      ] = await Promise.all([
        User.countDocuments(),
        Creator.countDocuments({ isVerified: true }),
        Creator.countDocuments({ isVerified: false, applicationStatus: { $ne: 'REJECTED' } }),
        Series.countDocuments(),
        Episode.countDocuments(),
        Report.countDocuments({ status: 'PENDING' }),
        Transaction.countDocuments({ type: 'PAYOUT', status: 'PENDING' }),
        computeAdminAccountingSummary(),
      ]);

      return sendSuccess(reply, {
        totalUsers,
        totalCreators,
        pendingCreators,
        totalSeries,
        totalEpisodes,
        pendingReports,
        pendingPayouts,
        totalVolume: accounting.grossPurchasedCoinSalesNaira,
        accounting,
      });
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to fetch dashboard stats', 500, error.message);
    }
  });

  // Dedicated 17-metric Financial & Reconciliation Accounting endpoint
  fastify.get('/accounting', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;
      const accounting = await computeAdminAccountingSummary();
      return sendSuccess(reply, accounting);
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to fetch accounting report', 500, error.message);
    }
  });

  fastify.get('/analytics', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { startDate, endDate } = request.query;
      let dateFilter = { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };

      if (startDate && endDate) {
        dateFilter = {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        };
      }

      const [newUsers, newSeries, newEpisodes, newTransactions] = await Promise.all([
        User.countDocuments({ createdAt: dateFilter }),
        Series.countDocuments({ createdAt: dateFilter }),
        Episode.countDocuments({ createdAt: dateFilter }),
        Transaction.countDocuments({ createdAt: dateFilter, status: 'SUCCESS' }),
      ]);

      return sendSuccess(reply, {
        period: {
          start: startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          end: endDate || new Date().toISOString(),
        },
        newUsers,
        newSeries,
        newEpisodes,
        newTransactions,
      });
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to fetch analytics', 500, error.message);
    }
  });

  // Robins Ads telemetry & verification stats
  fastify.get('/ads/stats', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const [
        totalSessions,
        verifiedSessions,
        consumedSessions,
        expiredSessions,
        directEpisodeCompletions,
        promoRewardCompletions,
        sessions24h,
        robinsUnlocks,
        recentSessions,
      ] = await Promise.all([
        AdRewardSession.countDocuments({ provider: 'ROBINADS' }),
        AdRewardSession.countDocuments({
          provider: 'ROBINADS',
          status: { $in: ['COMPLETED', 'CONSUMED'] },
        }),
        AdRewardSession.countDocuments({ provider: 'ROBINADS', status: 'CONSUMED' }),
        AdRewardSession.countDocuments({ provider: 'ROBINADS', status: 'EXPIRED' }),
        AdRewardSession.countDocuments({
          provider: 'ROBINADS',
          purpose: 'DIRECT_EPISODE_UNLOCK',
          status: { $in: ['COMPLETED', 'CONSUMED'] },
        }),
        AdRewardSession.countDocuments({
          provider: 'ROBINADS',
          purpose: 'PROMO_REWARD',
          status: { $in: ['COMPLETED', 'CONSUMED'] },
        }),
        AdRewardSession.countDocuments({ provider: 'ROBINADS', createdAt: { $gte: last24h } }),
        Unlock.countDocuments({
          method: { $in: ['AD', 'DIRECT_AD'] },
          provider: 'ROBINADS',
          isActive: true,
        }),
        AdRewardSession.find({ provider: 'ROBINADS' })
          .populate('userId', 'username email')
          .sort({ createdAt: -1 })
          .limit(20),
      ]);

      return sendSuccess(reply, {
        provider: 'ROBINADS',
        totalSessions,
        verifiedSessions,
        consumedSessions,
        expiredSessions,
        directEpisodeCompletions,
        promoRewardCompletions,
        sessions24h,
        robinsUnlocks,
        recentSessions,
      });
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to fetch Robins Ads stats', 500, error.message);
    }
  });

  fastify.get('/financial-config', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;
      const config = await getFinancialConfig();
      return sendSuccess(reply, config);
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to fetch financial configuration', 500, error.message);
    }
  });

  fastify.put('/financial-config', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;
      const { coinPackages, vipPackages, promoRewardAmount = 5 } = request.body || {};
      if (Number(promoRewardAmount) !== 5) {
        return sendError(reply, 'Promotional rewards must be exactly 5 coins.', 400);
      }

      const expectedCoinKeys = Object.keys(DEFAULT_COIN_PACKAGES).sort();
      const expectedVipKeys = Object.keys(DEFAULT_VIP_PACKAGES).sort();
      if (
        !coinPackages ||
        JSON.stringify(Object.keys(coinPackages).sort()) !== JSON.stringify(expectedCoinKeys) ||
        !vipPackages ||
        JSON.stringify(Object.keys(vipPackages).sort()) !== JSON.stringify(expectedVipKeys)
      ) {
        return sendError(reply, 'All supported coin and VIP package definitions are required.', 400);
      }

      for (const [key, plan] of Object.entries(coinPackages)) {
        const coins = Number(plan?.coins);
        const naira = Number(plan?.naira);
        if (
          !Number.isSafeInteger(coins) ||
          coins <= 0 ||
          !Number.isFinite(naira) ||
          naira !== coins * 2 ||
          Number(plan?.promotionalCoins || 0) !== 0
        ) {
          return sendError(
            reply,
            `${key} must use ₦2 per coin and include no promotional coins.`,
            400
          );
        }
      }

      for (const [key, plan] of Object.entries(vipPackages)) {
        const price = Number(plan?.purchasedCoinPrice);
        const credits = Number(plan?.vipCreditsGranted);
        if (
          !Number.isSafeInteger(price) ||
          price < 0 ||
          !Number.isSafeInteger(credits) ||
          credits < 0 ||
          (plan?.active && (price === 0 || credits === 0))
        ) {
          return sendError(
            reply,
            `${key} must have valid whole-number coin and credit quantities.`,
            400
          );
        }
      }

      const config = await getFinancialConfig();
      config.coinPackages = coinPackages;
      config.vipPackages = vipPackages;
      config.promoRewardAmount = 5;
      config.updatedBy = request.user._id;
      await config.save();
      return sendSuccess(reply, config, 'Financial configuration updated');
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to update financial configuration', 400, error.message);
    }
  });

  fastify.post('/ad-revenue/reconcile', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;
      const { periodStart, periodEnd, providerNetRevenueNaira, reference } = request.body || {};
      const result = await reconcileAdRevenueBatch({
        periodStart,
        periodEnd,
        providerNetRevenueNaira,
        reconciledBy: request.user._id,
        reference,
      });
      return sendSuccess(
        reply,
        result,
        result.duplicate ? 'Ad revenue batch already reconciled' : 'Ad revenue batch reconciled'
      );
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, error.message || 'Failed to reconcile ad revenue', error.statusCode || 400);
    }
  });

  // =========================================================================
  // HOMEPAGE BANNERS & SLIDESHOWS
  // =========================================================================

  fastify.get('/banners', async (request, reply) => {
    try {
      const { type } = request.query;
      const query = { isActive: true };
      if (type) query.mediaType = type;

      const banners = await Banner.find(query).sort({ createdAt: -1 });
      return sendSuccess(reply, banners);
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to fetch banners', 500, error.message);
    }
  });

  fastify.post('/banners', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const newBanner = new Banner(request.body);
      await newBanner.save();

      return sendSuccess(reply, newBanner, 'Banner created successfully');
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to create banner', 500, error.message);
    }
  });

  fastify.delete('/banners/:id', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { id } = request.params;
      await Banner.findByIdAndDelete(id);

      return sendSuccess(reply, null, 'Banner deleted successfully');
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to delete banner', 500, error.message);
    }
  });

  // =========================================================================
  // 2. USER MANAGEMENT
  // =========================================================================

  fastify.get('/users', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { page = 1, limit = 10, role, search, status } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      const query = {};
      if (role) query.role = role;
      if (status === 'active') query.isActive = true;
      if (status === 'suspended') query.isActive = false;

      if (search) {
        query.$or = [
          { username: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
        ];
      }

      const [users, total] = await Promise.all([
        User.find(query)
          .select('-passwordHash -pinHash')
          .skip(skip)
          .limit(l)
          .sort({ createdAt: -1 }),
        User.countDocuments(query),
      ]);

      return sendSuccess(reply, {
        users,
        pagination: {
          page: p,
          limit: l,
          total,
          pages: Math.ceil(total / l),
        },
      });
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to fetch users', 500, error.message);
    }
  });

  fastify.get('/users/:userId', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { userId } = request.params;
      const user = await User.findById(userId).select('-passwordHash -pinHash');
      if (!user) return sendError(reply, 'User not found', 404);

      const [creatorProfile, wallet] = await Promise.all([
        Creator.findOne({ userId }),
        Wallet.findOne({ userId }),
      ]);

      return sendSuccess(reply, {
        user,
        creatorProfile: creatorProfile || null,
        wallet: wallet || null,
      });
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to fetch user details', 500, error.message);
    }
  });

  fastify.put('/users/:userId/suspend', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { userId } = request.params;
      const { reason } = request.body || {};

      const user = await User.findById(userId);
      if (!user) return sendError(reply, 'User not found', 404);

      user.isActive = false;
      await user.save();

      createNotification({
        userId: user._id,
        type: 'ACCOUNT_SUSPENDED',
        title: 'Account Suspended',
        message: reason || 'Your account has been suspended for violating terms of service.',
        targetUrl: '#support',
        dedupeKey: `user_suspend_${user._id}_${Date.now()}`,
      }).catch((err) => fastify.log.error('Notification error:', err));

      return sendSuccess(reply, null, 'User suspended successfully');
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to suspend user', 500, error.message);
    }
  });

  fastify.put('/users/:userId/unsuspend', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { userId } = request.params;
      const user = await User.findById(userId);
      if (!user) return sendError(reply, 'User not found', 404);

      user.isActive = true;
      await user.save();

      return sendSuccess(reply, null, 'User unsuspended successfully');
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to unsuspend user', 500, error.message);
    }
  });

  // =========================================================================
  // 3. CREATOR ONBOARDING & VERIFICATION
  // =========================================================================

  fastify.get('/creators', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { page = 1, limit = 10, verified } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      const query = {};
      if (verified !== undefined) {
        const isVer = verified === 'true';
        query.isVerified = isVer;
        if (!isVer) {
          query.applicationStatus = { $ne: 'REJECTED' };
        }
      }

      const [creators, total] = await Promise.all([
        Creator.find(query)
          .populate('userId', 'username email avatar')
          .skip(skip)
          .limit(l)
          .sort({ createdAt: -1 }),
        Creator.countDocuments(query),
      ]);

      return sendSuccess(reply, {
        creators,
        pagination: {
          page: p,
          limit: l,
          total,
          pages: Math.ceil(total / l),
        },
      });
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to fetch creators', 500, error.message);
    }
  });

  fastify.put('/creators/:creatorId/verify', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { creatorId } = request.params;
      const creator = await Creator.findById(creatorId);
      if (!creator) return sendError(reply, 'Creator not found', 404);

      creator.isVerified = true;
      creator.applicationStatus = 'APPROVED';
      creator.rejectionReason = null;
      await creator.save();

      const targetUser = await User.findById(creator.userId);
      if (targetUser && String(targetUser.role).toUpperCase() !== 'ADMIN') {
        targetUser.role = 'CREATOR';
        await targetUser.save();
      }

      createNotification({
        userId: creator.userId,
        type: 'CREATOR_VERIFIED',
        title: 'Creator Account Approved! 🌟',
        message: 'Your creator verification has been approved. You can now publish stories and monetize.',
        targetUrl: '#creator',
        dedupeKey: `creator_verify_${creator._id}_${Date.now()}`,
      }).catch((err) => fastify.log.error('Notification error:', err));

      return sendSuccess(reply, creator, 'Creator verified successfully');
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to verify creator', 500, error.message);
    }
  });

  fastify.put('/creators/:creatorId/reject', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { creatorId } = request.params;
      const { reason } = request.body || {};
      const rejectionMessage =
        reason || 'Your creator application requires changes or has been declined.';

      const creator = await Creator.findById(creatorId);
      if (!creator) return sendError(reply, 'Creator not found', 404);

      creator.isVerified = false;
      creator.applicationStatus = 'REJECTED';
      creator.rejectionReason = rejectionMessage;
      await creator.save();

      createNotification({
        userId: creator.userId,
        type: 'CREATOR_REJECTED',
        title: 'Creator Application Update',
        message: rejectionMessage,
        targetUrl: '#creator',
        dedupeKey: `creator_reject_${creator._id}_${Date.now()}`,
      }).catch((err) => fastify.log.error('Notification error:', err));

      return sendSuccess(reply, creator, 'Creator application rejected');
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to reject creator', 500, error.message);
    }
  });

  // =========================================================================
  // 4. CONTENT MODERATION (SERIES & EPISODES)
  // =========================================================================

  fastify.get('/series', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { page = 1, limit = 10, search, published } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      const query = {};
      if (published !== undefined) query.isPublished = published === 'true';
      if (search) query.title = { $regex: search, $options: 'i' };

      const [seriesList, total] = await Promise.all([
        Series.find(query)
          .populate('creatorId', 'name penName brandName')
          .skip(skip)
          .limit(l)
          .sort({ createdAt: -1 }),
        Series.countDocuments(query),
      ]);

      return sendSuccess(reply, {
        series: seriesList,
        pagination: {
          page: p,
          limit: l,
          total,
          pages: Math.ceil(total / l),
        },
      });
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to fetch series list', 500, error.message);
    }
  });

  fastify.put('/series/:seriesId/status', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { seriesId } = request.params;
      const { isPublished, isFlagged } = request.body || {};

      const series = await Series.findById(seriesId);
      if (!series) return sendError(reply, 'Series not found', 404);

      if (isPublished !== undefined) series.isPublished = isPublished;
      if (isFlagged !== undefined) series.isFlagged = isFlagged;
      await series.save();

      return sendSuccess(reply, series, 'Series status updated successfully');
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to update series status', 500, error.message);
    }
  });

  fastify.delete('/episodes/:episodeId', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { episodeId } = request.params;
      const episode = await Episode.findById(episodeId);
      if (!episode) return sendError(reply, 'Episode not found', 404);

      await Series.findByIdAndUpdate(episode.seriesId, {
        $inc: { totalEpisodes: -1 },
      });

      await Episode.findByIdAndDelete(episodeId);

      return sendSuccess(reply, null, 'Episode permanently deleted by administrator');
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to delete episode', 500, error.message);
    }
  });

  // =========================================================================
  // 5. REPORT & DISPUTE RESOLUTION
  // =========================================================================

  fastify.get('/reports', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { page = 1, limit = 10, status = 'PENDING' } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      const [reports, total] = await Promise.all([
        Report.find({ status })
          .populate('reportedBy', 'username email')
          .populate('resolvedBy', 'username')
          .skip(skip)
          .limit(l)
          .sort({ createdAt: -1 }),
        Report.countDocuments({ status }),
      ]);

      return sendSuccess(reply, {
        reports,
        pagination: {
          page: p,
          limit: l,
          total,
          pages: Math.ceil(total / l),
        },
      });
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to fetch reports', 500, error.message);
    }
  });

  fastify.put('/reports/:reportId/resolve', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { reportId } = request.params;
      const { status, adminNotes, actionTaken } = request.body || {};

      if (!status || !['RESOLVED', 'DISMISSED'].includes(status)) {
        return sendError(reply, 'Status must be either RESOLVED or DISMISSED', 400);
      }

      const report = await Report.findById(reportId);
      if (!report) return sendError(reply, 'Report not found', 404);

      if (actionTaken === 'suspend_user' && report.targetUser) {
        await User.findByIdAndUpdate(report.targetUser, { isActive: false });
      } else if (actionTaken === 'remove_content' && report.targetId && report.targetType) {
        if (report.targetType === 'SERIES') {
          await Series.findByIdAndUpdate(report.targetId, { isPublished: false, isFlagged: true });
        } else if (report.targetType === 'EPISODE') {
          await Episode.findByIdAndUpdate(report.targetId, { isPublished: false, isFlagged: true });
        }
      }

      report.status = status;
      report.adminNotes = adminNotes || '';
      report.actionTaken = actionTaken || 'none';
      report.resolvedBy = request.user._id;
      report.resolvedAt = new Date();
      await report.save();

      return sendSuccess(reply, report, 'Report resolved and sanctions applied successfully');
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to resolve report', 500, error.message);
    }
  });

  // =========================================================================
  // 6. ATOMIC CREATOR PAYOUT APPROVALS & REJECTIONS
  // =========================================================================

  fastify.get('/payouts', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { page = 1, limit = 10, status = 'PENDING' } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      const query = { type: 'PAYOUT', status };

      const [payouts, total] = await Promise.all([
        Transaction.find(query)
          .populate('userId', 'username email')
          .skip(skip)
          .limit(l)
          .sort({ createdAt: -1 }),
        Transaction.countDocuments(query),
      ]);

      return sendSuccess(reply, {
        payouts: payouts.map((item) => ({
          ...item.toObject(),
          amount: formatDecimal(item.amount),
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
      return sendError(reply, 'Failed to fetch payouts', 500, error.message);
    }
  });

  fastify.put('/payouts/:transactionId/approve', async (request, reply) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      if (!(await verifyAdmin(request, reply))) {
        await session.abortTransaction();
        return;
      }

      const { transactionId } = request.params;
      const { payoutReference, notes } = request.body || {};

      const tx = await Transaction.findOne({
        _id: transactionId,
        type: 'PAYOUT',
      }).session(session);

      if (!tx) {
        await session.abortTransaction();
        return sendError(reply, 'Withdrawal transaction not found', 404);
      }

      if (tx.status !== 'PENDING') {
        await session.abortTransaction();
        return sendError(reply, `Transaction is already ${tx.status}`, 400);
      }

      const payoutAmount = toNum(tx.amount);
      tx.status = 'SUCCESS';
      tx.adminNotes = notes || '';
      tx.payoutReference = payoutReference || 'MANUAL_DISBURSEMENT';
      tx.processedAt = new Date();
      await tx.save({ session });

      await Wallet.findOneAndUpdate(
        { userId: tx.userId },
        {
          $inc: {
            withdrawnCreatorEarnings: tx.amount,
            totalWithdrawn: tx.amount,
          },
        },
        { session }
      );

      // Mark corresponding AVAILABLE CreatorEarning records as WITHDRAWN
      const availableRecords = await CreatorEarning.find({
        userId: tx.userId,
        status: 'AVAILABLE',
      })
        .sort({ createdAt: 1 })
        .session(session);

      let remainingToMark = payoutAmount;
      for (const rec of availableRecords) {
        if (remainingToMark <= 0.001) break;
        const recAmount = toNum(rec.creatorAmountNaira);
        if (recAmount <= remainingToMark + 0.01) {
          rec.status = 'WITHDRAWN';
          rec.withdrawnAt = new Date();
          rec.payoutTransactionId = tx._id;
          await rec.save({ session });
          remainingToMark -= recAmount;
        }
      }

      await session.commitTransaction();

      createNotification({
        userId: tx.userId,
        type: 'PAYOUT_COMPLETED',
        title: 'Withdrawal Processed 💰',
        message: `Your withdrawal of ₦${formatDecimal(payoutAmount)} has been processed successfully.`,
        targetUrl: '#wallet',
        dedupeKey: `tx_payout_${tx._id}`,
      }).catch((err) => fastify.log.error('Notification error:', err));

      return sendSuccess(reply, tx, 'Payout approved successfully');
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      fastify.log.error(error);
      return sendError(reply, 'Failed to approve payout', 500, error.message);
    } finally {
      await session.endSession();
    }
  });

  fastify.put('/payouts/:transactionId/reject', async (request, reply) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      if (!(await verifyAdmin(request, reply))) {
        await session.abortTransaction();
        return;
      }

      const { transactionId } = request.params;
      const { reason } = request.body || {};

      const tx = await Transaction.findOne({
        _id: transactionId,
        type: 'PAYOUT',
      }).session(session);

      if (!tx) {
        await session.abortTransaction();
        return sendError(reply, 'Withdrawal transaction not found', 404);
      }

      if (tx.status !== 'PENDING') {
        await session.abortTransaction();
        return sendError(reply, `Transaction is already ${tx.status}`, 400);
      }

      tx.status = 'REJECTED';
      tx.adminNotes = reason || 'Declined by administration';
      tx.processedAt = new Date();
      await tx.save({ session });

      await Wallet.findOneAndUpdate(
        { userId: tx.userId },
        {
          $inc: {
            availableCreatorEarnings: tx.amount,
            lockedEarnings: tx.amount,
          },
        },
        { session }
      );

      await session.commitTransaction();

      createNotification({
        userId: tx.userId,
        type: 'PAYOUT_REJECTED',
        title: 'Withdrawal Request Declined',
        message: reason
          ? `Your withdrawal was rejected: ${reason}`
          : 'Your withdrawal could not be processed. Funds returned to available earnings.',
        targetUrl: '#wallet',
        dedupeKey: `tx_reject_${tx._id}`,
      }).catch((err) => fastify.log.error('Notification error:', err));

      return sendSuccess(reply, tx, 'Payout rejected and balance refunded to user wallet');
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      fastify.log.error(error);
      return sendError(reply, 'Failed to reject payout', 500, error.message);
    } finally {
      await session.endSession();
    }
  });

  // =========================================================================
  // 7. SYSTEM MONITORING & CLIENT ERROR LOGS
  // =========================================================================

  fastify.post('/log-client-error', async (request, reply) => {
    try {
      const { type, message, stack, url, time, userId } = request.body || {};

      fastify.log.warn({
        event: 'CLIENT_PERFORMANCE_LOG',
        userId: userId || 'unauthenticated',
        type: type || 'unknown',
        message: message || 'No message',
        stack: stack || 'No stack',
        url: url || 'Unknown URL',
        clientTime: time || new Date().toISOString(),
      });

      return sendSuccess(reply, { logged: true });
    } catch (error) {
      fastify.log.error('Failed to process client log', error);
      return reply.code(200).send({ success: true, data: { logged: false } });
    }
  });
}
