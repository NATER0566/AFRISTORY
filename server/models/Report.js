import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema(
  {
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reportType: {
      type: String,
      enum: ['EPISODE', 'COMMENT', 'CREATOR', 'SERIES'],
      required: true,
    },
    reportedItemId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    reason: {
      type: String,
      enum: [
        'INAPPROPRIATE_CONTENT',
        'COPYRIGHT_VIOLATION',
        'HARASSMENT',
        'SPAM',
        'MISLEADING',
        'VIOLENT_CONTENT',
        'OTHER',
      ],
      required: true,
    },
    description: {
      type: String,
      maxlength: 1000,
    },
    status: {
      type: String,
      enum: ['PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED'],
      default: 'PENDING',
    },
    adminNotes: {
      type: String,
      default: '',
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Index for better query performance
reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ reportedBy: 1, createdAt: -1 });

export default mongoose.model('Report', reportSchema);
