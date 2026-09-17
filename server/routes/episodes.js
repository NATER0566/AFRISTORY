import Episode, { EPISODE_GENRES, CULTURAL_CATEGORIES, EPISODE_LANGUAGES } from '../models/Episode.js';
import Series from '../models/Series.js';
import Creator from '../models/Creator.js';
import Unlock from '../models/Unlock.js';
import History from '../models/History.js';
import { verifyAuth, verifyCreator } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { formatDecimal } from '../utils/helpers.js';

export default async function episodeRoutes(fastify, opts) {
  // Database-backed episode feed used by Watch, Discover, and recommendations.
  fastify.get('/feed', async (request, reply) => {
    try {
      let userIsAuthenticated = false;
      if (request.cookies?.token) {
         userIsAuthenticated = await verifyAuth(request, reply, false);
      }

      const { genre, culturalCategory, language, sort = 'trending', limit = 12 } = request.query || {};
      const query = { isPublished: true };
      if (genre) query.genre = genre;
      if (culturalCategory) query.culturalCategory = culturalCategory;
      if (language) query.language = language;
      const sortBy = sort === 'latest' ? { createdAt: -1 } : { totalViews: -1, createdAt: -1 };
      
      const episodes = await Episode.find(query)
        .populate({ path: 'seriesId', populate: { path: 'creatorId', select: 'brandName profileImage' } })
        .sort(sortBy)
        .limit(Math.min(Number(limit) || 12, 50))
        .lean(); // Faster, lighter, prevents virtual crashes
      
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

      const processedEpisodes = episodes.map(episode => {
        let hasAccess = episode.isFree;
        if (hasActiveSubscription) hasAccess = true;
        if (request.user && userUnlocks.includes(episode._id.toString())) hasAccess = true;

        return { 
            ...episode,
            rating: formatDecimal(episode.rating),
            hasAccess
        };
      });

      sendSuccess(reply, { episodes: processedEpisodes });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch episode feed', 500, error.message);
    }
  });

  // Get single episode
  fastify.get('/:episodeId', async (request, reply) => {
    try {
      const { episodeId } = request.params;

      const episode = await Episode.findById(episodeId)
        .populate('seriesId')
        .lean(); // Faster, lighter, prevents virtual crashes

      if (!episode) {
        return sendError(reply, 'Episode not found', 404);
      }

      if (!episode.isPublished && !request.user) {
        return sendError(reply, 'Episode not found', 404);
      }

      // Check if user has access
      let hasAccess = episode.isFree;

      if (request.cookies?.token) {
          await verifyAuth(request, reply);
      }
      
      const hasActiveSubscription = request.user && request.user.subscriptionExpiresAt && new Date(request.user.subscriptionExpiresAt) > new Date();
      if (hasActiveSubscription) hasAccess = true;

      if (request.user && !episode.isFree) {
        const unlock = await Unlock.findOne({
          userId: request.user._id,
          episodeId,
          isActive: true,
        }).lean();
        hasAccess = hasAccess || !!unlock;
      }

      sendSuccess(reply, {
        ...episode,
        rating: formatDecimal(episode.rating),
        hasAccess,
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch episode', 500, error.message);
    }
  });

  // Create episode (Write operations remain as full Mongoose documents to utilize .save())
  fastify.post('/series/:seriesId/create', async (request, reply) => {
    try {
      await verifyCreator(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { seriesId } = request.params;
      const {
        episodeNumber,
        title,
        description,
        mediaUrl,
        thumbnailUrl,
        duration,
        isFree,
        coinCost,
        adUnlockable,
        isPublished,
        genre,
        culturalCategory,
        language,
        tags,
      } = request.body || {};

      if (!title || !mediaUrl || !genre || !culturalCategory || !language) {
        return sendError(reply, 'Title, media URL, genre, cultural category, and language are required', 400);
      }
      
      if (!EPISODE_GENRES.includes(genre) || !CULTURAL_CATEGORIES.includes(culturalCategory) || !EPISODE_LANGUAGES.includes(language)) {
        return sendError(reply, 'Invalid genre, cultural category, or language', 400);
      }

      if (!/^https?:\/\/.+/i.test(mediaUrl)) {
        return sendError(reply, 'Media URL must be a valid secure web link', 400);
      }

      const series = await Series.findById(seriesId);

      if (!series) {
        return sendError(reply, 'Series not found', 404);
      }

      const creator = await Creator.findOne({ userId: request.user._id });

      if (!creator || series.creatorId.toString() !== creator._id.toString()) {
        return sendError(reply, 'Forbidden - not series creator', 403);
      }

      if (isFree === true) {
        return sendError(reply, 'Free episodes are no longer supported', 400);
      }

      const nextEpisodeNumber = episodeNumber || ((await Episode.findOne({ seriesId }).sort({ episodeNumber: -1 }))?.episodeNumber || 0) + 1;
      const episode = new Episode({
        seriesId,
        episodeNumber: nextEpisodeNumber,
        title,
        description: description || '',
        mediaUrl,
        thumbnailUrl: thumbnailUrl || null,
        genre,
        culturalCategory,
        language,
        tags: Array.isArray(tags) ? tags : [],
        duration: duration || 0,
        isFree: false,
        coinCost: coinCost || 10,
        adUnlockable: adUnlockable !== undefined ? adUnlockable : true,
        isPublished: isPublished === true,
        publishedAt: isPublished === true ? new Date() : null,
      });

      await episode.save();

      // Update series episode count
      series.totalEpisodes = await Episode.countDocuments({ seriesId });
      await series.save();

      sendSuccess(reply, episode, 'Episode created successfully', 201);
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to create episode', 500, error.message);
    }
  });

  // Update episode
  fastify.put('/:episodeId/update', async (request, reply) => {
    try {
      await verifyCreator(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { episodeId } = request.params;
      const {
        title,
        description,
        mediaUrl,
        thumbnailUrl,
        duration,
        isFree,
        coinCost,
        adUnlockable,
        isPublished,
        genre,
        culturalCategory,
        language,
        tags,
      } = request.body || {};

      const episode = await Episode.findById(episodeId);

      if (!episode) {
        return sendError(reply, 'Episode not found', 404);
      }

      const series = await Series.findById(episode.seriesId);
      if (!series) {
        return sendError(reply, 'Series not found', 404);
      }
      const creator = await Creator.findOne({ userId: request.user._id });

      if (!creator || series.creatorId.toString() !== creator._id.toString()) {
        return sendError(reply, 'Forbidden - not series creator', 403);
      }

      if (title) episode.title = title;
      if (description !== undefined) episode.description = description;
      
      if (mediaUrl) {
        if (!/^https?:\/\/.+/i.test(mediaUrl)) {
          return sendError(reply, 'Media URL must be a valid secure web link', 400);
        }
        episode.mediaUrl = mediaUrl;
      }
      
      if (thumbnailUrl !== undefined) episode.thumbnailUrl = thumbnailUrl;
      if (genre !== undefined) episode.genre = genre;
      if (culturalCategory !== undefined) episode.culturalCategory = culturalCategory;
      if (language !== undefined) episode.language = language;
      if (tags !== undefined) episode.tags = Array.isArray(tags) ? tags : [];
      if (duration !== undefined) episode.duration = duration;
      if (isFree === true) {
        return sendError(reply, 'Free episodes are no longer supported', 400);
      }
      if (isFree !== undefined) episode.isFree = false;
      if (coinCost !== undefined) episode.coinCost = coinCost;
      if (adUnlockable !== undefined) episode.adUnlockable = adUnlockable;
      if (isPublished !== undefined) {
        episode.isPublished = isPublished;
        if (isPublished && !episode.publishedAt) {
          episode.publishedAt = new Date();
        }
      }

      await episode.save();

      sendSuccess(reply, episode, 'Episode updated successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to update episode', 500, error.message);
    }
  });

  // Delete episode
  fastify.delete('/:episodeId', async (request, reply) => {
    try {
      await verifyCreator(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { episodeId } = request.params;

      const episode = await Episode.findById(episodeId);

      if (!episode) {
        return sendError(reply, 'Episode not found', 404);
      }

      const series = await Series.findById(episode.seriesId);
      const creator = await Creator.findOne({ userId: request.user._id });

      if (!creator || series.creatorId.toString() !== creator._id.toString()) {
        return sendError(reply, 'Forbidden - not series creator', 403);
      }

      await Episode.findByIdAndDelete(episodeId);
      await Unlock.deleteMany({ episodeId });
      await History.deleteMany({ episodeId });

      // Update series episode count
      series.totalEpisodes = await Episode.countDocuments({ seriesId: series._id });
      await series.save();

      sendSuccess(reply, null, 'Episode deleted successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to delete episode', 500, error.message);
    }
  });

  // Update watch history
  fastify.post('/:episodeId/watch', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { episodeId } = request.params;
      const { lastPosition, watchedPercentage, completed } = request.body || {};

      const episode = await Episode.findById(episodeId);

      if (!episode) {
        return sendError(reply, 'Episode not found', 404);
      }

      // Check if user has access
      const unlock = await Unlock.findOne({
        userId: request.user._id,
        episodeId,
        isActive: true,
      }).lean();

      const hasActiveSubscription = request.user.subscriptionExpiresAt > new Date();
      if (!episode.isFree && !unlock && !hasActiveSubscription) {
        return sendError(reply, 'Access denied - episode not unlocked', 403);
      }

      let history = await History.findOne({
        userId: request.user._id,
        episodeId,
      });

      if (!history) {
        history = new History({
          userId: request.user._id,
          episodeId,
          seriesId: episode.seriesId,
        });
      }

      if (lastPosition !== undefined) history.lastPosition = lastPosition;
      if (watchedPercentage !== undefined) history.watchedPercentage = watchedPercentage;
      if (completed !== undefined) {
        history.completed = completed;
        if (completed && !history.completedAt) {
          history.completedAt = new Date();
        }
      }

      await history.save();

      // Increment total views if not counted yet
      if (!history.lastPosition || lastPosition === 0) {
        episode.totalViews += 1;
        await episode.save();
      }

      sendSuccess(reply, history, 'Watch history updated successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to update watch history', 500, error.message);
    }
  });
}
