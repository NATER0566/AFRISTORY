import mongoose from 'mongoose';

const rewardAuditSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rewardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Reward', default: null },
    claimId: { type: mongoose.Schema.Types.ObjectId, ref: 'RewardClaim', default: null },
    amount: { type: Number, required: true },
    source: { type: String, required: true },
    action: { type: String, enum: ['ISSUED', 'REVERSED', 'REJECTED'], required: true },
    status: { type: String, required: true },
    referenceId: { type: String, required: true },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reason: { type: String, default: '' },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: true }
);

rewardAuditSchema.index({ userId: 1, createdAt: -1 });
rewardAuditSchema.index({ rewardId: 1, createdAt: -1 });

export default mongoose.model('RewardAudit', rewardAuditSchema);