import mongoose from 'mongoose';

const unlockSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    episodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Episode',
      required: true,
    },
    seriesId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Series',
      required: true,
    },
    method: {
      type: String,
      enum: ['COIN', 'AD', 'VIP', 'FREE'],
      required: true,
    },
    unlockedAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      default: null, // For temporary unlocks
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Compound index to ensure one unlock per user per episode
unlockSchema.index({ userId: 1, episodeId: 1 }, { unique: true });
unlockSchema.index({ userId: 1, isActive: 1 });
unlockSchema.index({ episodeId: 1, isActive: 1 });

export default mongoose.model('Unlock', unlockSchema);
