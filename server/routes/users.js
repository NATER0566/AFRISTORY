import User from '../models/User.js';
import Wallet from '../models/Wallet.js';
import History from '../models/History.js';
import Favorite from '../models/Favorite.js';
import Unlock from '../models/Unlock.js';
import Creator from '../models/Creator.js';
import UserFollow from '../models/UserFollow.js'; 
import { verifyAuth } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { paginate, formatDecimal } from '../utils/helpers.js';
import { createNotification } from '../utils/notificationService.js'; // NEW: Import central service

export default async function userRoutes(fastify, opts) {
  const privateUserFields = '-passwordHash -pinHash -verificationCode -verificationCodeExpires -resetPasswordCode -resetPasswordExpires';

  const uniqueValues = values => [...new Set((Array.isArray(values) ? values : []).map(value => String(value).trim()).filter(Boolean))];

  const publicProfile = user => ({
    _id: user._id,
    username: user.username,
    displayName: user.profile?.displayName || user.username,
    bio: user.profile?.bio || '',
    avatarUrl: user.profile?.avatarUrl || user.profileImage || null,
    coverUrl: user.profile?.coverUrl || null,
    country: user.profile?.country || '',
    region: user.profile?.region || '',
    role: user.role,
    isVerified: user.isVerified,
    createdAt: user.createdAt,
  });

  // Authenticated private profile dashboard.
  fastify.get('/me/profile', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);

      const [user, wallet, history, favorites, unlocks, creator] = await Promise.all([
        User.findById(request.user._id).select(privateUserFields),
        Wallet.findOne({ userId: request.user._id }),
        // FIX: Deeply populate images and duration for history
        History.find({ userId: request.user._id })
          .populate('episodeId', 'title thumbnailUrl duration')
          .populate('seriesId', 'title coverImage')
          .sort({ updatedAt: -1 }).limit(6),
        Favorite.find({ userId: request.user._id })
          .populate('seriesId', 'title coverImage')
          .sort({ createdAt: -1 }).limit(6),
        // FIX: Deeply populate images for library unlocks
        Unlock.find({ userId: request.user._id, isActive: true })
          .populate('episodeId', 'title thumbnailUrl duration')
          .populate('seriesId', 'title coverImage')
          .sort({ unlockedAt: -1 }).limit(20),
        Creator.findOne({ userId: request.user._id }).select('-bankAccount'),
      ]);

      sendSuccess(reply, {
        user: user.toJSON(),
        wallet: wallet
          ? {
              storyCoins: formatDecimal(wallet.storyCoins),
              lockedEarnings: formatDecimal(wallet.lockedEarnings),
              totalWithdrawn: formatDecimal(wallet.totalWithdrawn),
              totalEarned: formatDecimal(wallet.totalEarned),
            }
          : null,
        recentlyWatched: history,
        favorites: favorites.map(item => item.seriesId).filter(Boolean),
        library: unlocks,
        creator: creator ? { ...creator.toObject(), bankAccount: undefined } : null,
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch profile', 500, error.message);
    }
  });

  // Get user profile
  fastify.get('/:userId', async (request, reply) => {
    try {
      const { userId } = request.params;

      const user = await User.findById(userId).select(privateUserFields);

      if (!user) {
        return sendError(reply, 'User not found', 404);
      }

      if (user.privacy?.profileVisibility !== 'PUBLIC' && request.user?._id?.toString() !== userId) {
        return sendError(reply, 'User profile is private', 403);
      }

      sendSuccess(reply, { user: publicProfile(user) });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch user profile', 500, error.message);
    }
  });

  // Update profile
  fastify.put('/profile/update', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { username, email, profileImage, profile = {}, privacy = {} } = request.body || {};

      const user = await User.findById(request.user._id);

      if (!user.profile) user.profile = {};
      if (!user.privacy) user.privacy = {};

      if (username && username !== user.username) {
        const normalizedUsername = String(username).trim();
        if (!/^[a-zA-Z0-9_.\s]{3,30}$/.test(normalizedUsername)) {
          return sendError(reply, 'Username must be 3-30 characters and contain only letters, numbers, spaces, underscores, or dots', 400);
        }
        if (await User.exists({ username: normalizedUsername, _id: { $ne: user._id } })) {
          return sendError(reply, 'Username is already in use', 409);
        }
        user.username = normalizedUsername;
      }
      if (email && email !== user.email) user.email = String(email).trim().toLowerCase();
      if (profileImage !== undefined) {
        user.profileImage = profileImage || null;
        user.profile.avatarUrl = profileImage || null;
      }
      if (profile.displayName !== undefined) user.profile.displayName = String(profile.displayName).trim();
      if (profile.bio !== undefined) user.profile.bio = String(profile.bio).trim();
      if (profile.avatarUrl !== undefined) {
        user.profile.avatarUrl = profile.avatarUrl || null;
        user.profileImage = profile.avatarUrl || null;
      }
      if (profile.coverUrl !== undefined) user.profile.coverUrl = profile.coverUrl || null;
      if (profile.country !== undefined) user.profile.country = String(profile.country).trim();
      if (profile.region !== undefined) user.profile.region = String(profile.region).trim();
      if (profile.preferredLanguage !== undefined) user.profile.preferredLanguage = profile.preferredLanguage;
      if (profile.additionalLanguages !== undefined) user.profile.additionalLanguages = uniqueValues(profile.additionalLanguages);
      if (profile.favoriteGenres !== undefined) user.profile.favoriteGenres = uniqueValues(profile.favoriteGenres);
      if (profile.favoriteCultures !== undefined) user.profile.favoriteCultures = uniqueValues(profile.favoriteCultures);
      if (privacy.profileVisibility !== undefined) user.privacy.profileVisibility = privacy.profileVisibility;
      if (privacy.showFavorites !== undefined) user.privacy.showFavorites = Boolean(privacy.showFavorites);
      if (privacy.showWatchActivity !== undefined) user.privacy.showWatchActivity = Boolean(privacy.showWatchActivity);

      await user.save();

      sendSuccess(reply, user.toJSON(), 'Profile updated successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to update profile', 500, error.message);
    }
  });

  fastify.get('/me/history', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);
      
      // FIX: Populate image data
      const history = await History.find({ userId: request.user._id })
        .populate('episodeId', 'title thumbnailUrl duration')
        .populate('seriesId', 'title coverImage')
        .sort({ updatedAt: -1 })
        .limit(100);
        
      sendSuccess(reply, { history });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch watch history', 500, error.message);
    }
  });

  fastify.delete('/me/history/:historyId', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);
      const result = await History.deleteOne({ _id: request.params.historyId, userId: request.user._id });
      if (!result.deletedCount) return sendError(reply, 'History item not found', 404);
      sendSuccess(reply, null, 'History item removed');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to remove history item', 500, error.message);
    }
  });

  fastify.get('/me/watchlist', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);
      const favorites = await Favorite.find({ userId: request.user._id }).populate('seriesId').sort({ createdAt: -1 });
      sendSuccess(reply, { stories: favorites.map(item => item.seriesId).filter(Boolean) });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch watchlist', 500, error.message);
    }
  });

  fastify.get('/me/library', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);
      
      // FIX: Populate image data
      const unlocks = await Unlock.find({ userId: request.user._id, isActive: true })
        .populate('episodeId', 'title thumbnailUrl duration')
        .populate('seriesId', 'title coverImage')
        .sort({ unlockedAt: -1 });
        
      sendSuccess(reply, { unlocks });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch library', 500, error.message);
    }
  });

  // Get all users (paginated)
  fastify.get('/all/list', async (request, reply) => {
    try {
      const { page = 1, limit = 10 } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      const users = await User.find()
        .select('-passwordHash -pinHash')
        .skip(skip)
        .limit(l);

      const total = await User.countDocuments();

      sendSuccess(reply, {
        users,
        pagination: {
          page: p,
          limit: l,
          total,
          pages: Math.ceil(total / l),
        },
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch users', 500, error.message);
    }
  });

  // Get user watch history
  fastify.get('/history/watch', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { page = 1, limit = 10 } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      const History = (await import('../models/History.js')).default;

      // FIX: Explicitly ask the database to fetch the images and duration so the frontend can render the UI
      const history = await History.find({ userId: request.user._id })
        .populate('episodeId', 'title thumbnailUrl duration')
        .populate('seriesId', 'title coverImage')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(l);

      const total = await History.countDocuments({ userId: request.user._id });

      sendSuccess(reply, {
        history,
        pagination: {
          page: p,
          limit: l,
          total,
          pages: Math.ceil(total / l),
        },
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch watch history', 500, error.message);
    }
  });

  // Get ad unlocks remaining
  fastify.get('/ads/remaining', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const user = await User.findById(request.user._id);

      sendSuccess(reply, {
        adUnlocksRemaining: user.adUnlocksRemaining,
        adUnlocksResetDate: user.adUnlocksResetDate,
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch ad unlocks', 500, error.message);
    }
  });

  // NORMAL USER FOLLOW ENDPOINT
  fastify.post('/:userId/follow', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);

      const { userId } = request.params;
      const targetUser = await User.findById(userId);

      if (!targetUser) return sendError(reply, 'User not found', 404);

      if (targetUser._id.toString() === request.user._id.toString()) {
        return sendError(reply, 'You cannot follow yourself', 400);
      }

      const existingFollow = await UserFollow.findOne({
        followerId: request.user._id,
        followingId: targetUser._id
      });

      if (existingFollow) {
        return sendSuccess(reply, { alreadyFollowing: true, isFollowing: true }, 'You already follow this user');
      }

      await UserFollow.create({
        followerId: request.user._id,
        followingId: targetUser._id
      });

      // NEW: Trigger Central Notification asynchronously
      createNotification({
        userId: targetUser._id,
        type: 'NEW_FOLLOWER',
        title: 'New Follower',
        message: `${request.user.username} is now following you!`,
        targetUrl: '#profile',
        dedupeKey: `user_follow_${request.user._id}_${targetUser._id}`
      }).catch(err => fastify.log.error('Push error:', err));

      // Does NOT increment Creator followers! Kept fully isolated.
      sendSuccess(reply, { alreadyFollowing: false, isFollowing: true }, 'Following user');
    } catch (error) {
      if (error.code === 11000) {
        return sendSuccess(reply, { alreadyFollowing: true, isFollowing: true }, 'You already follow this user');
      }
      fastify.log.error(error);
      sendError(reply, 'Failed to follow user', 500, error.message);
    }
  });

  // NORMAL USER UNFOLLOW ENDPOINT
  fastify.delete('/:userId/follow', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);

      await UserFollow.findOneAndDelete({
        followerId: request.user._id,
        followingId: request.params.userId
      });

      sendSuccess(reply, { isFollowing: false }, 'Unfollowed user successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to unfollow user', 500, error.message);
    }
  });
}
