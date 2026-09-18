import mongoose from 'mongoose';

const userFollowSchema = new mongoose.Schema(
  {
    followerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    followingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

// CRITICAL: Prevent duplicate follows for normal users
userFollowSchema.index(
  { followerId: 1, followingId: 1 },
  { unique: true }
);

export default mongoose.model('UserFollow', userFollowSchema);
