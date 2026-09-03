import mongoose from 'mongoose';
import bcryptjs from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    verificationCode: {
      type: String,
      default: null,
    },
    verificationCodeExpires: {
      type: Date,
      default: null,
    },
    resetPasswordCode: {
      type: String,
      default: null,
    },
    resetPasswordExpires: {
      type: Date,
      default: null,
    },
    subscriptionExpiresAt: {
      type: Date,
      default: null,
    },
    pinHash: {
      type: String,
      default: null,
    },
    role: {
      type: String,
      enum: ['USER', 'ADMIN', 'CREATOR'],
      default: 'USER',
    },
    adUnlocksRemaining: {
      type: Number,
      default: 3,
    },
    adUnlocksResetDate: {
      type: Date,
      default: () => new Date(),
    },
    profileImage: {
      type: String,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) {
    return next();
  }
  try {
    const salt = await bcryptjs.genSalt(10);
    this.passwordHash = await bcryptjs.hash(this.passwordHash, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Hash PIN before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('pinHash') || !this.pinHash) {
    return next();
  }
  try {
    const salt = await bcryptjs.genSalt(10);
    this.pinHash = await bcryptjs.hash(this.pinHash, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare passwords
userSchema.methods.comparePassword = async function (password) {
  return await bcryptjs.compare(password, this.passwordHash);
};

// Method to compare PIN
userSchema.methods.comparePIN = async function (pin) {
  if (!this.pinHash) return false;
  return await bcryptjs.compare(pin, this.pinHash);
};

// Don't return passwordHash in queries by default
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  delete obj.pinHash;
  return obj;
};

export default mongoose.model('User', userSchema);
