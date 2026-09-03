import mongoose from 'mongoose';

const seriesSchema = new mongoose.Schema(
  {
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Creator',
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      default: '',
      maxlength: 2000,
    },
    coverImage: {
      type: String,
      required: true,
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    status: {
      type: String,
      enum: ['ONGOING', 'COMPLETED', 'DRAFT'],
      default: 'DRAFT',
    },
    followers: {
      type: Number,
      default: 0,
    },
    totalViews: {
      type: Number,
      default: 0,
    },
    totalEpisodes: {
      type: Number,
      default: 0,
    },
    rating: {
      type: mongoose.Decimal128,
      default: 0.0,
    },
    genre: {
      type: String,
      default: null,
    },
    language: {
      type: String,
      default: 'English',
    },
    isPublished: {
      type: Boolean,
      default: false,
    },
    isPremiumExclusive: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Index for better query performance
seriesSchema.index({ creatorId: 1, status: 1 });
seriesSchema.index({ title: 'text', description: 'text', tags: 'text' });

export default mongoose.model('Series', seriesSchema);
