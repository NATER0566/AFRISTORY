import mongoose from 'mongoose';

const creatorEarningSchema = new mongoose.Schema(
  {
    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Creator', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    source: {
      type: String,
      enum: ['PURCHASED_COIN', 'DIRECT_AD', 'PROMO_AD', 'VIP_CREDIT'],
      required: true,
    },
    status: { type: String, enum: ['PENDING', 'AVAILABLE', 'WITHDRAWN'], default: 'PENDING', index: true },
    grossNaira: { type: mongoose.Decimal128, required: true },
    creatorAmountNaira: { type: mongoose.Decimal128, required: true },
    platformAmountNaira: { type: mongoose.Decimal128, required: true },
    episodeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Episode', required: true },
    unlockId: { type: mongoose.Schema.Types.ObjectId, ref: 'Unlock', required: true },
    sourceAdIds: { type: [{ type: String, trim: true }], default: [] },
    reconciliationBatchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdRevenueBatch',
      default: null,
    },
    reference: { type: String, required: true, unique: true, trim: true },
    withdrawnAt: { type: Date, default: null },
  },
  { timestamps: true }
);

creatorEarningSchema.index({ unlockId: 1 }, { unique: true });
creatorEarningSchema.index(
  { sourceAdIds: 1 },
  { unique: true, partialFilterExpression: { 'sourceAdIds.0': { $exists: true } } }
);
creatorEarningSchema.index({ creatorId: 1, status: 1, createdAt: -1 });

export default mongoose.models.CreatorEarning ||
  mongoose.model('CreatorEarning', creatorEarningSchema);
