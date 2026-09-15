import mongoose from 'mongoose';

export const EPISODE_GENRES = [
  'Action', 'Drama', 'Comedy', 'Romance', 'Thriller', 'Horror', 'Adventure',
  'Family', 'Historical', 'Traditional', 'Documentary', 'Educational',
  'Faith', 'Mystery', 'Other',
];

export const CULTURAL_CATEGORIES = [
  'Tiv', 'Igbo', 'Yoruba', 'Hausa', 'Idoma', 'Nupe', 'Fulani', 'Edo',
  'Efik', 'Ibibio', 'Kanuri', 'Ijaw', 'Other African culture',
];

export const EPISODE_LANGUAGES = [
  'English', 'Tiv', 'Igbo', 'Yoruba', 'Hausa', 'Idoma', 'Edo', 'Efik',
  'Ibibio', 'Nupe', 'Fulfulde', 'Kanuri', 'Ijaw', 'Other',
];

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
    genre: {
      type: String,
      enum: EPISODE_GENRES,
      required: true,
      index: true,
    },
    culturalCategory: {
      type: String,
      enum: CULTURAL_CATEGORIES,
      required: true,
      index: true,
    },
    language: {
      type: String,
      enum: EPISODE_LANGUAGES,
      required: true,
      index: true,
    },
    tags: {
      type: [String],
      default: [],
      index: true,
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
episodeSchema.index({ isPublished: 1, genre: 1, culturalCategory: 1, language: 1, createdAt: -1 });
episodeSchema.index({ isPublished: 1, totalViews: -1, createdAt: -1 });

export default mongoose.model('Episode', episodeSchema);
