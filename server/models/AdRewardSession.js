import mongoose from 'mongoose';

const adRewardSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    rewardId: {
      type: String,
      trim: true,
    },
    provider: {
      type: String,
      default: 'ROBINADS',
      trim: true,
    },
    websiteId: {
      type: String,
      trim: true,
    },
    zoneId: {
      type: String,
      trim: true,
    },
    purpose: {
      type: String,
      enum: ['PROMO_REWARD', 'DIRECT_EPISODE_UNLOCK'],
      required: true,
      trim: true,
    },
    targetId: {
      type: String,
      required: true,
      trim: true,
    },
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Creator',
      default: null,
    },
    amount: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['PENDING', 'COMPLETED', 'CONSUMED', 'EXPIRED', 'FAILED'],
      default: 'PENDING',
      index: true,
    },
    ipAddress: {
      type: String,
      default: null,
    },
    userAgent: {
      type: String,
      default: null,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    consumedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    reconciledRevenueNaira: {
      type: mongoose.Decimal128,
      default: null,
    },
    revenueBatchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdRevenueBatch',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

adRewardSessionSchema.index({ rewardId: 1 }, { unique: true, sparse: true });

const AdRewardSession =
  mongoose.models.AdRewardSession ||
  mongoose.model('AdRewardSession', adRewardSessionSchema);

export default AdRewardSession;
