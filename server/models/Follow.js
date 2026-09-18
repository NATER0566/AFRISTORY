import mongoose from 'mongoose';

const followSchema = new mongoose.Schema(
  {
    followerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Creator',
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

// This compound index strictly enforces that one user can only follow a specific creator exactly once at the database level, completely neutralizing spam clicks.
followSchema.index({ followerId: 1, creatorId: 1 }, { unique: true });

export default mongoose.model('Follow', followSchema);
