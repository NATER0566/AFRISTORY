import mongoose from 'mongoose';

const ratingSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  episodeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Episode', required: true },
  rating: { type: Number, required: true, min: 1, max: 5 }
}, { timestamps: true });

// CRITICAL: Ensures one rating per user per episode
ratingSchema.index({ userId: 1, episodeId: 1 }, { unique: true });

export default mongoose.model('Rating', ratingSchema);
