import mongoose from 'mongoose';

const adbnkRewardSchema = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    episodeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Episode', required: true },
    pendingRewardId: { type: mongoose.Schema.Types.ObjectId, ref: 'PendingReward', default: null },
    providerData: { type: mongoose.Schema.Types.Mixed, default: {} },
    source: { type: String, enum: ['verify', 'ssv'], required: true },
    grantedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model('AdbnkReward', adbnkRewardSchema);
