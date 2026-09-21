import Series from '../models/Series.js';
import Episode from '../models/Episode.js';
import Creator from '../models/Creator.js';
import Unlock from '../models/Unlock.js'; // PHASE 5.1 FIX: Added to check access
import { verifyAuth, verifyCreator } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { paginate, formatDecimal } from '../utils/helpers.js';

export default async function seriesRoutes(fastify, opts) {
  // Get all published series
  fastify.get('/discover/all', async (request, reply) => {
    try {
      if (request.cookies?.token && !(await verifyAuth(request, reply))) return;
      const { page = 1, limit = 10, genre, sort = 'newest' } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      let query = { isPublished: true, status: { $ne: 'DRAFT' } };

      const hasActiveSubscription = request.user?.subscriptionExpiresAt > new Date();
      if (!hasActiveSubscription) query.isPremiumExclusive = { $ne: true };

      if (genre) {
        query.$or = [
          { primaryGenre: genre },
          { secondaryGenres: genre },
          { genre },
        ];
      }

      let sortBy = { createdAt: -1 };
      if (sort === 'trending') {
        sortBy = { totalViews: -1 };
      } else if (sort === 'rating') {
        sortBy = { rating: -1 };
      }

      const series = await Series.find(query)
        .populate('creatorId', 'brandName profileImage')
        .sort(sortBy)
        .skip(skip)
        .limit(l);

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
      sendError(reply, 'Failed to fetch series', 500, error.message);
    }
  });

  // Get single series
  fastify.get('/:seriesId', async (request, reply) => {
    try {
      if (request.cookies?.token && !(await verifyAuth(request, reply))) return;
      const { seriesId } = request.params;

      const series = await Series.findById(seriesId).populate('creatorId');

      if (!series) {
        return sendError(reply, 'Series not found', 404);
      }

      if (!series.isPublished && !request.user) {
        return sendError(reply, 'Series not found', 404);
      }

      if (series.isPremiumExclusive && (!request.user || request.user.subscriptionExpiresAt <= new Date())) {
        return sendError(reply, 'Premium subscription required', 403);
      }

      const episodeCount = await Episode.countDocuments({
        seriesId,
        isPublished: true,
      });

      sendSuccess(reply, {
        ...series.toObject(),
        rating: formatDecimal(series.rating),
        episodeCount,
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch series', 500, error.message);
    }
  });

  // Create series
  fastify.post('/create', async (request, reply) => {
    try {
      await verifyCreator(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { title, description, coverImage, tags, genre, language, isPublished, isPremiumExclusive } = request.body || {};

      if (!title || !coverImage) {
        return sendError(reply, 'Title and cover image are required', 400);
      }

      const creator = await Creator.findOne({ userId: request.user._id });

      if (!creator) {
        return sendError(reply, 'Creator profile not found', 404);
      }

      const series = new Series({
        creatorId: creator._id,
        title,
        description: description || '',
        coverImage,
        tags: tags || [],
        genre: genre || '',
        language: language || 'English',
        status: 'ONGOING',
        isPublished: isPublished === true,
        isPremiumExclusive: isPremiumExclusive === true,
      });

      await series.save();

      sendSuccess(reply, series, 'Series created successfully', 201);
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to create series', 500, error.message);
    }
  });

  // Update series
  fastify.put('/:seriesId/update', async (request, reply) => {
    try {
      await verifyCreator(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { seriesId } = request.params;
      const { title, description, coverImage, tags, status, genre, language, isPublished, isPremiumExclusive } = request.body || {};

      const series = await Series.findById(seriesId);

      if (!series) {
        return sendError(reply, 'Series not found', 404);
      }

      const creator = await Creator.findOne({ userId: request.user._id });

      if (!creator || series.creatorId.toString() !== creator._id.toString()) {
        return sendError(reply, 'Forbidden - not series creator', 403);
      }

      if (title) series.title = title;
      if (description !== undefined) series.description = description;
      if (coverImage) series.coverImage = coverImage;
      if (tags) series.tags = tags;
      if (status) series.status = status;
      if (genre) series.genre = genre;
      if (language) series.language = language;
      if (isPublished !== undefined) series.isPublished = isPublished;
      if (isPremiumExclusive !== undefined) series.isPremiumExclusive = isPremiumExclusive;

      await series.save();

      sendSuccess(reply, series, 'Series updated successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to update series', 500, error.message);
    }
  });

  // Delete series
  fastify.delete('/:seriesId', async (request, reply) => {
    try {
      await verifyCreator(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { seriesId } = request.params;

      const series = await Series.findById(seriesId);

      if (!series) {
        return sendError(reply, 'Series not found', 404);
      }

      const creator = await Creator.findOne({ userId: request.user._id });

      if (!creator || series.creatorId.toString() !== creator._id.toString()) {
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

  // Get series episodes
  fastify.get('/:seriesId/episodes', async (request, reply) => {
    try {
      if (request.cookies?.token && !(await verifyAuth(request, reply))) return;
      const { seriesId } = request.params;
      const { page = 1, limit = 10 } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      const episodes = await Episode.find({
        seriesId,
        isPublished: true,
      })
        .skip(skip)
        .limit(l)
        .sort({ episodeNumber: 1 });

      const total = await Episode.countDocuments({ seriesId, isPublished: true });

      // PHASE 5.1 FIX: Authoritative Media Hiding in Series Listing
      const hasActiveSubscription = request.user && request.user.subscriptionExpiresAt && new Date(request.user.subscriptionExpiresAt) > new Date();
      
      let userUnlocks = [];
      if (request.user) {
        const episodeIds = episodes.map(ep => ep._id);
        const unlocks = await Unlock.find({
          userId: request.user._id,
          episodeId: { $in: episodeIds },
          isActive: true
        }).lean();
        userUnlocks = unlocks.map(u => u.episodeId.toString());
      }

      sendSuccess(reply, {
        episodes: episodes.map(e => {
          const ep = e.toObject();
          
          let hasAccess = ep.isFree;
          if (hasActiveSubscription) hasAccess = true;
          if (request.user && userUnlocks.includes(ep._id.toString())) hasAccess = true;

          let safeMediaUrl = ep.mediaUrl;
          if (!hasAccess && safeMediaUrl) {
              safeMediaUrl = `/api/episodes/${ep._id}/media`;
          }

          return {
            ...ep,
            mediaUrl: safeMediaUrl, // Authoritative route for unauthorized users
            hasAccess,
            rating: formatDecimal(ep.rating),
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
      sendError(reply, 'Failed to fetch episodes', 500, error.message);
    }
  });
}
