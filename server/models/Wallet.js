import mongoose from 'mongoose';

const walletSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    storyCoins: {
      type: mongoose.Decimal128,
      default: 0.0,
    },
    lockedEarnings: {
      type: mongoose.Decimal128,
      default: 0.0,
    },
    totalWithdrawn: {
      type: mongoose.Decimal128,
      default: 0.0,
    },
    totalEarned: {
      type: mongoose.Decimal128,
      default: 0.0,
    },
    lastWithdrawal: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model('Wallet', walletSchema);
