import mongoose from 'mongoose';

const likeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  episodeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Episode', required: true }
}, { timestamps: true });

// CRITICAL: Prevents duplicate likes from the same user on the same episode
likeSchema.index({ userId: 1, episodeId: 1 }, { unique: true });

export default mongoose.model('Like', likeSchema);
