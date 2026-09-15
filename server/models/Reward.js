import mongoose from 'mongoose';

const rewardSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, default: '', maxlength: 500 },
    type: {
      type: String,
      enum: ['ONE_TIME', 'DAILY', 'STREAK', 'MILESTONE', 'MISSION', 'SOCIAL', 'REFERRAL', 'PROFILE', 'DISCOVERY', 'WATCHING', 'CAMPAIGN', 'EVENT', 'ADMIN'],
      required: true,
    },
    category: { type: String, default: 'missions', trim: true },
    rewardAmount: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ['DRAFT', 'ACTIVE', 'INACTIVE'], default: 'DRAFT', index: true },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    recurrenceType: { type: String, enum: ['once', 'daily', 'weekly', 'monthly', 'custom'], default: 'once' },
    recurrenceInterval: { type: Number, default: 1, min: 1 },
    maxClaims: { type: Number, default: null, min: 1 },
    maxClaimsPerUser: { type: Number, default: 1, min: 1 },
    eligibilityRules: { type: mongoose.Schema.Types.Mixed, default: {} },
    verificationMode: { type: String, enum: ['server', 'manual_claim', 'admin_verified'], default: 'server' },
    requiresAdminApproval: { type: Boolean, default: false },
    stackable: { type: Boolean, default: true },
    expiresAt: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

rewardSchema.index({ status: 1, startAt: 1, endAt: 1 });
rewardSchema.index({ type: 1, category: 1 });

export default mongoose.model('Reward', rewardSchema);