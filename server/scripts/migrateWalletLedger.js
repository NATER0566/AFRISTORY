import mongoose from 'mongoose';
import CoinLot from '../models/CoinLot.js';
import Subscription from '../models/Subscription.js';
import Transaction from '../models/Transaction.js';
import Wallet from '../models/Wallet.js';

const APPLY = process.argv.includes('--apply');
const VERSION = 1;
const decimal = (value) => mongoose.Types.Decimal128.fromString(Number(value).toFixed(2));
const amountOf = (value) => Number(value?.toString?.() ?? value ?? 0);
const roundCoins = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function planWalletLedgerMigration({
  currentBalance,
  verifiedPurchasedCoins,
  historicalSpendCoins,
  legacyVipSpendCoins = 0,
}) {
  const balance = Math.max(0, roundCoins(currentBalance));
  const confirmedPurchaseRemainder = Math.max(
    0,
    roundCoins(verifiedPurchasedCoins - historicalSpendCoins - legacyVipSpendCoins)
  );
  const purchasedCoins = Math.min(balance, confirmedPurchaseRemainder);
  return {
    purchasedCoins,
    legacyRestrictedCoins: roundCoins(balance - purchasedCoins),
    promotionalCoins: 0,
  };
}

async function getLegacyLedgerTotals(userId, session) {
  const [purchases, spends, vipSubscriptions] = await Promise.all([
    Transaction.find({
      userId,
      status: 'SUCCESS',
      type: { $in: ['FUND', 'COIN_PURCHASE'] },
      $or: [
        { 'metadata.paystackTransactionId': { $exists: true, $ne: null } },
        { provider: 'PAYSTACK' },
      ],
    }).session(session),
    Transaction.find({
      userId,
      status: 'SUCCESS',
      type: { $in: ['SPEND', 'EPISODE_UNLOCK'] },
    }).session(session),
    Subscription.find({
      userId,
      paymentReference: { $in: [null, ''] },
    }).session(session),
  ]);
  return {
    verifiedPurchasedCoins: roundCoins(
      purchases.reduce((sum, item) => sum + amountOf(item.amount), 0)
    ),
    historicalSpendCoins: roundCoins(
      spends.reduce((sum, item) => sum + amountOf(item.amount), 0)
    ),
    legacyVipSpendCoins: roundCoins(
      vipSubscriptions.reduce((sum, item) => sum + amountOf(item.price), 0)
    ),
  };
}

async function migrateWallet(wallet, apply) {
  if (wallet.ledgerMigrationVersion >= VERSION) return { status: 'already-migrated' };

  const currentBalance = amountOf(wallet.storyCoins);
  const totals = await getLegacyLedgerTotals(wallet.userId);
  const split = planWalletLedgerMigration({ currentBalance, ...totals });
  if (!apply) {
    return {
      status: 'dry-run',
      userId: wallet.userId.toString(),
      currentBalance,
      ...totals,
      ...split,
    };
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const currentWallet = await Wallet.findOne({ _id: wallet._id }).session(session);
      if (!currentWallet || currentWallet.ledgerMigrationVersion >= VERSION) {
        result = { status: 'already-migrated' };
        return;
      }

      const balanceAtApply = amountOf(currentWallet.storyCoins);
      if (roundCoins(balanceAtApply) !== roundCoins(currentBalance)) {
        throw new Error(`Wallet ${wallet._id} changed after migration planning; rerun the script.`);
      }

      const freshTotals = await getLegacyLedgerTotals(wallet.userId, session);
      const freshSplit = planWalletLedgerMigration({
        currentBalance: balanceAtApply,
        ...freshTotals,
      });

      if (freshSplit.purchasedCoins > 0) {
        await CoinLot.updateOne(
          { reference: `MIGRATION-${wallet._id}-PURCHASED` },
          {
            $setOnInsert: {
              userId: wallet.userId,
              source: 'PURCHASED',
              initialCoins: freshSplit.purchasedCoins,
              remainingCoins: freshSplit.purchasedCoins,
              cashValueNaira: decimal(freshSplit.purchasedCoins * 2),
              providerFeeNaira: decimal(0),
              rewardAdIds: [],
              reference: `MIGRATION-${wallet._id}-PURCHASED`,
              metadata: { migrationVersion: VERSION, basis: 'verified Paystack net of all historical spending' },
            },
          },
          { upsert: true, session }
        );
      }
      if (freshSplit.legacyRestrictedCoins > 0) {
        await CoinLot.updateOne(
          { reference: `MIGRATION-${wallet._id}-RESTRICTED` },
          {
            $setOnInsert: {
              userId: wallet.userId,
              source: 'LEGACY_RESTRICTED',
              initialCoins: freshSplit.legacyRestrictedCoins,
              remainingCoins: freshSplit.legacyRestrictedCoins,
              cashValueNaira: decimal(0),
              providerFeeNaira: decimal(0),
              rewardAdIds: [],
              reference: `MIGRATION-${wallet._id}-RESTRICTED`,
              metadata: { migrationVersion: VERSION, vipAndTransferRestricted: true },
            },
          },
          { upsert: true, session }
        );
      }

      currentWallet.purchasedCoins = decimal(freshSplit.purchasedCoins);
      currentWallet.promotionalCoins = decimal(0);
      currentWallet.legacyRestrictedCoins = decimal(freshSplit.legacyRestrictedCoins);
      currentWallet.ledgerMigrationVersion = VERSION;
      await currentWallet.save({ session });
      result = { status: 'migrated', userId: wallet.userId.toString(), ...freshSplit };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function main() {
  const { connectDB, disconnectDB } = await import('../config/db.js');
  await connectDB();
  const results = [];
  try {
    const wallets = await Wallet.find({
      $or: [
        { ledgerMigrationVersion: { $lt: VERSION } },
        { ledgerMigrationVersion: { $exists: false } },
      ],
    }).sort({ _id: 1 });
    for (const wallet of wallets) {
      results.push(await migrateWallet(wallet, APPLY));
    }
    console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', wallets: results.length, results }, null, 2));
    if (!APPLY) {
      console.log('No data was changed. Re-run with --apply to commit the migration.');
    }
  } finally {
    await disconnectDB();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Wallet ledger migration failed:', error);
    process.exitCode = 1;
  });
}
