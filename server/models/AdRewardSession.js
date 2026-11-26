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
      index: true,
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
      trim: true,
    },
    targetId: {
      type: String,
      trim: true,
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
  },
  {
    timestamps: true,
  }
);

const AdRewardSession =
  mongoose.models.AdRewardSession ||
  mongoose.model('AdRewardSession', adRewardSessionSchema);

export default AdRewardSession;
