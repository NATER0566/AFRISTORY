import mongoose from 'mongoose';

const coinPackageSchema = new mongoose.Schema(
  {
    coins: { type: Number, required: true, min: 1 },
    naira: { type: Number, required: true, min: 1 },
    promotionalCoins: { type: Number, default: 0, min: 0, max: 0 },
    active: { type: Boolean, default: true },
  },
  { _id: false }
);

const vipPackageSchema = new mongoose.Schema(
  {
    purchasedCoinPrice: { type: Number, default: 0, min: 0 },
    vipCreditsGranted: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: false },
  },
  { _id: false }
);

const financialConfigSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: 'default' },
    coinPackages: {
      STARTER: { type: coinPackageSchema, default: () => ({ coins: 100, naira: 200 }) },
      PLUS: { type: coinPackageSchema, default: () => ({ coins: 300, naira: 600 }) },
      PREMIUM: { type: coinPackageSchema, default: () => ({ coins: 1000, naira: 2000 }) },
      ELITE: { type: coinPackageSchema, default: () => ({ coins: 3000, naira: 6000 }) },
    },
    vipPackages: {
      VIP_STARTER: { type: vipPackageSchema, default: () => ({}) },
      VIP_PLUS: { type: vipPackageSchema, default: () => ({}) },
      VIP_PREMIUM: { type: vipPackageSchema, default: () => ({}) },
    },
    promoRewardAmount: { type: Number, default: 5, enum: [5] },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

financialConfigSchema.pre('validate', function () {
  for (const [key, plan] of Object.entries(this.coinPackages || {})) {
    if (!plan) continue;
    if (plan.naira !== plan.coins * 2 || plan.promotionalCoins !== 0) {
      this.invalidate(`coinPackages.${key}`, 'Coin packages must charge exactly ₦2 per coin and include no promotional coins.');
    }
  }
  for (const [key, plan] of Object.entries(this.vipPackages || {})) {
    if (plan?.active && (plan.purchasedCoinPrice <= 0 || plan.vipCreditsGranted <= 0)) {
      this.invalidate(`vipPackages.${key}`, 'Active VIP packages need a positive purchased coin price and credit quantity.');
    }
  }
});

export default mongoose.models.FinancialConfig ||
  mongoose.model('FinancialConfig', financialConfigSchema);
