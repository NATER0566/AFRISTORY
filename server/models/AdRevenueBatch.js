import mongoose from 'mongoose';

const completionSchema = new mongoose.Schema(
  {
    rewardId: { type: String, required: true, trim: true },
    purpose: { type: String, enum: ['DIRECT_EPISODE_UNLOCK', 'PROMO_REWARD'], required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    targetId: { type: String, required: true },
    netRevenueNaira: { type: mongoose.Decimal128, required: true },
  },
  { _id: false }
);

const adRevenueBatchSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, trim: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    providerNetRevenueNaira: { type: mongoose.Decimal128, required: true },
    perCompletionRevenueNaira: { type: mongoose.Decimal128, required: true },
    eligibleCompletionCount: { type: Number, required: true, min: 1 },
    completions: { type: [completionSchema], required: true },
    status: { type: String, enum: ['RECONCILED', 'FAILED'], default: 'RECONCILED' },
    reconciledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

adRevenueBatchSchema.index(
  { 'completions.rewardId': 1 },
  { unique: true, name: 'unique_reconciled_ad_reward' }
);

export default mongoose.models.AdRevenueBatch ||
  mongoose.model('AdRevenueBatch', adRevenueBatchSchema);
