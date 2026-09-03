import mongoose from 'mongoose';

const episodeSchema = new mongoose.Schema(
  {
    seriesId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Series',
      required: true,
    },
    episodeNumber: {
      type: Number,
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      maxlength: 2000,
    },
    mediaUrl: {
      type: String,
      required: true,
    },
    thumbnailUrl: {
      type: String,
      default: null,
    },
    duration: {
      type: Number,
      default: 0, // in seconds
    },
    isFree: {
      type: Boolean,
      default: false,
    },
    coinCost: {
      type: Number,
      default: 10,
    },
    adUnlockable: {
      type: Boolean,
      default: true,
    },
    totalViews: {
      type: Number,
      default: 0,
    },
    totalUnlocks: {
      type: Number,
      default: 0,
    },
    totalAdUnlocks: {
      type: Number,
      default: 0,
    },
    averageWatchTime: {
      type: Number,
      default: 0, // in seconds
    },
    likes: {
      type: Number,
      default: 0,
    },
    rating: {
      type: mongoose.Decimal128,
      default: 0.0,
    },
    isPublished: {
      type: Boolean,
      default: false,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Index for better query performance
episodeSchema.index({ seriesId: 1, episodeNumber: 1 });
episodeSchema.index({ seriesId: 1, isPublished: 1 });

export default mongoose.model('Episode', episodeSchema);
