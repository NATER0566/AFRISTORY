import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import CoinLot from '../models/CoinLot.js';
import FinancialConfig from '../models/FinancialConfig.js';
import { planWalletLedgerMigration } from '../scripts/migrateWalletLedger.js';

const decimal = (value) => mongoose.Types.Decimal128.fromString(String(value));

test('migration classifies only provable purchased coins and preserves the total balance', () => {
  const result = planWalletLedgerMigration({
    currentBalance: 60,
    verifiedPurchasedCoins: 100,
    historicalSpendCoins: 35,
    legacyVipSpendCoins: 10,
  });

  assert.deepEqual(result, {
    purchasedCoins: 55,
    legacyRestrictedCoins: 5,
    promotionalCoins: 0,
  });
  assert.equal(result.purchasedCoins + result.legacyRestrictedCoins, 60);
});

test('coin lots reject cash value for promotional coins', async () => {
  const lot = new CoinLot({
    userId: new mongoose.Types.ObjectId(),
    source: 'PROMOTIONAL',
    initialCoins: 5,
    remainingCoins: 5,
    cashValueNaira: decimal(1),
    reference: 'PROMO-LOT-TEST',
  });

  await assert.rejects(lot.validate(), /Promotional coins cannot have a cash value/);
});

test('historical purchased coin lots can retain their recorded payment value', async () => {
  const lot = new CoinLot({
    userId: new mongoose.Types.ObjectId(),
    source: 'PURCHASED',
    initialCoins: 100,
    remainingCoins: 100,
    cashValueNaira: decimal(4750),
    reference: 'LEGACY-PURCHASE-LOT-TEST',
    metadata: { historicalPricing: true },
  });

  await assert.doesNotReject(lot.validate());
});

test('financial configuration rejects coin pricing other than ₦2 per coin', async () => {
  const config = new FinancialConfig({
    coinPackages: {
      STARTER: { coins: 100, naira: 201, promotionalCoins: 0, active: true },
    },
  });

  await assert.rejects(config.validate(), /exactly ₦2 per coin/);
});
