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
      enum: [
        'COIN_PURCHASE',
        'PROMO_REWARD',
        'EPISODE_UNLOCK',
        'VIP_PURCHASE',
        'CREATOR_EARNING',
        'PAYOUT',
      ],
      required: true,
    },
    source: {
      type: String,
      enum: ['PURCHASED', 'PROMOTIONAL', 'VIP_CREDIT', 'DIRECT_AD', 'PAYOUT'],
      required: true,
    },
    provider: {
      type: String,
      enum: ['WALLET', 'PAYSTACK', 'ROBINADS', 'SYSTEM'],
      default: 'WALLET',
    },
    amount: {
      type: mongoose.Decimal128,
      required: true,
    },
    reference: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    externalReference: {
      type: String,
      unique: true,
      sparse: true,
    },
    description: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['PENDING', 'SUCCESS', 'FAILED', 'REJECTED'],
      default: 'PENDING',
    },
    episodeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Episode', default: null },
    creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Creator', default: null },
    lotRefs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CoinLot' }],
    sourceAdIds: [{ type: String, trim: true }],
    grossNaira: { type: mongoose.Decimal128, default: () => mongoose.Types.Decimal128.fromString('0') },
    creatorShareNaira: { type: mongoose.Decimal128, default: () => mongoose.Types.Decimal128.fromString('0') },
    platformShareNaira: { type: mongoose.Decimal128, default: () => mongoose.Types.Decimal128.fromString('0') },
    providerFeeNaira: { type: mongoose.Decimal128, default: () => mongoose.Types.Decimal128.fromString('0') },
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
transactionSchema.index({ type: 1, status: 1, createdAt: -1 });

export default mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);
