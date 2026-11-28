import mongoose from 'mongoose';
import Creator from '../models/Creator.js';
import CreatorEarning from '../models/CreatorEarning.js';
import Wallet from '../models/Wallet.js';
import User from '../models/User.js';
import Series from '../models/Series.js';
import Follow from '../models/Follow.js';
import UserFollow from '../models/UserFollow.js';
import { verifyAuth, verifyCreator } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { paginate, formatDecimal } from '../utils/helpers.js';
import { createNotification } from '../utils/notificationService.js';

const ELIGIBLE_CREATOR_SOURCES = ['PURCHASED', 'DIRECT_AD', 'PROMO_AD', 'VIP_CREDIT'];

async function buildCreatorEarningsSummary({ creatorId, userId }) {
  const [wallet, grouped] = await Promise.all([
    Wallet.findOne({ userId }).lean(),
    CreatorEarning.aggregate([
      {
        $match: {
          creatorId: new mongoose.Types.ObjectId(creatorId),
          source: { $in: ELIGIBLE_CREATOR_SOURCES },
        },
      },
      {
        $group: {
          _id: {
            source: '$source',
            status: '$status',
          },
          totalNaira: {
            $sum: { $toDouble: { $ifNull: ['$creatorAmountNaira', 0] } },
          },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const bySource = {
    PURCHASED: 0,
    DIRECT_AD: 0,
    PROMO_AD: 0,
    VIP_CREDIT: 0,
  };
  const byStatusFromLedger = {
    PENDING: 0,
    AVAILABLE: 0,
    WITHDRAWN: 0,
  };

  for (const row of grouped) {
    const src = row._id?.source;
    const st = row._id?.status;
    const val = Number(row.totalNaira || 0);
    if (src && Object.prototype.hasOwnProperty.call(bySource, src)) {
      bySource[src] += val;
    }
    if (st && Object.prototype.hasOwnProperty.call(byStatusFromLedger, st)) {
      byStatusFromLedger[st] += val;
    }
  }

  const pendingCreatorEarnings = wallet
    ? formatDecimal(wallet.pendingCreatorEarnings || 0)
    : formatDecimal(byStatusFromLedger.PENDING);
  const availableCreatorEarnings = wallet
    ? formatDecimal(wallet.availableCreatorEarnings || 0)
    : formatDecimal(byStatusFromLedger.AVAILABLE);
  const withdrawnCreatorEarnings = wallet
    ? formatDecimal(wallet.withdrawnCreatorEarnings || 0)
    : formatDecimal(byStatusFromLedger.WITHDRAWN);

  const totalEarnings = formatDecimal(
    Number(pendingCreatorEarnings) +
      Number(availableCreatorEarnings) +
      Number(withdrawnCreatorEarnings)
  );

  return {
    purchasedCoinEarnings: formatDecimal(bySource.PURCHASED),
    directAdEarnings: formatDecimal(bySource.DIRECT_AD),
    promoAdEarnings: formatDecimal(bySource.PROMO_AD),
    vipEarnings: formatDecimal(bySource.VIP_CREDIT),
    pendingCreatorEarnings,
    availableCreatorEarnings,
    withdrawnCreatorEarnings,
    totalEarnings,
    breakdownBySource: {
      PURCHASED: formatDecimal(bySource.PURCHASED),
      DIRECT_AD: formatDecimal(bySource.DIRECT_AD),
      PROMO_AD: formatDecimal(bySource.PROMO_AD),
      VIP_CREDIT: formatDecimal(bySource.VIP_CREDIT),
    },
    breakdownByStatus: {
      PENDING: pendingCreatorEarnings,
      AVAILABLE: availableCreatorEarnings,
      WITHDRAWN: withdrawnCreatorEarnings,
    },
  };
}

export default async function creatorRoutes(fastify) {
  // Get top creators
  fastify.get('/top/creators', async (request, reply) => {
    try {
      const limit = Math.min(50, Math.max(1, parseInt(request.query?.limit, 10) || 10));

      const creators = await Creator.find({})
        .sort({ totalViews: -1 })
        .limit(limit)
        .populate('userId', 'username profileImage profile');

      return sendSuccess(
        reply,
        creators.map((c) => ({
          ...c.toObject(),
          totalViews: formatDecimal(c.totalViews),
          totalEarnings: formatDecimal(c.totalEarnings),
        }))
      );
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to fetch top creators', 500, error.message);
    }
  });

  // Get my creator profile + separated earnings breakdown
  fastify.get('/me/profile', async (request, reply) => {
    try {
      await verifyCreator(request, reply);
      if (reply.sent) return;

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const creator = await Creator.findOne({ userId: request.user._id });
      if (!creator) {
        return sendError(reply, 'Creator profile not found', 404);
      }

      if (creator.isVerified && creator.applicationStatus !== 'APPROVED') {
        creator.applicationStatus = 'APPROVED';
        await creator.save();
      }

      const earningsSummary = await buildCreatorEarningsSummary({
        creatorId: creator._id,
        userId: request.user._id,
      });

      return sendSuccess(reply, {
        ...creator.toObject(),
        applicationStatus: creator.isVerified ? 'APPROVED' : creator.applicationStatus || 'PENDING',
        totalViews: formatDecimal(creator.totalViews),
        uniqueViewers: creator.uniqueViewers || 0,
        returningViewers: creator.returningViewers || 0,
        totalEarnings: earningsSummary.totalEarnings,
        earnings: earningsSummary,
      });
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to fetch creator profile', 500, error.message);
    }
  });

  // Get separated creator earnings summary & paginated ledger records
  fastify.get('/me/earnings', async (request, reply) => {
    try {
      await verifyCreator(request, reply);
      if (reply.sent) return;
      if (!request.user) return sendError(reply, 'Unauthorized', 401);

      const creator = await Creator.findOne({ userId: request.user._id });
      if (!creator) return sendError(reply, 'Creator profile not found', 404);

      const { page = 1, limit = 15, source, status } = request.query || {};
      const { skip, limit: pageLimit, page: currentPage } = paginate(page, limit);

      const filter = {
        creatorId: creator._id,
        source: { $in: ELIGIBLE_CREATOR_SOURCES },
      };
      if (source && ELIGIBLE_CREATOR_SOURCES.includes(String(source).toUpperCase())) {
        filter.source = String(source).toUpperCase();
      }
      if (status && ['PENDING', 'AVAILABLE', 'WITHDRAWN'].includes(String(status).toUpperCase())) {
        filter.status = String(status).toUpperCase();
      }

      const [summary, records, total] = await Promise.all([
        buildCreatorEarningsSummary({ creatorId: creator._id, userId: request.user._id }),
        CreatorEarning.find(filter)
          .populate('episodeId', 'title episodeNumber')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(pageLimit)
          .lean(),
        CreatorEarning.countDocuments(filter),
      ]);

      return sendSuccess(reply, {
        summary,
        records: records.map((rec) => ({
          ...rec,
          grossNaira: formatDecimal(rec.grossNaira || 0),
          creatorAmountNaira: formatDecimal(rec.creatorAmountNaira || 0),
          platformAmountNaira: formatDecimal(rec.platformAmountNaira || 0),
        })),
        pagination: {
          page: currentPage,
          limit: pageLimit,
          total,
          pages: Math.ceil(total / pageLimit),
        },
      });
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to fetch creator earnings', 500, error.message);
    }
  });

  // Get paginated list of actual users following the logged-in creator
  fastify.get('/me/followers', async (request, reply) => {
    try {
      await verifyCreator(request, reply);
      if (reply.sent) return;
      if (!request.user) return sendError(reply, 'Unauthorized', 401);

      const creator = await Creator.findOne({ userId: request.user._id });
      if (!creator) return sendError(reply, 'Creator profile not found', 404);

      const { page = 1, limit = 20 } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      const [follows, total] = await Promise.all([
        Follow.find({ creatorId: creator._id })
          .populate({
            path: 'followerId',
            select: 'username profileImage profile',
          })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(l)
          .lean(),
        Follow.countDocuments({ creatorId: creator._id }),
      ]);

      const validFollows = follows.filter((f) => f.followerId);
      const followerUserIds = validFollows.map((f) => f.followerId._id);

      const followerCreators = await Creator.find({ userId: { $in: followerUserIds } })
        .select('_id userId')
        .lean();

      const creatorByUserId = new Map(followerCreators.map((fc) => [fc.userId.toString(), fc]));
      const followerCreatorIds = followerCreators.map((fc) => fc._id);

      const [reverseCreatorFollows, reverseUserFollows] = await Promise.all([
        followerCreatorIds.length > 0
          ? Follow.find({
              followerId: creator.userId,
              creatorId: { $in: followerCreatorIds },
            })
              .select('creatorId')
              .lean()
          : Promise.resolve([]),
        followerUserIds.length > 0
          ? UserFollow.find({
              followerId: creator.userId,
              followingId: { $in: followerUserIds },
            })
              .select('followingId')
              .lean()
          : Promise.resolve([]),
      ]);

      const followedCreatorIdSet = new Set(reverseCreatorFollows.map((r) => r.creatorId.toString()));
      const followedUserIdSet = new Set(reverseUserFollows.map((r) => r.followingId.toString()));

      const followerDetails = validFollows.map((f) => {
        const followerUser = f.followerId;
        const userIdStr = followerUser._id.toString();
        const followerCreator = creatorByUserId.get(userIdStr) || null;

        const isMutual = followerCreator
          ? followedCreatorIdSet.has(followerCreator._id.toString())
          : followedUserIdSet.has(userIdStr);

        return {
          _id: followerCreator ? followerCreator._id : null,
          followerId: followerUser._id,
          userId: followerUser._id,
          username: followerUser.username,
          displayName: followerUser.profile?.displayName || followerUser.username,
          profileImage: followerUser.profile?.avatarUrl || followerUser.profileImage || null,
          createdAt: f.createdAt,
          isMutual,
          isFollowing: isMutual,
          isCreator: !!followerCreator,
        };
      });

      return sendSuccess(reply, {
        followers: followerDetails,
        pagination: { page: p, limit: l, total, pages: Math.ceil(total / l) },
      });
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to fetch followers', 500, error.message);
    }
  });

  // Get creator profile
  fastify.get('/:creatorId', async (request, reply) => {
    try {
      const { creatorId } = request.params;
      if (!mongoose.Types.ObjectId.isValid(creatorId)) {
        return sendError(reply, 'Creator not found', 404);
      }

      const creator = await Creator.findById(creatorId).populate(
        'userId',
        'username profileImage profile'
      );

      if (!creator) {
        return sendError(reply, 'Creator not found', 404);
      }

      const seriesCount = await Series.countDocuments({
        creatorId,
        isPublished: true,
      });

      return sendSuccess(reply, {
        ...creator.toObject(),
        totalViews: formatDecimal(creator.totalViews),
        uniqueViewers: creator.uniqueViewers || 0,
        returningViewers: creator.returningViewers || 0,
        totalEarnings: formatDecimal(creator.totalEarnings),
        totalSeries: seriesCount,
      });
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to fetch creator profile', 500, error.message);
    }
  });

  // Become a creator
  fastify.post('/become-creator', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (reply.sent) return;

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { brandName, bio, socialLinks } = request.body || {};

      const user = await User.findById(request.user._id);
      if (!user) {
        return sendError(reply, 'User not found', 404);
      }

      const finalBrandName = String(brandName || user.username || 'Creator').trim();

      let creator = await Creator.findOne({ userId: request.user._id });

      if (creator) {
        if (creator.applicationStatus === 'REJECTED') {
          creator.brandName = finalBrandName;
          creator.bio = bio || '';
          if (socialLinks) creator.socialLinks = socialLinks;
          creator.applicationStatus = 'PENDING';
          creator.rejectionReason = null;
          creator.isVerified = false;
          await creator.save();
        } else {
          const statusMsg =
            creator.applicationStatus === 'PENDING'
              ? 'Your application is currently under review.'
              : 'You are already an approved creator.';
          return sendError(reply, statusMsg, 409);
        }
      } else {
        creator = new Creator({
          userId: request.user._id,
          brandName: finalBrandName,
          bio: bio || '',
          socialLinks: socialLinks || {},
          applicationStatus: 'PENDING',
          isVerified: false,
        });
        await creator.save();
      }

      if (String(user.role).toUpperCase() !== 'ADMIN') {
        user.role = 'CREATOR';
        await user.save();
      }

      if (fastify.jwt) {
        const token = fastify.jwt.sign({
          id: user._id,
          _id: user._id,
          role: user.role,
        });

        reply.setCookie('token', token, {
          path: '/',
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });
      }

      return sendSuccess(reply, creator, 'Creator application submitted successfully', 201);
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to process creator application', 500, error.message);
    }
  });

  // Update creator profile
  fastify.put('/profile/update', async (request, reply) => {
    try {
      await verifyCreator(request, reply);
      if (reply.sent) return;

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { brandName, bio, socialLinks, profileImage, coverImage, bankAccount } =
        request.body || {};

      const creator = await Creator.findOne({ userId: request.user._id });

      if (!creator) {
        return sendError(reply, 'Creator profile not found', 404);
      }

      if (brandName) creator.brandName = brandName;
      if (bio !== undefined) creator.bio = bio;
      if (socialLinks) creator.socialLinks = { ...creator.socialLinks, ...socialLinks };
      if (profileImage) creator.profileImage = profileImage;
      if (coverImage) creator.coverImage = coverImage;
      if (bankAccount) creator.bankAccount = bankAccount;

      await creator.save();

      return sendSuccess(reply, creator, 'Creator profile updated successfully');
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to update creator profile', 500, error.message);
    }
  });

  // Get creator series
  fastify.get('/:creatorId/series', async (request, reply) => {
    try {
      const { creatorId } = request.params;
      if (!mongoose.Types.ObjectId.isValid(creatorId)) {
        return sendError(reply, 'Creator not found', 404);
      }

      const { page = 1, limit = 10 } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);
      let includeDrafts = false;
      if (request.cookies?.token && (await verifyAuth(request, reply, false).catch(() => false))) {
        const currentCreator = await Creator.findOne({ userId: request.user._id });
        includeDrafts = currentCreator?._id?.toString() === creatorId;
      }
      const query = includeDrafts ? { creatorId } : { creatorId, isPublished: true };

      const [series, total] = await Promise.all([
        Series.find(query).skip(skip).limit(l).sort({ createdAt: -1 }),
        Series.countDocuments(query),
      ]);

      return sendSuccess(reply, {
        series: series.map((s) => {
          const obj = s.toObject();
          const completed = Boolean(obj.isCompleted || obj.completed || obj.status === 'COMPLETED');
          return {
            ...obj,
            isCompleted: completed,
            completed,
            rating: formatDecimal(obj.rating),
          };
        }),
        pagination: {
          page: p,
          limit: l,
          total,
          pages: Math.ceil(total / l),
        },
      });
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to fetch creator series', 500, error.message);
    }
  });

  // Atomic Follow Endpoint
  fastify.post('/:creatorId/follow', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (reply.sent) return;

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { creatorId } = request.params;
      if (!mongoose.Types.ObjectId.isValid(creatorId)) {
        return sendError(reply, 'Creator not found', 404);
      }

      const targetCreator = await Creator.findById(creatorId);
      if (!targetCreator) {
        return sendError(reply, 'Creator not found', 404);
      }

      if (targetCreator.userId.toString() === request.user._id.toString()) {
        return sendError(reply, 'You cannot follow yourself', 400);
      }

      const existingFollow = await Follow.findOne({
        followerId: request.user._id,
        creatorId: targetCreator._id,
      });

      if (existingFollow) {
        return sendSuccess(
          reply,
          {
            totalFollowers: targetCreator.totalFollowers,
            alreadyFollowing: true,
            isFollowing: true,
          },
          'You already follow this creator'
        );
      }

      await Follow.create({
        followerId: request.user._id,
        creatorId: targetCreator._id,
      });

      const updatedCreator = await Creator.findByIdAndUpdate(
        targetCreator._id,
        { $inc: { totalFollowers: 1 } },
        { new: true }
      );

      const followerUser = await User.findById(request.user._id).select('profile profileImage');
      const followerAvatar = followerUser?.profile?.avatarUrl || followerUser?.profileImage || null;

      createNotification({
        userId: targetCreator.userId,
        type: 'NEW_FOLLOWER',
        title: 'New Follower 🎉',
        message: `${request.user.username} is now following you!`,
        targetUrl: '#profile',
        icon: 'https://ui-avatars.com/api/?name=AfriStory&background=d4a017&color=fff&size=192',
        image: followerAvatar,
        dedupeKey: `follow_${request.user._id}_${targetCreator._id}`,
      }).catch((err) => fastify.log.error('Push error:', err));

      return sendSuccess(
        reply,
        {
          totalFollowers: updatedCreator?.totalFollowers ?? targetCreator.totalFollowers + 1,
          alreadyFollowing: false,
          isFollowing: true,
        },
        'Following creator'
      );
    } catch (error) {
      if (error.code === 11000) {
        const creator = await Creator.findById(request.params.creatorId);
        return sendSuccess(
          reply,
          {
            totalFollowers: creator?.totalFollowers || 0,
            alreadyFollowing: true,
            isFollowing: true,
          },
          'You already follow this creator'
        );
      }
      fastify.log.error(error);
      return sendError(reply, 'Failed to follow creator', 500, error.message);
    }
  });

  // Unfollow Endpoint
  fastify.delete('/:creatorId/follow', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (reply.sent) return;
      if (!request.user) return sendError(reply, 'Unauthorized', 401);

      const { creatorId } = request.params;
      if (!mongoose.Types.ObjectId.isValid(creatorId)) {
        return sendError(reply, 'Creator not found', 404);
      }

      const targetCreator = await Creator.findById(creatorId);
      if (!targetCreator) return sendError(reply, 'Creator not found', 404);

      const deleted = await Follow.findOneAndDelete({
        followerId: request.user._id,
        creatorId: targetCreator._id,
      });

      let latestFollowers = targetCreator.totalFollowers || 0;
      if (deleted) {
        const updatedCreator = await Creator.findOneAndUpdate(
          { _id: targetCreator._id, totalFollowers: { $gt: 0 } },
          { $inc: { totalFollowers: -1 } },
          { new: true }
        );
        latestFollowers = updatedCreator ? updatedCreator.totalFollowers : 0;
      }

      return sendSuccess(
        reply,
        {
          totalFollowers: latestFollowers,
          isFollowing: false,
        },
        'Unfollowed creator successfully'
      );
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to unfollow creator', 500, error.message);
    }
  });
}
