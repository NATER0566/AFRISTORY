import mongoose from 'mongoose';
import Series from '../models/Series.js';
import Episode from '../models/Episode.js';
import Creator from '../models/Creator.js';
import Unlock from '../models/Unlock.js';
import Follow from '../models/Follow.js';
import Like from '../models/Like.js';
import { verifyAuth, verifyCreator } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { paginate, formatDecimal } from '../utils/helpers.js';

function extractHookStart(episode) {
  if (episode && Number.isFinite(Number(episode.hookStart)) && Number(episode.hookStart) > 0) {
    return Math.floor(Number(episode.hookStart));
  }
  const rawUrl = episode?.mediaUrl || '';
  const match = String(rawUrl).match(/#t=(\d+(?:\.\d+)?)/i);
  return match ? Math.floor(Number(match[1]) || 0) : 0;
}

function normalizeSeriesPayload(seriesDoc) {
  const obj = typeof seriesDoc.toObject === 'function' ? seriesDoc.toObject() : { ...seriesDoc };
  const completed = Boolean(obj.isCompleted || obj.completed || obj.status === 'COMPLETED');
  return {
    ...obj,
    isCompleted: completed,
    completed,
    rating: formatDecimal(obj.rating),
  };
}

export default async function seriesRoutes(fastify, opts) {
  fastify.get('/discover/all', async (request, reply) => {
    try {
      if (request.cookies?.token) {
        await verifyAuth(request, reply, false).catch(() => false);
      }
      const { page = 1, limit = 10, genre, culturalCategory, culture, language, status, sort = 'newest' } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      const query = { isPublished: true, status: { $ne: 'DRAFT' } };

      const hasActiveSubscription =
        request.user?.subscriptionExpiresAt && new Date(request.user.subscriptionExpiresAt) > new Date();
      if (!hasActiveSubscription) {
        query.isPremiumExclusive = { $ne: true };
      }

      if (genre) {
        query.$or = [
          { primaryGenre: genre },
          { secondaryGenres: genre },
          { genre },
        ];
      }

      const selectedCulture = culturalCategory || culture;
      if (selectedCulture) {
        query.culture = selectedCulture;
      }

      if (language) {
        query.language = language;
      }

      if (status && ['ONGOING', 'COMPLETED'].includes(String(status).toUpperCase())) {
        query.status = String(status).toUpperCase();
      }

      let sortBy = { createdAt: -1 };
      if (sort === 'trending') {
        sortBy = { totalViews: -1, createdAt: -1 };
      } else if (sort === 'rating') {
        sortBy = { rating: -1, createdAt: -1 };
      }

      const [series, total] = await Promise.all([
        Series.find(query)
          .populate('creatorId', 'brandName profileImage')
          .sort(sortBy)
          .skip(skip)
          .limit(l),
        Series.countDocuments(query),
      ]);

      sendSuccess(reply, {
        series: series.map(normalizeSeriesPayload),
        pagination: {
          page: p,
          limit: l,
          total,
          pages: Math.ceil(total / l),
        },
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch series', 500, error.message);
    }
  });

  fastify.get('/:seriesId', async (request, reply) => {
    try {
      if (request.cookies?.token) {
        await verifyAuth(request, reply, false).catch(() => false);
      }
      const { seriesId } = request.params;
      if (!mongoose.Types.ObjectId.isValid(seriesId)) {
        return sendError(reply, 'Series not found', 404);
      }

      const series = await Series.findById(seriesId).populate('creatorId');

      if (!series) {
        return sendError(reply, 'Series not found', 404);
      }

      if (!series.isPublished) {
        const ownerUserId = series.creatorId?.userId?.toString();
        const requesterId = request.user?._id?.toString();
        const isAdmin = String(request.user?.role || '').toUpperCase() === 'ADMIN';
        if (!requesterId || (ownerUserId !== requesterId && !isAdmin)) {
          return sendError(reply, 'Series not found', 404);
        }
      }

      if (series.isPremiumExclusive && (!request.user || new Date(request.user.subscriptionExpiresAt) <= new Date())) {
        return sendError(reply, 'Premium subscription required', 403);
      }

      const episodeCount = await Episode.countDocuments({
        seriesId,
        isPublished: true,
      });

      sendSuccess(reply, {
        ...normalizeSeriesPayload(series),
        episodeCount,
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch series', 500, error.message);
    }
  });

  fastify.post('/create', async (request, reply) => {
    try {
      await verifyCreator(request, reply);
      if (reply.sent) return;
      if (!request.user) return sendError(reply, 'Unauthorized', 401);

      const {
        title,
        description,
        coverImage,
        tags,
        genre,
        culturalCategory,
        culture,
        language,
        isPublished,
        isPremiumExclusive,
        isCompleted,
        completed,
        status,
      } = request.body || {};

      if (!title || !coverImage) {
        return sendError(reply, 'Title and cover image are required', 400);
      }

      const creator = await Creator.findOne({ userId: request.user._id });
      if (!creator) return sendError(reply, 'Creator profile not found', 404);

      const doneFlag = Boolean(isCompleted || completed || String(status || '').toUpperCase() === 'COMPLETED');
      const normalizedCulture = Array.isArray(culture)
        ? culture
        : (culturalCategory ? [String(culturalCategory).trim()] : []);

      const series = new Series({
        creatorId: creator._id,
        creator: creator._id,
        title,
        description: description || '',
        coverImage,
        tags: Array.isArray(tags) ? tags : [],
        genre: genre || '',
        culture: normalizedCulture,
        language: language || 'English',
        status: doneFlag ? 'COMPLETED' : 'ONGOING',
        isCompleted: doneFlag,
        completed: doneFlag,
        completedAt: doneFlag ? new Date() : null,
        isPublished: isPublished === true,
        isPremiumExclusive: isPremiumExclusive === true,
      });

      await series.save();
      sendSuccess(reply, normalizeSeriesPayload(series), 'Series created successfully', 201);
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to create series', 500, error.message);
    }
  });

  const handleSeriesUpdate = async (request, reply) => {
    try {
      await verifyCreator(request, reply);
      if (reply.sent) return;
      if (!request.user) return sendError(reply, 'Unauthorized', 401);

      const { seriesId } = request.params;
      if (!mongoose.Types.ObjectId.isValid(seriesId)) {
        return sendError(reply, 'Series not found', 404);
      }

      const {
        title,
        description,
        coverImage,
        tags,
        status,
        genre,
        culturalCategory,
        culture,
        language,
        isPublished,
        isPremiumExclusive,
        isCompleted,
        completed,
      } = request.body || {};

      const series = await Series.findById(seriesId);
      if (!series) return sendError(reply, 'Series not found', 404);

      const creator = await Creator.findOne({ userId: request.user._id });
      const isAdmin = String(request.user.role || '').toUpperCase() === 'ADMIN';
      if (!isAdmin && (!creator || series.creatorId.toString() !== creator._id.toString())) {
        return sendError(reply, 'Forbidden - not series creator', 403);
      }

      if (title !== undefined && String(title).trim()) series.title = String(title).trim();
      if (description !== undefined) series.description = description;
      if (coverImage) series.coverImage = coverImage;
      if (Array.isArray(tags)) series.tags = tags;
      if (genre !== undefined) series.genre = genre;
      if (Array.isArray(culture)) {
        series.culture = culture;
      } else if (culturalCategory) {
        series.culture = [String(culturalCategory).trim()];
      }
      if (language) series.language = language;
      if (isPublished !== undefined) series.isPublished = Boolean(isPublished);
      if (isPremiumExclusive !== undefined) series.isPremiumExclusive = Boolean(isPremiumExclusive);

      if (isCompleted !== undefined || completed !== undefined) {
        const doneFlag = Boolean(isCompleted ?? completed);
        series.isCompleted = doneFlag;
        series.completed = doneFlag;
        series.status = doneFlag ? 'COMPLETED' : 'ONGOING';
        series.completedAt = doneFlag ? (series.completedAt || new Date()) : null;
      } else if (status) {
        const upperStatus = String(status).toUpperCase();
        series.status = upperStatus;
        const doneFlag = upperStatus === 'COMPLETED';
        series.isCompleted = doneFlag;
        series.completed = doneFlag;
        series.completedAt = doneFlag ? (series.completedAt || new Date()) : null;
      }

      await series.save();
      sendSuccess(reply, normalizeSeriesPayload(series), 'Series updated successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to update series', 500, error.message);
    }
  };

  fastify.put('/:seriesId/update', handleSeriesUpdate);
  fastify.put('/:seriesId', handleSeriesUpdate);
  fastify.patch('/:seriesId/complete', handleSeriesUpdate);
  fastify.patch('/:seriesId/status', handleSeriesUpdate);

  fastify.delete('/:seriesId', async (request, reply) => {
    try {
      await verifyCreator(request, reply);
      if (reply.sent) return;
      if (!request.user) return sendError(reply, 'Unauthorized', 401);

      const { seriesId } = request.params;
      if (!mongoose.Types.ObjectId.isValid(seriesId)) {
        return sendError(reply, 'Series not found', 404);
      }

      const series = await Series.findById(seriesId);
      if (!series) return sendError(reply, 'Series not found', 404);

      const creator = await Creator.findOne({ userId: request.user._id });
      const isAdmin = String(request.user.role || '').toUpperCase() === 'ADMIN';
      if (!isAdmin && (!creator || series.creatorId.toString() !== creator._id.toString())) {
        return sendError(reply, 'Forbidden - not series creator', 403);
      }

      await Series.findByIdAndDelete(seriesId);
      await Episode.deleteMany({ seriesId });
      sendSuccess(reply, null, 'Series deleted successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to delete series', 500, error.message);
    }
  });

  fastify.get('/:seriesId/episodes', async (request, reply) => {
    try {
      if (request.cookies?.token) {
        await verifyAuth(request, reply, false).catch(() => false);
      }
      const { seriesId } = request.params;
      if (!mongoose.Types.ObjectId.isValid(seriesId)) {
        return sendError(reply, 'Series not found', 404);
      }

      const { page = 1, limit = 100 } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      const seriesDoc = await Series.findById(seriesId)
        .populate({
          path: 'creatorId',
          select: 'brandName profileImage userId',
          populate: { path: 'userId', select: 'profile profileImage username' },
        })
        .lean();

      if (seriesDoc) {
        const doneFlag = Boolean(seriesDoc.isCompleted || seriesDoc.completed || seriesDoc.status === 'COMPLETED');
        seriesDoc.isCompleted = doneFlag;
        seriesDoc.completed = doneFlag;

        if (seriesDoc.creatorId) {
          const user = seriesDoc.creatorId.userId;
          seriesDoc.creatorId.profileImage =
            seriesDoc.creatorId.profileImage || user?.profile?.avatarUrl || user?.profileImage || null;
        }
      }

      const [episodes, total] = await Promise.all([
        Episode.find({ seriesId, isPublished: true })
          .sort({ episodeNumber: 1, createdAt: 1 })
          .skip(skip)
          .limit(l)
          .lean(),
        Episode.countDocuments({ seriesId, isPublished: true }),
      ]);

      const hasActiveSubscription =
        request.user && request.user.subscriptionExpiresAt && new Date(request.user.subscriptionExpiresAt) > new Date();

      let userUnlocks = [];
      let userLikes = [];
      let isFollowingCreator = false;

      if (request.user) {
        const episodeIds = episodes.map(ep => ep._id);
        const [unlocks, likes, followCheck] = await Promise.all([
          Unlock.find({
            userId: request.user._id,
            episodeId: { $in: episodeIds },
            isActive: true,
            $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
          }).lean(),
          Like.find({
            userId: request.user._id,
            episodeId: { $in: episodeIds },
          }).lean(),
          seriesDoc?.creatorId?._id
            ? Follow.findOne({ followerId: request.user._id, creatorId: seriesDoc.creatorId._id }).lean()
            : Promise.resolve(null),
        ]);

        userUnlocks = unlocks.map(u => u.episodeId.toString());
        userLikes = likes.map(l => l.episodeId.toString());
        isFollowingCreator = !!followCheck;
      }

      sendSuccess(reply, {
        episodes: episodes.map(ep => {
          let hasAccess = ep.isFree;
          if (hasActiveSubscription) hasAccess = true;
          if (request.user && userUnlocks.includes(ep._id.toString())) hasAccess = true;

          const hookStart = extractHookStart(ep);
          let safeMediaUrl = String(ep.mediaUrl || '').split('#')[0];
          if (!hasAccess && safeMediaUrl) {
            safeMediaUrl = `/api/episodes/${ep._id}/media`;
          }

          return {
            ...ep,
            seriesId: seriesDoc || ep.seriesId,
            mediaUrl: safeMediaUrl,
            hookStart,
            hasAccess,
            isLiked: userLikes.includes(ep._id.toString()),
            isFollowing: isFollowingCreator,
            rating: formatDecimal(ep.rating),
          };
        }),
        pagination: { page: p, limit: l, total, pages: Math.ceil(total / l) },
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch episodes', 500, error.message);
    }
  });
}
