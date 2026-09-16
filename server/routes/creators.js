import Creator from '../models/Creator.js';
import User from '../models/User.js';
import Series from '../models/Series.js';
import { verifyAuth, verifyCreator } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { paginate, formatDecimal } from '../utils/helpers.js';

export default async function creatorRoutes(fastify, opts) {
  // Get creator profile
  fastify.get('/:creatorId', async (request, reply) => {
    try {
      const { creatorId } = request.params;

      const creator = await Creator.findById(creatorId).populate('userId', 'username profileImage profile');

      if (!creator) {
        return sendError(reply, 'Creator not found', 404);
      }

      const seriesCount = await Series.countDocuments({
        creatorId,
        isPublished: true,
      });

      sendSuccess(reply, {
        ...creator.toObject(),
        totalViews: formatDecimal(creator.totalViews),
        totalEarnings: formatDecimal(creator.totalEarnings),
        totalSeries: seriesCount,
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch creator profile', 500, error.message);
    }
  });

  // Become a creator (FIXED: No longer requires a custom brand name)
  fastify.post('/become-creator', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { brandName, bio, socialLinks } = request.body || {};

      const existingCreator = await Creator.findOne({ userId: request.user._id });
      if (existingCreator) {
        return sendError(reply, 'You are already a creator', 409);
      }

      // Fetch user to use their username as the default brand name
      const user = await User.findById(request.user._id);
      
      // If no brandName is provided, default to their username
      const finalBrandName = brandName || user.username || 'Creator';

      const creator = new Creator({
        userId: request.user._id,
        brandName: finalBrandName,
        bio: bio || '',
        socialLinks: socialLinks || {},
      });

      await creator.save();

      // Update user role
      user.role = 'CREATOR';
      await user.save();

      sendSuccess(reply, creator, 'Creator account created successfully', 201);
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to create creator account', 500, error.message);
    }
  });

  // Update creator profile
  fastify.put('/profile/update', async (request, reply) => {
    try {
      await verifyCreator(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { brandName, bio, socialLinks, profileImage, coverImage, bankAccount } = request.body || {};

      const creator = await Creator.findOne({ userId: request.user._id });

      if (!creator) {
        return sendError(reply, 'Creator profile not found', 404);
      }

      if (brandName) creator.brandName = brandName;
      if (bio) creator.bio = bio;
      if (socialLinks) creator.socialLinks = { ...creator.socialLinks, ...socialLinks };
      if (profileImage) creator.profileImage = profileImage;
      if (coverImage) creator.coverImage = coverImage;
      if (bankAccount) creator.bankAccount = bankAccount;

      await creator.save();

      sendSuccess(reply, creator, 'Creator profile updated successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to update creator profile', 500, error.message);
    }
  });

  // Get creator series
  fastify.get('/:creatorId/series', async (request, reply) => {
    try {
      const { creatorId } = request.params;
      const { page = 1, limit = 10 } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);
      let includeDrafts = false;
      if (request.cookies?.token && await verifyAuth(request, reply)) {
        const currentCreator = await Creator.findOne({ userId: request.user._id });
        includeDrafts = currentCreator?._id.toString() === creatorId;
      }
      const query = includeDrafts ? { creatorId } : { creatorId, isPublished: true };

      const series = await Series.find(query)
        .skip(skip)
        .limit(l)
        .sort({ createdAt: -1 });

      const total = await Series.countDocuments(query);

      sendSuccess(reply, {
        series: series.map(s => ({
          ...s.toObject(),
          rating: formatDecimal(s.rating),
        })),
        pagination: {
          page: p,
          limit: l,
          total,
          pages: Math.ceil(total / l),
        },
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch creator series', 500, error.message);
    }
  });

  // Get top creators
  fastify.get('/top/creators', async (request, reply) => {
    try {
      const { limit = 10 } = request.query;

      const creators = await Creator.find({ isVerified: true })
        .sort({ totalViews: -1 })
        .limit(parseInt(limit))
        .populate('userId', 'username profileImage profile');

      sendSuccess(reply, creators.map(c => ({
        ...c.toObject(),
        totalViews: formatDecimal(c.totalViews),
        totalEarnings: formatDecimal(c.totalEarnings),
      })));
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch top creators', 500, error.message);
    }
  });

  // Get my creator profile
  fastify.get('/me/profile', async (request, reply) => {
    try {
      await verifyCreator(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const creator = await Creator.findOne({ userId: request.user._id });

      if (!creator) {
        return sendError(reply, 'Creator profile not found', 404);
      }

      sendSuccess(reply, {
        ...creator.toObject(),
        totalViews: formatDecimal(creator.totalViews),
        totalEarnings: formatDecimal(creator.totalEarnings),
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch creator profile', 500, error.message);
    }
  });
}
