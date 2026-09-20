import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: [
        'NEW_EPISODE',
        'COMMENT',          // NEW: Top-level comments
        'COMMENT_REPLY',
        'LIKE',
        'SERIES_UPDATED',
        'PAYOUT_READY',
        'SUBSCRIPTION_EXPIRING',
        'NEW_FOLLOWER',
        'REWARD_AVAILABLE',
        'REWARD_EARNED',
        'PAYMENT_SUCCESS',  // NEW: Copilot found this was missing
        'CREATOR_VERIFIED', // NEW: Copilot found this was missing
        'SYSTEM',
      ],
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      default: '',
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    targetUrl: {          
      type: String,
      default: null,
    },
    icon: {               // NEW: Supports beautiful branding (e.g., AfriStory logo)
      type: String,
      default: null,
    },
    image: {              // NEW: Supports rich media (e.g., Episode thumbnail or Reward banner)
      type: String,
      default: null,
    },
    dedupeKey: {          
      type: String,
      default: null,
      index: true,
      sparse: true,
    },
    read: {
      type: Boolean,
      default: false,
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Index for better query performance
notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);
