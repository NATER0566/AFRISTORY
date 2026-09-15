import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema(
  {
    walletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Wallet',
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['FUND', 'SPEND', 'AD_REWARD', 'BONUS', 'PAYOUT', 'REFUND'],
      required: true,
    },
    amount: {
      type: mongoose.Decimal128,
      required: true,
    },
    reference: {
      type: String,
      unique: true,
      required: true,
    },
    description: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['PENDING', 'SUCCESS', 'FAILED'],
      default: 'PENDING',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    balanceBefore: {
      type: mongoose.Decimal128,
      default: null,
    },
    balanceAfter: {
      type: mongoose.Decimal128,
      default: null,
    },
  },
  { timestamps: true }
);

// Index for better query performance
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ type: 1 });

export default mongoose.model('Transaction', transactionSchema);
