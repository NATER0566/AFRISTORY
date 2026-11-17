import mongoose from 'mongoose';

const pendingRewardSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    episodeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Episode', required: true, index: true },
    zoneCode: { type: String, required: true, enum: ['zone_f3fcad23db83'] },
    status: { type: String, enum: ['pending', 'used', 'failed', 'expired'], default: 'pending', index: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

pendingRewardSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('PendingReward', pendingRewardSchema);
