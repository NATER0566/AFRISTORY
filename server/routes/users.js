import User from '../models/User.js';
import Wallet from '../models/Wallet.js';
import { verifyAuth } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { paginate, formatDecimal } from '../utils/helpers.js';

export default async function userRoutes(fastify, opts) {
  // Get user profile
  fastify.get('/:userId', async (request, reply) => {
    try {
      const { userId } = request.params;

      const user = await User.findById(userId).select('-passwordHash -pinHash');

      if (!user) {
        return sendError(reply, 'User not found', 404);
      }

      const wallet = await Wallet.findOne({ userId });

      sendSuccess(reply, {
        user,
        wallet: wallet
          ? {
              storyCoins: formatDecimal(wallet.storyCoins),
              lockedEarnings: formatDecimal(wallet.lockedEarnings),
              totalWithdrawn: formatDecimal(wallet.totalWithdrawn),
              totalEarned: formatDecimal(wallet.totalEarned),
            }
          : null,
      });
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

      const { username, email, profileImage } = request.body || {};

      const user = await User.findById(request.user._id);

      if (username) user.username = username;
      if (email) user.email = email;
      if (profileImage) user.profileImage = profileImage;

      await user.save();

      sendSuccess(reply, user.toJSON(), 'Profile updated successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to update profile', 500, error.message);
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

      const history = await History.find({ userId: request.user._id })
        .populate('episodeId', 'title')
        .populate('seriesId', 'title')
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
}
