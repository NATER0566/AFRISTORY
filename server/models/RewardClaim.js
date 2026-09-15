import mongoose from 'mongoose';

const rewardClaimSchema = new mongoose.Schema(
  {
    rewardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Reward', required: true },
    taskId: { type: String, default: null, trim: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['PENDING', 'CLAIMED', 'REJECTED', 'EXPIRED'], default: 'CLAIMED' },
    amount: { type: Number, required: true, min: 1 },
    periodKey: { type: String, required: true },
    referenceId: { type: String, required: true },
    claimedAt: { type: Date, default: Date.now },
    verifiedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

rewardClaimSchema.index({ rewardId: 1, userId: 1, periodKey: 1 }, { unique: true });
rewardClaimSchema.index({ userId: 1, taskId: 1 }, { unique: true, partialFilterExpression: { taskId: { $type: 'string' } } });
rewardClaimSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('RewardClaim', rewardClaimSchema);