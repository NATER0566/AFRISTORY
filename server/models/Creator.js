import mongoose from 'mongoose';

const creatorSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    brandName: {
      type: String,
      required: true,
      trim: true,
    },
    bio: {
      type: String,
      default: '',
      maxlength: 500,
    },
    profileImage: {
      type: String,
      default: null,
    },
    coverImage: {
      type: String,
      default: null,
    },
    socialLinks: {
      twitter: { type: String, default: null },
      instagram: { type: String, default: null },
      facebook: { type: String, default: null },
      tiktok: { type: String, default: null },
      youtube: { type: String, default: null },
      website: { type: String, default: null },
    },
    totalViews: {
      type: mongoose.Decimal128,
      default: 0,
    },
    // NEW FEATURE: Creator-level unique viewer count
    uniqueViewers: {
      type: Number,
      default: 0,
    },
    // NEW FEATURE: Creator-level returning viewer count
    returningViewers: {
      type: Number,
      default: 0,
    },
    totalEarnings: {
      type: mongoose.Decimal128,
      default: 0,
    },
    totalSeries: {
      type: Number,
      default: 0,
    },
    totalFollowers: {
      type: Number,
      default: 0,
    },
    rating: {
      type: mongoose.Decimal128,
      default: 0.0,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    bankAccount: {
      accountNumber: { type: String, default: null },
      bankCode: { type: String, default: null },
      accountName: { type: String, default: null },
    },
  },
  { timestamps: true }
);

export default mongoose.model('Creator', creatorSchema);
