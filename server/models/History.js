import mongoose from 'mongoose';

const historySchema = new mongoose.Schema(
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
    lastPosition: {
      type: Number,
      default: 0, // in seconds
    },
    totalWatchTime: {
      type: Number,
      default: 0, // in seconds
    },
    completed: {
      type: Boolean,
      default: false,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    watchedPercentage: {
      type: Number,
      default: 0, // 0-100
    },
  },
  { timestamps: true }
);

// Index for better query performance
historySchema.index({ userId: 1, updatedAt: -1 });
historySchema.index({ userId: 1, episodeId: 1 }, { unique: true });

export default mongoose.model('History', historySchema);
