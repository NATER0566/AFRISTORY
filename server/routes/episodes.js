import mongoose from 'mongoose';
import Episode, { EPISODE_GENRES, CULTURAL_CATEGORIES, EPISODE_LANGUAGES } from '../models/Episode.js';
import Series from '../models/Series.js';
import Creator from '../models/Creator.js';
import Unlock from '../models/Unlock.js';
import History from '../models/History.js';
import Follow from '../models/Follow.js'; 
import Like from '../models/Like.js'; 
import Rating from '../models/Rating.js'; 
import EpisodeView from '../models/EpisodeView.js'; 
import { verifyAuth, verifyCreator } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { formatDecimal } from '../utils/helpers.js';
import { createNotification } from '../utils/notificationService.js'; // NEW: Central notification service

// Deep populate object to ensure we trace the Creator back to their actual User avatar
const deepSeriesPopulate = {
  path: 'seriesId',
  populate: {
    path: 'creatorId',
    select: 'brandName profileImage userId',
    populate: { path: 'userId', select: 'profile profileImage username' }
  }
};

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
        .populate(deepSeriesPopulate)
        .sort(sortBy)
        .limit(Math.min(Number(limit) || 12, 50))
        .lean(); 
      
      const hasActiveSubscription = request.user && request.user.subscriptionExpiresAt && new Date(request.user.subscriptionExpiresAt) > new Date();
      
      let userUnlocks = [];
      let followedCreatorIds = [];
      let userLikes = []; 

      if (request.user) {
        const episodeIds = episodes.map(ep => ep._id);
        const unlocks = await Unlock.find({
          userId: request.user._id,
          episodeId: { $in: episodeIds },
          isActive: true
        }).lean();
        userUnlocks = unlocks.map(u => u.episodeId.toString());

        // Extract unique creator IDs from the feed to check follow status in one query
        const creatorIds = [...new Set(episodes.map(ep => ep.seriesId?.creatorId?._id?.toString()).filter(Boolean))];
        const follows = await Follow.find({
          followerId: request.user._id,
          creatorId: { $in: creatorIds }
        }).lean();
        followedCreatorIds = follows.map(f => f.creatorId.toString());

        // Efficiently map all likes for the user in this feed batch
        const likes = await Like.find({
          userId: request.user._id,
          episodeId: { $in: episodeIds }
        }).lean();
        userLikes = likes.map(l => l.episodeId.toString());
      }

      const processedEpisodes = episodes.map(episode => {
        let hasAccess = episode.isFree;
        if (hasActiveSubscription) hasAccess = true;
        if (request.user && userUnlocks.includes(episode._id.toString())) hasAccess = true;

        // Safely resolve the profile image from the deep populated User object
        if (episode.seriesId && episode.seriesId.creatorId) {
          const creator = episode.seriesId.creatorId;
          const user = creator.userId;
          creator.profileImage = creator.profileImage || user?.profile?.avatarUrl || user?.profileImage || null;
        }

        const creatorIdStr = episode.seriesId?.creatorId?._id?.toString();
        const isFollowing = followedCreatorIds.includes(creatorIdStr);
        const isLiked = userLikes.includes(episode._id.toString()); 

        return { 
            ...episode,
            rating: formatDecimal(episode.rating),
            hasAccess,
            isFollowing,
            isLiked
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
        .populate(deepSeriesPopulate)
        .lean(); 

      if (!episode) {
        return sendError(reply, 'Episode not found', 404);
      }

      if (!episode.isPublished && !request.user) {
        return sendError(reply, 'Episode not found', 404);
      }

      let hasAccess = episode.isFree;
      let isFollowing = false;
      let isLiked = false; 

      if (request.cookies?.token) {
          await verifyAuth(request, reply);
      }
      
      const hasActiveSubscription = request.user && request.user.subscriptionExpiresAt && new Date(request.user.subscriptionExpiresAt) > new Date();
      if (hasActiveSubscription) hasAccess = true;

      if (request.user) {
        if (!episode.isFree) {
          const unlock = await Unlock.findOne({
            userId: request.user._id,
            episodeId,
            isActive: true,
          }).lean();
          hasAccess = hasAccess || !!unlock;
        }

        const creatorIdStr = episode.seriesId?.creatorId?._id?.toString();
        if (creatorIdStr) {
          const followCheck = await Follow.findOne({ followerId: request.user._id, creatorId: creatorIdStr }).lean();
          isFollowing = !!followCheck;
        }

        const likeCheck = await Like.findOne({ userId: request.user._id, episodeId }).lean();
        isLiked = !!likeCheck;
      }

      // Safely resolve the profile image from the deep populated User object
      if (episode.seriesId && episode.seriesId.creatorId) {
        const creator = episode.seriesId.creatorId;
        const user = creator.userId;
        creator.profileImage = creator.profileImage || user?.profile?.avatarUrl || user?.profileImage || null;
      }

      sendSuccess(reply, {
        ...episode,
        rating: formatDecimal(episode.rating),
        hasAccess,
        isFollowing,
        isLiked
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch episode', 500, error.message);
    }
  });

  // Create episode
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

      series.totalEpisodes = await Episode.countDocuments({ seriesId });
      await series.save();

      // FIXED: Safely process all notifications with Promise.allSettled
      if (episode.isPublished) {
        const followers = await Follow.find({ creatorId: creator._id });
        Promise.allSettled(
          followers.map(follow =>
            createNotification({
              userId: follow.followerId,
              type: 'NEW_EPISODE',
              title: 'New Episode Published! 🎬',
              message: `${creator.brandName} just published a new episode: ${episode.title}`,
              targetUrl: '#watch',
              data: { episodeId: episode._id, seriesId: series._id },
              dedupeKey: `new_ep_${episode._id}_${follow.followerId}`
            })
          )
        ).catch(err => fastify.log.error('Push loop error:', err));
      }

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

      const wasPublished = episode.isPublished; // NEW: Track state before saving

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

      // FIXED: Safely process all notifications with Promise.allSettled
      if (isPublished === true && !wasPublished) {
        const followers = await Follow.find({ creatorId: creator._id });
        Promise.allSettled(
          followers.map(follow =>
            createNotification({
              userId: follow.followerId,
              type: 'NEW_EPISODE',
              title: 'New Episode Published! 🎬',
              message: `${creator.brandName} just published a new episode: ${episode.title}`,
              targetUrl: '#watch',
              data: { episodeId: episode._id, seriesId: series._id },
              dedupeKey: `new_ep_${episode._id}_${follow.followerId}`
            })
          )
        ).catch(err => fastify.log.error('Push loop error:', err));
      }

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
      
      // Cleanup new records
      await Like.deleteMany({ episodeId });
      await Rating.deleteMany({ episodeId });
      await EpisodeView.deleteMany({ episodeId });

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

      sendSuccess(reply, history, 'Watch history updated successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to update watch history', 500, error.message);
    }
  });

  fastify.post('/:episodeId/like/toggle', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);

      const { episodeId } = request.params;
      const userId = request.user._id;

      const existingLike = await Like.findOne({ userId, episodeId }).lean();
      let isLiked = false;
      let updatedEpisode;

      if (existingLike) {
        // Unlike: Delete atomic record & decrement gracefully
        await Like.deleteOne({ _id: existingLike._id });
        updatedEpisode = await Episode.findByIdAndUpdate(
          episodeId, 
          { $inc: { likeCount: -1, likes: -1 } }, 
          { new: true }
        );
        isLiked = false;
      } else {
        // Like: Create unique record & increment atomically
        await Like.create({ userId, episodeId });
        updatedEpisode = await Episode.findByIdAndUpdate(
          episodeId, 
          { $inc: { likeCount: 1, likes: 1 } }, 
          { new: true }
        );
        isLiked = true;

        // FIXED: Safely notify creator about the like
        const series = await Series.findById(updatedEpisode.seriesId);
        if (series && series.creatorId.toString() !== userId.toString()) {
           createNotification({
             userId: series.creatorId,
             type: 'LIKE',
             title: 'New Like ❤️',
             message: `${request.user.username} liked your episode.`,
             targetUrl: '#watch',
             dedupeKey: `like_${episodeId}_${userId}`
           }).catch(err => fastify.log.error('Push error:', err));
        }
      }

      const currentCount = Math.max(updatedEpisode?.likeCount || updatedEpisode?.likes || 0, 0);
      sendSuccess(reply, { isLiked, likeCount: currentCount }, isLiked ? 'Liked' : 'Unliked');
    } catch (error) {
      // Race condition safety: If user spams click, MongoDB unique index throws 11000.
      if (error.code === 11000) return sendSuccess(reply, { isLiked: true });
      fastify.log.error(error);
      sendError(reply, 'Failed to toggle like', 500, error.message);
    }
  });

  fastify.post('/:episodeId/rate', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);

      const { episodeId } = request.params;
      const { rating } = request.body;
      const userId = request.user._id;

      const numRating = Number(rating);
      if (!numRating || numRating < 1 || numRating > 5) {
        return sendError(reply, 'Invalid rating. Must be between 1 and 5.', 400);
      }

      // Upsert single rating per user
      await Rating.findOneAndUpdate(
        { userId, episodeId },
        { $set: { rating: numRating } },
        { upsert: true, new: true }
      );

      // Recalculate average atomically and accurately via Aggregation
      const stats = await Rating.aggregate([
        { $match: { episodeId: new mongoose.Types.ObjectId(episodeId) } },
        { $group: { _id: null, average: {$avg: '$rating' }, count: {$sum: 1 } } }
      ]);

      const avg = stats.length > 0 ? stats[0].average : 0;
      const count = stats.length > 0 ? stats[0].count : 0;

      const updated = await Episode.findByIdAndUpdate(
        episodeId,
        { $set: { rating: avg, ratingCount: count } },
        { new: true }
      );

      sendSuccess(reply, { rating: formatDecimal(updated.rating), ratingCount: updated.ratingCount }, 'Rating submitted successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to submit rating', 500, error.message);
    }
  });

  fastify.post('/:episodeId/record-view', async (request, reply) => {
    try {
      // Unique Analytics requires an authenticated user ID.
      // We do not fail hard if unauthenticated to avoid console errors.
      if (!request.cookies?.token) return sendSuccess(reply, { tracked: false, reason: 'unauthenticated' });
      
      const isAuthenticated = await verifyAuth(request, reply, false).catch(() => false);
      if (!isAuthenticated || !request.user) return sendSuccess(reply, { tracked: false, reason: 'unauthorized' });

      const { episodeId } = request.params;
      const userId = request.user._id;

      const episode = await Episode.findById(episodeId).lean();
      if (!episode) return sendError(reply, 'Episode not found', 404);

      const series = await Series.findById(episode.seriesId).lean();
      if (!series || !series.creatorId) return sendSuccess(reply, { tracked: false, reason: 'no_creator' });

      const creatorId = series.creatorId;

      // 1. Unconditionally increment Total Views for this qualifying 10-second watch event
      await Episode.findByIdAndUpdate(episodeId, { $inc: { totalViews: 1 } });
      await Creator.findByIdAndUpdate(creatorId, { $inc: { totalViews: 1 } });

      // 2. Check if user has EVER viewed this EXACT episode
      const existingEpView = await EpisodeView.findOne({ userId, episodeId }).lean();

      if (!existingEpView) {
        // 3. Count how many UNIQUE episodes from this creator the user has already watched
        const priorCreatorViewsCount = await EpisodeView.countDocuments({ userId, creatorId });

        // 4. Atomically lock this unique view record in place
        await EpisodeView.create({ userId, episodeId, creatorId });

        // 5. Increment Episode Unique Viewers
        await Episode.findByIdAndUpdate(episodeId, { $inc: { uniqueViewers: 1 } });

        // 6. Categorize the Creator Analytics impact exactly ONCE per user status
        if (priorCreatorViewsCount === 0) {
          // First time this user has ever watched this Creator
          await Creator.findByIdAndUpdate(creatorId, { $inc: { uniqueViewers: 1 } });
        } else if (priorCreatorViewsCount === 1) {
          // Exactly the second distinct episode -> they transition to a Returning Viewer
          await Creator.findByIdAndUpdate(creatorId, { $inc: { returningViewers: 1 } });
        }
        // If priorCreatorViewsCount > 1, they are ALREADY a returning viewer, do not increment again.

        return sendSuccess(reply, { tracked: true, type: priorCreatorViewsCount > 0 ? 'returning' : 'new' });
      }

      // View was already tracked for this episode + user pair (unique viewers don't increment, but total views did)
      sendSuccess(reply, { tracked: true, type: 'repeat' });
    } catch (error) {
      // Safe catch for race condition duplicate insert (e.g. user swiped rapidly)
      if (error.code === 11000) return sendSuccess(reply, { tracked: true, type: 'duplicate_race' });
      fastify.log.error(error);
      sendError(reply, 'Failed to record view', 500, error.message);
    }
  });

}
