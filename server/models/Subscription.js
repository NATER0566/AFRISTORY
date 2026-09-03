import mongoose from 'mongoose';

const subscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    tier: {
      type: String,
      enum: ['DAILY', 'HALF_WEEK', 'WEEKLY', 'MONTHLY'],
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    autoRenew: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'EXPIRED', 'CANCELLED'],
      default: 'ACTIVE',
    },
    paymentReference: {
      type: String,
      default: null,
    },
    price: {
      type: mongoose.Decimal128,
      default: 0.0,
    },
    renewalDate: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Index for better query performance
subscriptionSchema.index({ userId: 1 });
subscriptionSchema.index({ expiresAt: 1 });
subscriptionSchema.index({ status: 1 });

export default mongoose.model('Subscription', subscriptionSchema);
