import mongoose from 'mongoose';

const walletSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    storyCoins: {
      type: mongoose.Decimal128,
      default: 0.0,
      // Deprecated compatibility mirror of purchased, promotional and restricted coins.
    },
    purchasedCoins: {
      type: mongoose.Decimal128,
      default: () => mongoose.Types.Decimal128.fromString('0'),
    },
    promotionalCoins: {
      type: mongoose.Decimal128,
      default: () => mongoose.Types.Decimal128.fromString('0'),
    },
    legacyRestrictedCoins: {
      type: mongoose.Decimal128,
      default: () => mongoose.Types.Decimal128.fromString('0'),
    },
    vipCredits: {
      type: mongoose.Decimal128,
      default: () => mongoose.Types.Decimal128.fromString('0'),
    },
    vipCreditValueNaira: {
      type: mongoose.Decimal128,
      default: () => mongoose.Types.Decimal128.fromString('0'),
    },
    totalSpent: {
      type: mongoose.Decimal128,
      default: () => mongoose.Types.Decimal128.fromString('0'),
    },
    pendingCreatorEarnings: {
      type: mongoose.Decimal128,
      default: () => mongoose.Types.Decimal128.fromString('0'),
    },
    availableCreatorEarnings: {
      type: mongoose.Decimal128,
      default: () => mongoose.Types.Decimal128.fromString('0'),
    },
    withdrawnCreatorEarnings: {
      type: mongoose.Decimal128,
      default: () => mongoose.Types.Decimal128.fromString('0'),
    },
    ledgerMigrationVersion: {
      type: Number,
      default: 0,
    },
    lockedEarnings: {
      type: mongoose.Decimal128,
      default: 0.0,
    },
    totalWithdrawn: {
      type: mongoose.Decimal128,
      default: 0.0,
    },
    totalEarned: {
      type: mongoose.Decimal128,
      default: 0.0,
    },
    lastWithdrawal: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

const decimalValue = (value) => Number(value?.toString?.() ?? value ?? 0);

walletSchema.virtual('totalStoryCoins').get(function () {
  return (
    decimalValue(this.purchasedCoins) +
    decimalValue(this.promotionalCoins) +
    decimalValue(this.legacyRestrictedCoins)
  );
});

walletSchema.pre('save', function () {
  this.storyCoins = mongoose.Types.Decimal128.fromString(this.totalStoryCoins.toFixed(2));
});

export default mongoose.model('Wallet', walletSchema);
