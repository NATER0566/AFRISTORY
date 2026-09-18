import Creator from '../models/Creator.js';
import User from '../models/User.js';
import Series from '../models/Series.js';
import Follow from '../models/Follow.js'; // NEW: Import dedicated follow model
import UserFollow from '../models/UserFollow.js'; // NEW: Import normal user follow model
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
        uniqueViewers: creator.uniqueViewers || 0, // NEW FEATURE: Pass analytics to frontend
        returningViewers: creator.returningViewers || 0, // NEW FEATURE: Pass analytics to frontend
        totalEarnings: formatDecimal(creator.totalEarnings),
        totalSeries: seriesCount,
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch creator profile', 500, error.message);
    }
  });

  // Become a creator
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

      if (fastify.jwt) {
        const token = fastify.jwt.sign({ 
          id: user._id, 
          _id: user._id,
          role: user.role 
        });
        
        reply.setCookie('token', token, {
          path: '/',
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
          maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
        });
      }

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
        includeDrafts = currentCreator?._id?.toString() === creatorId;
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

      const creators = await Creator.find({})
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
        uniqueViewers: creator.uniqueViewers || 0, // NEW FEATURE: Dashboard Support
        returningViewers: creator.returningViewers || 0, // NEW FEATURE: Dashboard Support
        totalEarnings: formatDecimal(creator.totalEarnings),
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch creator profile', 500, error.message);
    }
  });

  // NEW: Get paginated list of actual users following the logged-in creator (For Creator Studio)
  fastify.get('/me/followers', async (request, reply) => {
    try {
      await verifyCreator(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);

      const creator = await Creator.findOne({ userId: request.user._id });
      if (!creator) return sendError(reply, 'Creator profile not found', 404);

      const { page = 1, limit = 20 } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      const follows = await Follow.find({ creatorId: creator._id })
        .populate({
          path: 'followerId',
          select: 'username profileImage profile'
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(l)
        .lean();

      const total = await Follow.countDocuments({ creatorId: creator._id });

      // For each follower, check if the creator also follows them back (Mutual check)
      const followerDetails = await Promise.all(follows.map(async (f) => {
        const followerUser = f.followerId;
        if (!followerUser) return null;

        // Find if this follower has a creator profile to check reverse follow
        const followerCreator = await Creator.findOne({ userId: followerUser._id });
        let isMutual = false;
        
        if (followerCreator) {
          const reverseCheck = await Follow.findOne({ followerId: creator.userId, creatorId: followerCreator._id });
          isMutual = !!reverseCheck;
        } else {
          // Normal User Follow Check
          const reverseUserCheck = await UserFollow.findOne({ followerId: creator.userId, followingId: followerUser._id });
          isMutual = !!reverseUserCheck;
        }

        return {
          // CRITICAL FIX: To allow "Follow Back", the target MUST be the follower's Creator ID, not the Follow Record ID.
          _id: followerCreator ? followerCreator._id : null,
          followerId: followerUser._id, // Fallback strictly used if they aren't a creator
          userId: followerUser._id,
          username: followerUser.username,
          displayName: followerUser.profile?.displayName || followerUser.username,
          profileImage: followerUser.profile?.avatarUrl || followerUser.profileImage || null,
          createdAt: f.createdAt,
          isMutual,
          isFollowing: isMutual, // Frontend compatibility alias
          isCreator: !!followerCreator // Target proper follow endpoint on frontend
        };
      }));

      sendSuccess(reply, {
        followers: followerDetails.filter(Boolean),
        pagination: { page: p, limit: l, total, pages: Math.ceil(total / l) }
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch followers', 500, error.message);
    }
  });

  // SECURE & ATOMIC FOLLOW ENDPOINT (Prevents self-follows, duplicate spam, and handles counts securely)
  fastify.post('/:creatorId/follow', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { creatorId } = request.params;
      const targetCreator = await Creator.findById(creatorId);

      if (!targetCreator) {
        return sendError(reply, 'Creator not found', 404);
      }

      // 1. REJECT SELF-FOLLOWS AT APPLICATION LEVEL
      if (targetCreator.userId.toString() === request.user._id.toString()) {
        return sendError(reply, 'You cannot follow yourself', 400);
      }

      // 2. ATOMIC UPSERT USING UNIQUE INDEX TO PREVENT DUPLICATE / SPAM WRITES
      const existingFollow = await Follow.findOne({
        followerId: request.user._id,
        creatorId: targetCreator._id
      });

      if (existingFollow) {
        return sendSuccess(reply, { 
          totalFollowers: targetCreator.totalFollowers, 
          alreadyFollowing: true,
          isFollowing: true 
        }, 'You already follow this creator');
      }

      // Create new secure follow relation
      await Follow.create({
        followerId: request.user._id,
        creatorId: targetCreator._id
      });

      // Increment count safely
      targetCreator.totalFollowers = (targetCreator.totalFollowers || 0) + 1;
      await targetCreator.save();

      sendSuccess(reply, { 
        totalFollowers: targetCreator.totalFollowers, 
        alreadyFollowing: false,
        isFollowing: true 
      }, 'Following creator');
    } catch (error) {
      // Handle unique index race-condition safely if dual simultaneous requests hit
      if (error.code === 11000) {
        const creator = await Creator.findById(request.params.creatorId);
        return sendSuccess(reply, { 
          totalFollowers: creator?.totalFollowers || 0, 
          alreadyFollowing: true,
          isFollowing: true 
        }, 'You already follow this creator');
      }
      fastify.log.error(error);
      sendError(reply, 'Failed to follow creator', 500, error.message);
    }
  });

  // UNFOLLOW ENDPOINT (Idempotent, decrements safely without negative counts)
  fastify.delete('/:creatorId/follow', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);

      const { creatorId } = request.params;
      const targetCreator = await Creator.findById(creatorId);
      if (!targetCreator) return sendError(reply, 'Creator not found', 404);

      const deleted = await Follow.findOneAndDelete({
        followerId: request.user._id,
        creatorId: targetCreator._id
      });

      if (deleted) {
        targetCreator.totalFollowers = Math.max(0, (targetCreator.totalFollowers || 1) - 1);
        await targetCreator.save();
      }

      sendSuccess(reply, { 
        totalFollowers: targetCreator.totalFollowers, 
        isFollowing: false 
      }, 'Unfollowed creator successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to unfollow creator', 500, error.message);
    }
  });
}
