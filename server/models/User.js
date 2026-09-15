import mongoose from 'mongoose';
import bcryptjs from 'bcryptjs';
import { GENRES, LANGUAGES } from './Series.js';

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
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
      default: null,
    },
    authProviders: {
      googleId: { type: String, unique: true, sparse: true },
      githubId: { type: String, unique: true, sparse: true },
      appleSub: { type: String, unique: true, sparse: true },
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
    profile: {
      displayName: {
        type: String,
        trim: true,
        maxlength: 80,
        default: '',
      },
      bio: {
        type: String,
        trim: true,
        maxlength: 280,
        default: '',
      },
      avatarUrl: {
        type: String,
        default: null,
      },
      coverUrl: {
        type: String,
        default: null,
      },
      country: {
        type: String,
        trim: true,
        maxlength: 80,
        default: '',
      },
      region: {
        type: String,
        trim: true,
        maxlength: 80,
        default: '',
      },
      preferredLanguage: {
        type: String,
        enum: LANGUAGES,
        default: 'English',
      },
      additionalLanguages: {
        type: [{ type: String, enum: LANGUAGES }],
        default: [],
      },
      favoriteGenres: {
        type: [{ type: String, enum: GENRES }],
        default: [],
      },
      favoriteCultures: {
        type: [{ type: String, trim: true, maxlength: 80 }],
        default: [],
      },
    },
    privacy: {
      profileVisibility: {
        type: String,
        enum: ['PUBLIC', 'PRIVATE'],
        default: 'PRIVATE',
      },
      showFavorites: {
        type: Boolean,
        default: false,
      },
      showWatchActivity: {
        type: Boolean,
        default: false,
      },
    },
    rewardStats: {
      currentStreak: { type: Number, default: 0, min: 0 },
      bestStreak: { type: Number, default: 0, min: 0 },
      totalCheckInDays: { type: Number, default: 0, min: 0 },
      lastCheckInAt: { type: Date, default: null },
      currentRewardDay: { type: Number, default: 0, min: 0, max: 7 },
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
    if (!this.passwordHash) return next();
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
  if (!this.passwordHash) return false;
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
