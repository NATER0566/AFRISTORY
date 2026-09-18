import mongoose from 'mongoose';

const episodeViewSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  episodeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Episode', required: true },
  creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true } 
}, { timestamps: true });

// CRITICAL: Ensures a user only counts as a UNIQUE VIEWER for an episode ONCE.
episodeViewSchema.index({ userId: 1, episodeId: 1 }, { unique: true });

// CRITICAL: Used to calculate Creator-Level Unique Viewers and Returning Viewers instantly.
episodeViewSchema.index({ creatorId: 1, userId: 1 });

export default mongoose.model('EpisodeView', episodeViewSchema);
