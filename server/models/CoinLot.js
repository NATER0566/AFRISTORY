import mongoose from 'mongoose';

const coinLotSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    source: {
      type: String,
      enum: ['PURCHASED', 'PROMOTIONAL', 'LEGACY_RESTRICTED'],
      required: true,
    },
    initialCoins: { type: Number, required: true, min: 1 },
    remainingCoins: { type: Number, required: true, min: 0 },
    cashValueNaira: {
      type: mongoose.Decimal128,
      required: true,
      default: () => mongoose.Types.Decimal128.fromString('0'),
    },
    providerFeeNaira: {
      type: mongoose.Decimal128,
      default: () => mongoose.Types.Decimal128.fromString('0'),
    },
    rewardAdIds: { type: [{ type: String, trim: true }], default: [] },
    reference: { type: String, required: true, unique: true, trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

coinLotSchema.index({ userId:  1, source: 1, createdAt: 1, _id: 1 });
coinLotSchema.index(
  { rewardAdIds: 1 },
  { unique: true, partialFilterExpression: { 'rewardAdIds.0': { $exists: true } } }
);

coinLotSchema.pre('validate', function () {
  const cashValue = Number(this.cashValueNaira?.toString?.() ?? this.cashValueNaira ?? 0);
  if (this.source === 'PROMOTIONAL' && cashValue !== 0) {
    this.invalidate('cashValueNaira', 'Promotional coins cannot have a cash value.');
  }
  if (
    this.source === 'PURCHASED' &&
    (cashValue <= 0 ||
      (!this.metadata?.historicalPricing && cashValue !== this.initialCoins * 2))
  ) {
    this.invalidate('cashValueNaira', 'Purchased coins must be valued at exactly ₦2 per coin.');
  }
  if (this.source === 'LEGACY_RESTRICTED' && cashValue !== 0) {
    this.invalidate('cashValueNaira', 'Legacy restricted coins cannot be assigned a cash value.');
  }
});

export default mongoose.models.CoinLot || mongoose.model('CoinLot', coinLotSchema);
