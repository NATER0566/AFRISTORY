import mongoose from 'mongoose';
import AdRewardBatch from '../models/AdRevenueBatch.js';
import AdRewardSession from '../models/AdRewardSession.js';
import CoinLot from '../models/CoinLot.js';
import Creator from '../models/Creator.js';
import CreatorEarning from '../models/CreatorEarning.js';
import Episode from '../models/Episode.js';
import FinancialConfig from '../models/FinancialConfig.js';
import Series from '../models/Series.js';
import Transaction from '../models/Transaction.js';
import Unlock from '../models/Unlock.js';
import Wallet from '../models/Wallet.js';
import { generateReference } from '../utils/helpers.js';

const VIP_PROMO_REJECTION =
  'You cannot use promotional coins to purchase VIP access. Please use purchased Story Coins to continue.';
const decimal = (value) => mongoose.Types.Decimal128.fromString(money(value).toFixed(2));
const numeric = (value) => Number(value?.toString?.() ?? value ?? 0);
const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const ledgerError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const zero = () => decimal(0);

async function inTransaction(work, existingSession = null) {
  if (existingSession) return work(existingSession);
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(
      async () => {
        result = await work(session);
      },
      {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
      }
    );
    return result;
  } finally {
    await session.endSession();
  }
}

async function getWallet(userId, session) {
  await Wallet.updateOne(
    { userId },
    { $setOnInsert: { userId } },
    { upsert: true, session }
  );
  return Wallet.findOne({ userId }).session(session);
}

function assertPositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw ledgerError(`${label} must be a positive whole number.`);
  }
  return number;
}

async function hasReference(reference, session) {
  if (!reference) throw ledgerError('A transaction reference is required.');
  return Transaction.findOne({ reference }).session(session);
}

async function consumeLots({ userId, sources, amount, session }) {
  let remaining = amount;
  let cashValueNaira = 0;
  const lotRefs = [];
  const sourceAdIds = [];
  const consumedBySource = new Map();
  const lots = await CoinLot.find({
    userId,
    source: { $in: sources },
    remainingCoins: { $gt: 0 },
  })
    .sort({ createdAt: 1, _id: 1 })
    .session(session);

  for (const lot of lots) {
    if (remaining === 0) break;
    const take = Math.min(remaining, lot.remainingCoins);
    const update = await CoinLot.updateOne(
      { _id: lot._id, remainingCoins: lot.remainingCoins },
      { $inc: { remainingCoins: -take } },
      { session }
    );
    if (update.modifiedCount !== 1) throw ledgerError('Coin lot changed concurrently. Retry the unlock.', 409);

    remaining -= take;
    lotRefs.push(lot._id);
    consumedBySource.set(lot.source, (consumedBySource.get(lot.source) || 0) + take);
    if (lot.source === 'PURCHASED') {
      cashValueNaira += (numeric(lot.cashValueNaira) / lot.initialCoins) * take;
    }
    sourceAdIds.push(...lot.rewardAdIds);
  }

  if (remaining > 0) throw ledgerError('Insufficient coins for this unlock.', 400);
  return {
    lotRefs,
    sourceAdIds: [...new Set(sourceAdIds)],
    consumedBySource,
    cashValueNaira: money(cashValueNaira),
  };
}

async function resolveCreator(episode, session) {
  const series = await Series.findById(episode.seriesId).session(session);
  if (!series) throw ledgerError('Series not found.', 404);
  const creator = await Creator.findById(series.creatorId).session(session);
  if (!creator) throw ledgerError('Creator not found.', 404);
  return { creator, creatorId: creator._id };
}

async function createCreatorEarning({
  creator,
  creatorId,
  episode,
  unlock,
  source,
  grossNaira,
  sourceAdIds = [],
  batchId = null,
  session,
}) {
  const roundedGross = money(grossNaira);
  const creatorAmount = money(roundedGross * 0.4);
  const platformAmount = money(roundedGross - creatorAmount);
  const pending =
    source === 'DIRECT_AD' || (source === 'PROMO_AD' && sourceAdIds.length > 0);
  const creatorWallet = await getWallet(creator.userId, session);
  const earning = await CreatorEarning.create(
    [
      {
        creatorId,
        userId: creator.userId,
        source,
        status: pending ? 'PENDING' : 'AVAILABLE',
        grossNaira: decimal(roundedGross),
        creatorAmountNaira: decimal(creatorAmount),
        platformAmountNaira: decimal(platformAmount),
        episodeId: episode._id,
        unlockId: unlock._id,
        sourceAdIds,
        reconciliationBatchId: batchId,
        reference: generateReference('EARN'),
      },
    ],
    { session }
  );

  const field = pending ? 'pendingCreatorEarnings' : 'availableCreatorEarnings';
  creatorWallet[field] = decimal(numeric(creatorWallet[field]) + creatorAmount);
  creatorWallet.totalEarned = decimal(numeric(creatorWallet.totalEarned) + creatorAmount);
  await creatorWallet.save({ session });
  return earning[0];
}

async function reconcileEarningForAds(earning, session, batchId) {
  const adSessions = await AdRewardSession.find({
    rewardId: { $in: earning.sourceAdIds },
    reconciledRevenueNaira: { $ne: null },
  }).session(session);
  if (adSessions.length !== earning.sourceAdIds.length) return false;

  const gross = money(adSessions.reduce((sum, item) => sum + numeric(item.reconciledRevenueNaira), 0));
  const creatorAmount = money(gross * 0.4);
  const platformAmount = money(gross - creatorAmount);
  const changed = await CreatorEarning.findOneAndUpdate(
    { _id: earning._id, status: 'PENDING' },
    {
      $set: {
        status: 'AVAILABLE',
        grossNaira: decimal(gross),
        creatorAmountNaira: decimal(creatorAmount),
        platformAmountNaira: decimal(platformAmount),
        reconciliationBatchId: batchId,
      },
    },
    { new: true, session }
  );
  if (!changed) return false;

  const wallet = await getWallet(earning.userId, session);
  wallet.pendingCreatorEarnings = decimal(
    Math.max(0, numeric(wallet.pendingCreatorEarnings) - numeric(earning.creatorAmountNaira))
  );
  wallet.availableCreatorEarnings = decimal(numeric(wallet.availableCreatorEarnings) + creatorAmount);
  await wallet.save({ session });

  await Transaction.updateOne(
    {
      type: 'EPISODE_UNLOCK',
      episodeId: earning.episodeId,
      creatorId: earning.creatorId,
      sourceAdIds: { $all: earning.sourceAdIds },
      status: 'SUCCESS',
    },
    {
      $set: {
        grossNaira: decimal(gross),
        creatorShareNaira: decimal(creatorAmount),
        platformShareNaira: decimal(platformAmount),
      },
    },
    { session }
  );
  return true;
}

export async function creditPurchasedCoins({
  userId,
  coins: rawCoins,
  reference,
  grossNaira,
  providerFeeNaira = 0,
  paystackTransactionId = null,
  metadata = {},
  session: existingSession = null,
}) {
  const coins = assertPositiveInteger(rawCoins, 'Coin amount');
  const gross = money(grossNaira);
  const fee = money(providerFeeNaira);
  if (!Number.isFinite(gross) || gross <= 0 || !Number.isFinite(fee) || fee < 0) {
    throw ledgerError('Valid payment and provider fee amounts are required.');
  }

  return inTransaction(async (session) => {
    const existing = await hasReference(reference, session);
    if (existing?.status === 'SUCCESS') return { duplicate: true, transaction: existing };
    if (existing && (existing.type !== 'COIN_PURCHASE' || existing.userId.toString() !== userId.toString())) {
      throw ledgerError('Transaction reference is already in use.', 409);
    }

    const wallet = await getWallet(userId, session);
    const lot = await CoinLot.create(
      [
        {
          userId,
          source: 'PURCHASED',
          initialCoins: coins,
          remainingCoins: coins,
          cashValueNaira: decimal(gross),
          providerFeeNaira: decimal(fee),
          reference: `LOT-${reference}`,
          metadata: {
            paystackTransactionId,
            historicalPricing: gross !== coins * 2,
          },
        },
      ],
      { session }
    );
    wallet.purchasedCoins = decimal(numeric(wallet.purchasedCoins) + coins);
    await wallet.save({ session });

    let transaction;
    if (existing) {
      existing.status = 'SUCCESS';
      existing.source = 'PURCHASED';
      existing.provider = 'PAYSTACK';
      existing.amount = decimal(coins);
      existing.grossNaira = decimal(gross);
      existing.providerFeeNaira = decimal(fee);
      existing.lotRefs = [lot[0]._id];
      existing.metadata = { ...(existing.metadata || {}), ...metadata, paystackTransactionId };
      transaction = await existing.save({ session });
    } else {
      [transaction] = await Transaction.create(
        [
          {
            walletId: wallet._id,
            userId,
            type: 'COIN_PURCHASE',
            source: 'PURCHASED',
            provider: 'PAYSTACK',
            amount: decimal(coins),
            reference,
            status: 'SUCCESS',
            grossNaira: decimal(gross),
            providerFeeNaira: decimal(fee),
            metadata: { ...metadata, paystackTransactionId, expenseOwner: 'AFRISTORY' },
          },
        ],
        { session }
      );
    }
    return { duplicate: false, wallet, lot: lot[0], transaction };
  }, existingSession);
}

export async function creditPromotionalCoins({
  userId,
  reference,
  rewardAdId = null,
  rewardTargetId = null,
  verified = false,
  metadata = {},
  session: existingSession = null,
}) {
  if (!reference || (!rewardAdId && !verified)) {
    throw ledgerError('A verified reward reference is required.');
  }

  return inTransaction(async (session) => {
    const existing = await hasReference(reference, session);
    if (existing) throw ledgerError('Reward reference has already been used.', 409);

    let adSession = null;
    if (rewardAdId) {
      adSession = await AdRewardSession.findOne({
        rewardId: rewardAdId,
        userId,
        purpose: 'PROMO_REWARD',
        ...(rewardTargetId ? { targetId: String(rewardTargetId) } : {}),
        status: { $in: ['COMPLETED', 'CONSUMED'] },
      }).session(session);
      if (
        !adSession ||
        (adSession.status !== 'CONSUMED' && adSession.expiresAt && adSession.expiresAt <= new Date())
      ) {
        throw ledgerError('Reward ad reference is unverified, expired, or already used.', 409);
      }
      if (adSession.status === 'COMPLETED') {
        const consumed = await AdRewardSession.updateOne(
          { _id: adSession._id, status: 'COMPLETED' },
          { $set: { status: 'CONSUMED', consumedAt: new Date() } },
          { session }
        );
        if (consumed.modifiedCount !== 1) throw ledgerError('Reward ad reference has already been used.', 409);
      } else if (await CoinLot.exists({ rewardAdIds: rewardAdId }).session(session)) {
        throw ledgerError('Reward ad reference has already been used.', 409);
      }
    }

    const wallet = await getWallet(userId, session);
    const amount = 5;
    const lot = await CoinLot.create(
      [
        {
          userId,
          source: 'PROMOTIONAL',
          initialCoins: amount,
          remainingCoins: amount,
          cashValueNaira: zero(),
          rewardAdIds: rewardAdId ? [rewardAdId] : [],
          reference: `LOT-${reference}`,
          metadata,
        },
      ],
      { session }
    );
    wallet.promotionalCoins = decimal(numeric(wallet.promotionalCoins) + amount);
    await wallet.save({ session });
    const [transaction] = await Transaction.create(
      [
        {
          walletId: wallet._id,
          userId,
          type: 'PROMO_REWARD',
          source: 'PROMOTIONAL',
          amount: decimal(amount),
          reference,
          status: 'SUCCESS',
          sourceAdIds: rewardAdId ? [rewardAdId] : [],
          metadata: { ...metadata, verifiedAt: adSession?.verifiedAt || new Date() },
        },
      ],
      { session }
    );
    return { wallet, lot: lot[0], transaction, amount };
  }, existingSession);
}

export async function purchaseVipPackage({
  userId,
  packageKey,
  reference = generateReference('VIP'),
  session: existingSession = null,
}) {
  return inTransaction(async (session) => {
    const config = await FinancialConfig.findOne({ key: 'default' }).session(session);
    const plan = config?.vipPackages?.[packageKey];
    if (!plan?.active || plan.purchasedCoinPrice <= 0 || plan.vipCreditsGranted <= 0) {
      throw ledgerError('VIP package is unavailable.', 404);
    }
    const prior = await hasReference(reference, session);
    if (prior) {
      if (prior.status === 'SUCCESS') {
        return {
          duplicate: true,
          transaction: prior,
          vipCreditsGranted: Number(prior.metadata?.vipCreditsGranted || 0),
        };
      }
      throw ledgerError('VIP purchase reference has already been used.', 409);
    }

    const wallet = await getWallet(userId, session);
    const price = assertPositiveInteger(plan.purchasedCoinPrice, 'VIP package price');
    if (numeric(wallet.purchasedCoins) < price) throw ledgerError(VIP_PROMO_REJECTION, 400);
    const allocation = await consumeLots({
      userId,
      sources: ['PURCHASED'],
      amount: price,
      session,
    });
    if (allocation.consumedBySource.get('PURCHASED') !== price) {
      throw ledgerError('Purchased coin ledger is inconsistent. Contact support.', 409);
    }

    const creditCount = assertPositiveInteger(plan.vipCreditsGranted, 'VIP credit amount');
    const valueNaira = allocation.cashValueNaira || price * 2;
    wallet.purchasedCoins = decimal(numeric(wallet.purchasedCoins) - price);
    wallet.vipCredits = decimal(numeric(wallet.vipCredits) + creditCount);
    wallet.vipCreditValueNaira = decimal(numeric(wallet.vipCreditValueNaira) + valueNaira);
    wallet.totalSpent = decimal(numeric(wallet.totalSpent) + price);
    await wallet.save({ session });

    const [transaction] = await Transaction.create(
      [
        {
          walletId: wallet._id,
          userId,
          type: 'VIP_PURCHASE',
          source: 'PURCHASED',
          amount: decimal(price),
          reference,
          status: 'SUCCESS',
          lotRefs: allocation.lotRefs,
          grossNaira: decimal(valueNaira),
          metadata: { packageKey, vipCreditsGranted: creditCount, effectiveValuePerCredit: valueNaira / creditCount },
        },
      ],
      { session }
    );
    return { wallet, transaction, vipCreditsGranted: creditCount };
  }, existingSession);
}

export async function unlockEpisode({
  userId,
  episodeId,
  method,
  rewardId = null,
  reference = generateReference('UNLOCK'),
  session: existingSession = null,
}) {
  const normalizedMethod = String(method || '').toUpperCase();
  const sourceForMethod = {
    PURCHASED: 'PURCHASED',
    PROMOTIONAL: 'PROMOTIONAL',
    VIP_CREDIT: 'VIP_CREDIT',
    DIRECT_AD: 'DIRECT_AD',
  };
  if (!sourceForMethod[normalizedMethod]) throw ledgerError('A valid unlock method is required.');

  return inTransaction(async (session) => {
    const already = await Unlock.findOne({ userId, episodeId, isActive: true }).session(session);
    if (already) return { replay: true, unlock: already };

    const episode = await Episode.findById(episodeId).session(session);
    if (!episode) throw ledgerError('Episode not found.', 404);
    if (episode.isFree) throw ledgerError('Episode is already free.', 400);
    const series = await Series.findById(episode.seriesId).session(session);
    if (!series) throw ledgerError('Series not found.', 404);
    const { creator, creatorId } = await resolveCreator(episode, session);
    const wallet = await getWallet(userId, session);
    const cost = assertPositiveInteger(episode.coinCost, 'Episode coin cost');
    const existingTransaction = await hasReference(reference, session);
    if (existingTransaction) throw ledgerError('Unlock reference has already been used.', 409);

    let lotRefs = [];
    let sourceAdIds = [];
    let grossNaira = 0;
    let source = sourceForMethod[normalizedMethod];
    let adSession = null;

    if (normalizedMethod === 'DIRECT_AD') {
      if (episode.adUnlockable === false) throw ledgerError('This episode is not available for ad unlock.', 403);
      if (!rewardId) throw ledgerError('A verified episode unlock ad is required.');
      adSession = await AdRewardSession.findOne({
        rewardId,
        userId,
        purpose: 'DIRECT_EPISODE_UNLOCK',
        targetId: String(episode._id),
        creatorId,
        status: { $in: ['COMPLETED', 'CONSUMED'] },
        expiresAt: { $gt: new Date() },
      }).session(session);
      if (!adSession) {
        throw ledgerError('Ad session is unverified, expired, or already used.', 409);
      }
      if (adSession.status === 'COMPLETED') {
        const consumed = await AdRewardSession.updateOne(
          { _id: adSession._id, status: 'COMPLETED' },
          { $set: { status: 'CONSUMED', consumedAt: new Date() } },
          { session }
        );
        if (consumed.modifiedCount !== 1) throw ledgerError('Ad session has already been used.', 409);
      }
      sourceAdIds = [rewardId];
    } else if (normalizedMethod === 'VIP_CREDIT') {
      if (numeric(wallet.vipCredits) < cost) throw ledgerError('Insufficient VIP Unlock Credits.', 400);
      const creditsBefore = numeric(wallet.vipCredits);
      grossNaira = money((numeric(wallet.vipCreditValueNaira) / creditsBefore) * cost);
      wallet.vipCredits = decimal(creditsBefore - cost);
      wallet.vipCreditValueNaira = decimal(Math.max(0, numeric(wallet.vipCreditValueNaira) - grossNaira));
      wallet.totalSpent = decimal(numeric(wallet.totalSpent) + cost);
      await wallet.save({ session });
    } else {
      const eligibleSources =
        normalizedMethod === 'PURCHASED'
          ? ['PURCHASED']
          : ['PROMOTIONAL', 'LEGACY_RESTRICTED'];
      const available =
        normalizedMethod === 'PURCHASED'
          ? numeric(wallet.purchasedCoins)
          : numeric(wallet.promotionalCoins) + numeric(wallet.legacyRestrictedCoins);
      if (available < cost) throw ledgerError('Insufficient coins for this unlock.', 400);
      const allocation = await consumeLots({ userId, sources: eligibleSources, amount: cost, session });
      lotRefs = allocation.lotRefs;
      sourceAdIds = allocation.sourceAdIds;
      grossNaira = normalizedMethod === 'PURCHASED' ? allocation.cashValueNaira : 0;
      if (normalizedMethod === 'PURCHASED') {
        wallet.purchasedCoins = decimal(numeric(wallet.purchasedCoins) - cost);
      } else {
        wallet.promotionalCoins = decimal(
          numeric(wallet.promotionalCoins) - (allocation.consumedBySource.get('PROMOTIONAL') || 0)
        );
        wallet.legacyRestrictedCoins = decimal(
          numeric(wallet.legacyRestrictedCoins) - (allocation.consumedBySource.get('LEGACY_RESTRICTED') || 0)
        );
      }
      wallet.totalSpent = decimal(numeric(wallet.totalSpent) + cost);
      await wallet.save({ session });
    }

    const unlockMethod = normalizedMethod;
    const [unlock] = await Unlock.create(
      [
        {
          userId,
          episodeId: episode._id,
          seriesId: episode.seriesId,
          method: unlockMethod,
          source,
          creatorId,
          provider: normalizedMethod === 'DIRECT_AD' ? 'ROBINADS' : null,
          transactionId: rewardId,
          lotRefs,
          sourceAdIds,
        },
      ],
      { session }
    );
    episode.totalUnlocks = (episode.totalUnlocks || 0) + 1;
    if (normalizedMethod === 'DIRECT_AD') episode.totalAdUnlocks = (episode.totalAdUnlocks || 0) + 1;
    await episode.save({ session });

    const transactionType = 'EPISODE_UNLOCK';
    const status = normalizedMethod === 'DIRECT_AD' || normalizedMethod === 'PROMOTIONAL' ? 'PENDING' : 'SUCCESS';
    const earningSource = {
      PURCHASED: 'PURCHASED_COIN',
      PROMOTIONAL: 'PROMO_AD',
      VIP_CREDIT: 'VIP_CREDIT',
      DIRECT_AD: 'DIRECT_AD',
    }[normalizedMethod];
    const [transaction] = await Transaction.create(
      [
        {
          walletId: wallet._id,
          userId,
          type: transactionType,
          source,
          amount: decimal(normalizedMethod === 'DIRECT_AD' ? 0 : cost),
          reference,
          status: 'SUCCESS',
          episodeId: episode._id,
          creatorId,
          lotRefs,
          sourceAdIds,
          grossNaira: decimal(grossNaira),
          creatorShareNaira: decimal(grossNaira * 0.4),
          platformShareNaira: decimal(grossNaira - grossNaira * 0.4),
          metadata: { unlockId: unlock._id, method: normalizedMethod },
        },
      ],
      { session }
    );

    const reconciledAds = sourceAdIds.length
      ? await AdRewardSession.find({
          rewardId: { $in: sourceAdIds },
          reconciledRevenueNaira: { $ne: null },
        }).session(session)
      : [];
    const allAdsReconciled = sourceAdIds.length > 0 && reconciledAds.length === sourceAdIds.length;
    if (normalizedMethod === 'PURCHASED' || normalizedMethod === 'VIP_CREDIT') {
      await createCreatorEarning({
        creator,
        creatorId,
        episode,
        unlock,
        source: earningSource,
        grossNaira,
        session,
      });
    } else {
      const actualAdGross = allAdsReconciled
        ? money(reconciledAds.reduce((sum, item) => sum + numeric(item.reconciledRevenueNaira), 0))
        : 0;
      const earning = await createCreatorEarning({
        creator,
        creatorId,
        episode,
        unlock,
        source: earningSource,
        grossNaira: actualAdGross,
        sourceAdIds,
        batchId: allAdsReconciled ? reconciledAds[0].revenueBatchId : null,
        session,
      });
      if (allAdsReconciled && earning.status === 'PENDING') {
        await reconcileEarningForAds(earning, session, reconciledAds[0].revenueBatchId);
      }
    }

    return { replay: false, unlock, transaction, episode, creatorId, sourceAdIds };
  }, existingSession);
}

export async function reconcileAdRevenueBatch({
  periodStart,
  periodEnd,
  providerNetRevenueNaira,
  reconciledBy,
  reference = generateReference('ADREV'),
  session: existingSession = null,
}) {
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  const revenue = money(providerNetRevenueNaira);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
    throw ledgerError('A valid reconciliation period is required.');
  }
  if (!Number.isFinite(revenue) || revenue < 0) throw ledgerError('Net ad revenue must be non-negative.');

  return inTransaction(async (session) => {
    const existingBatch = await AdRewardBatch.findOne({ reference }).session(session);
    if (existingBatch) return { duplicate: true, batch: existingBatch };

    const completions = await AdRewardSession.find({
      provider: 'ROBINADS',
      purpose: { $in: ['DIRECT_EPISODE_UNLOCK', 'PROMO_REWARD'] },
      status: 'CONSUMED',
      verifiedAt: { $gte: start, $lt: end },
      reconciledRevenueNaira: null,
    })
      .sort({ verifiedAt: 1, rewardId: 1 })
      .session(session);
    if (!completions.length) throw ledgerError('No eligible unreconciled Robins Ads completions in this period.');

    const totalCents = Math.round(revenue * 100);
    const baseCents = Math.floor(totalCents / completions.length);
    let remainderCents = totalCents - baseCents * completions.length;
    const revenueByRewardId = new Map();
    const batchCompletions = completions.map((item) => {
      const cents = baseCents + (remainderCents-- > 0 ? 1 : 0);
      const allocated = cents / 100;
      revenueByRewardId.set(item.rewardId, allocated);
      return {
        rewardId: item.rewardId,
        purpose: item.purpose,
        userId: item.userId,
        targetId: item.targetId,
        netRevenueNaira: decimal(allocated),
      };
    });
    const [batch] = await AdRevenueBatch.create(
      [
        {
          reference,
          periodStart: start,
          periodEnd: end,
          providerNetRevenueNaira: decimal(revenue),
          perCompletionRevenueNaira: decimal(revenue / completions.length),
          eligibleCompletionCount: completions.length,
          completions: batchCompletions,
          reconciledBy,
        },
      ],
      { session }
    );

    for (const adSession of completions) {
      const updated = await AdRewardSession.updateOne(
        { _id: adSession._id, reconciledRevenueNaira: null },
        {
          $set: {
            reconciledRevenueNaira: decimal(revenueByRewardId.get(adSession.rewardId)),
            revenueBatchId: batch._id,
          },
        },
        { session }
      );
      if (updated.modifiedCount !== 1) throw ledgerError('An ad completion was reconciled concurrently.', 409);
    }

    const pendingEarnings = await CreatorEarning.find({
      status: 'PENDING',
      sourceAdIds: { $in: [...revenueByRewardId.keys()] },
    }).session(session);
    let promotedCount = 0;
    for (const earning of pendingEarnings) {
      if (await reconcileEarningForAds(earning, session, batch._id)) promotedCount += 1;
    }
    return { duplicate: false, batch, promotedCount };
  }, existingSession);
}

export { VIP_PROMO_REJECTION };
