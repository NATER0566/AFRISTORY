import mongoose from 'mongoose';
import Episode, { EPISODE_GENRES, CULTURAL_CATEGORIES, EPISODE_LANGUAGES } from '../models/Episode.js';
import Series from '../models/Series.js';
import Creator from '../models/Creator.js';
import Unlock from '../models/Unlock.js';
import Wallet from '../models/Wallet.js';
import History from '../models/History.js';
import Follow from '../models/Follow.js';
import Like from '../models/Like.js';
import Rating from '../models/Rating.js';
import EpisodeView from '../models/EpisodeView.js';
import { verifyAuth, verifyCreator } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { formatDecimal } from '../utils/helpers.js';
import { createNotification } from '../utils/notificationService.js';

const deepSeriesPopulate = {
  path: 'seriesId',
  populate: {
    path: 'creatorId',
    select: 'brandName profileImage userId',
    populate: { path: 'userId', select: 'profile profileImage username' },
  },
};

function extractHookStart(episode, explicitHookStart = undefined) {
  if (explicitHookStart !== undefined && explicitHookStart !== null && explicitHookStart !== '') {
    const parsed = Math.max(0, Math.floor(Number(explicitHookStart) || 0));
    if (parsed > 0) return parsed;
  }
  if (episode && Number.isFinite(Number(episode.hookStart)) && Number(episode.hookStart) > 0) {
    return Math.floor(Number(episode.hookStart));
  }
  const rawUrl = episode?.mediaUrl || '';
  const match = String(rawUrl).match(/#t=(\d+(?:\.\d+)?)/i);
  return match ? Math.floor(Number(match[1]) || 0) : 0;
}

function getViewerWalletBalances(wallet) {
  const purchasedCoins = formatDecimal(wallet?.purchasedCoins || 0);
  const promotionalCoins = formatDecimal(wallet?.promotionalCoins || 0);
  const legacyRestrictedCoins = formatDecimal(wallet?.legacyRestrictedCoins || 0);
  const spendablePromotionalCoins = formatDecimal(promotionalCoins + legacyRestrictedCoins);
  const vipCredits = formatDecimal(wallet?.vipCredits || 0);
  const storyCoins = formatDecimal(
    wallet?.storyCoins ?? purchasedCoins + spendablePromotionalCoins
  );

  return {
    purchasedCoins,
    promotionalCoins,
    legacyRestrictedCoins,
    spendablePromotionalCoins,
    vipCredits,
    hasVipCredits: vipCredits > 0,
    storyCoins,
  };
}

function buildEpisodeUnlockState({ episode, isUnlocked, balances }) {
  const coinCost = Math.max(1, Number(episode?.coinCost || 10));
  const vipCredits = Number(balances?.vipCredits || 0);
  const purchasedCoins = Number(balances?.purchasedCoins || 0);
  const spendablePromotionalCoins = Number(balances?.spendablePromotionalCoins || 0);

  return {
    isUnlocked: Boolean(isUnlocked),
    replayFree: Boolean(isUnlocked),
    coinCost,
    vipCredits,
    canUnlockWithVip: !isUnlocked && vipCredits >= coinCost,
    vipCreditsExhausted: !isUnlocked && vipCredits < coinCost,
    canUnlockWithPurchased: !isUnlocked && purchasedCoins >= coinCost,
    canUnlockWithPromotional: !isUnlocked && spendablePromotionalCoins >= coinCost,
    canUnlockWithAd: !isUnlocked && episode?.adUnlockable !== false,
  };
}

export default async function episodeRoutes(fastify) {
  // Authoritative media boundary route: redirects to full media if unlocked, or hook preview slice if locked
  fastify.get('/:episodeId/media', async (request, reply) => {
    try {
      const { episodeId } = request.params;
      const episode = await Episode.findById(episodeId).lean();
      if (!episode) return sendError(reply, 'Episode not found', 404);

      let hasAccess = Boolean(episode.isFree);

      if (!hasAccess && (request.cookies?.token || request.headers?.authorization)) {
        const isAuthenticated = await verifyAuth(request, reply, false).catch(() => false);
        if (isAuthenticated && request.user) {
          if (
            request.user.subscriptionExpiresAt &&
            new Date(request.user.subscriptionExpiresAt) > new Date()
          ) {
            hasAccess = true;
          } else {
            const unlock = await Unlock.findOne({
              userId: request.user._id,
              episodeId,
              isActive: true,
              $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
            }).lean();
            if (unlock) hasAccess = true;
          }
        }
      }

      const cleanUrl = String(episode.mediaUrl || '').split('#')[0];

      if (hasAccess) {
        return reply.redirect(cleanUrl);
      }

      let previewUrl = cleanUrl;
      if (previewUrl && previewUrl.includes('cloudinary.com')) {
        const hookStart = extractHookStart(episode);
        const sliceTransform = hookStart > 0 ? `so_${hookStart},eo_${hookStart + 20}` : 'eo_30';

        if (!previewUrl.includes('/eo_') && !previewUrl.includes('/so_')) {
          previewUrl = previewUrl.replace('/upload/', `/upload/${sliceTransform}/`);
        }
        return reply.redirect(previewUrl);
      }

      return sendError(
        reply,
        'Premium content requires authorization. Preview unavailable for this media type.',
        403
      );
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to authorize media stream', 500);
    }
  });

  fastify.get('/feed', async (request, reply) => {
    try {
      if (request.cookies?.token || request.headers?.authorization) {
        await verifyAuth(request, reply, false).catch(() => false);
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

      const hasActiveSubscription = Boolean(
        request.user &&
          request.user.subscriptionExpiresAt &&
          new Date(request.user.subscriptionExpiresAt) > new Date()
      );

      let userUnlocks = [];
      let followedCreatorIds = [];
      let userLikes = [];
      let wallet = null;

      if (request.user) {
        const episodeIds = episodes.map((ep) => ep._id);
        const creatorIds = [
          ...new Set(episodes.map((ep) => ep.seriesId?.creatorId?._id?.toString()).filter(Boolean)),
        ];

        const [unlocks, follows, likes, userWallet] = await Promise.all([
          Unlock.find({
            userId: request.user._id,
            episodeId: { $in: episodeIds },
            isActive: true,
            $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
          }).lean(),
          Follow.find({
            followerId: request.user._id,
            creatorId: { $in: creatorIds },
          }).lean(),
          Like.find({
            userId: request.user._id,
            episodeId: { $in: episodeIds },
          }).lean(),
          Wallet.findOne({ userId: request.user._id }).lean(),
        ]);

        userUnlocks = unlocks.map((u) => u.episodeId.toString());
        followedCreatorIds = follows.map((f) => f.creatorId.toString());
        userLikes = likes.map((l) => l.episodeId.toString());
        wallet = userWallet;
      }

      const balances = getViewerWalletBalances(wallet);

      const processedEpisodes = episodes.map((episode) => {
        let hasAccess = Boolean(episode.isFree);
        if (hasActiveSubscription) hasAccess = true;
        if (request.user && userUnlocks.includes(episode._id.toString())) hasAccess = true;

        if (episode.seriesId && episode.seriesId.creatorId) {
          const creator = episode.seriesId.creatorId;
          const user = creator.userId;
          creator.profileImage =
            creator.profileImage || user?.profile?.avatarUrl || user?.profileImage || null;
        }

        const creatorIdStr = episode.seriesId?.creatorId?._id?.toString();
        const isFollowing = followedCreatorIds.includes(creatorIdStr);
        const isLiked = userLikes.includes(episode._id.toString());
        const hookStart = extractHookStart(episode);

        let safeMediaUrl = String(episode.mediaUrl || '').split('#')[0];
        if (!hasAccess && safeMediaUrl) {
          safeMediaUrl = `/api/episodes/${episode._id}/media`;
        }

        return {
          ...episode,
          mediaUrl: safeMediaUrl,
          hookStart,
          rating: formatDecimal(episode.rating),
          hasAccess,
          isUnlocked: hasAccess,
          isFollowing,
          isLiked,
          unlockState: buildEpisodeUnlockState({
            episode,
            isUnlocked: hasAccess,
            balances,
          }),
        };
      });

      return sendSuccess(reply, {
        episodes: processedEpisodes,
        walletBalances: request.user ? balances : null,
      });
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to fetch episode feed', 500, error.message);
    }
  });

  fastify.get('/:episodeId', async (request, reply) => {
    try {
      const { episodeId } = request.params;
      const episode = await Episode.findById(episodeId).populate(deepSeriesPopulate).lean();

      if (request.cookies?.token || request.headers?.authorization) {
        await verifyAuth(request, reply, false).catch(() => false);
      }

      if (!episode || (!episode.isPublished && !request.user)) {
        return sendError(reply, 'Episode not found', 404);
      }

      let hasAccess = Boolean(episode.isFree);
      let isFollowing = false;
      let isLiked = false;
      let wallet = null;

      const hasActiveSubscription = Boolean(
        request.user &&
          request.user.subscriptionExpiresAt &&
          new Date(request.user.subscriptionExpiresAt) > new Date()
      );
      if (hasActiveSubscription) hasAccess = true;

      if (request.user) {
        const creatorIdStr = episode.seriesId?.creatorId?._id?.toString();
        const [unlock, followCheck, likeCheck, userWallet] = await Promise.all([
          !episode.isFree
            ? Unlock.findOne({
                userId: request.user._id,
                episodeId,
                isActive: true,
                $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
              }).lean()
            : null,
          creatorIdStr
            ? Follow.findOne({ followerId: request.user._id, creatorId: creatorIdStr }).lean()
            : null,
          Like.findOne({ userId: request.user._id, episodeId }).lean(),
          Wallet.findOne({ userId: request.user._id }).lean(),
        ]);

        hasAccess = hasAccess || Boolean(unlock);
        isFollowing = Boolean(followCheck);
        isLiked = Boolean(likeCheck);
        wallet = userWallet;
      }

      if (episode.seriesId && episode.seriesId.creatorId) {
        const creator = episode.seriesId.creatorId;
        const user = creator.userId;
        creator.profileImage =
          creator.profileImage || user?.profile?.avatarUrl || user?.profileImage || null;
      }

      const balances = getViewerWalletBalances(wallet);
      const hookStart = extractHookStart(episode);
      let safeMediaUrl = String(episode.mediaUrl || '').split('#')[0];
      if (!hasAccess && safeMediaUrl) {
        safeMediaUrl = `/api/episodes/${episode._id}/media`;
      }

      return sendSuccess(reply, {
        ...episode,
        mediaUrl: safeMediaUrl,
        hookStart,
        rating: formatDecimal(episode.rating),
        hasAccess,
        isUnlocked: hasAccess,
        isFollowing,
        isLiked,
        walletBalances: request.user ? balances : null,
        unlockState: buildEpisodeUnlockState({
          episode,
          isUnlocked: hasAccess,
          balances,
        }),
      });
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to fetch episode', 500, error.message);
    }
  });

  // Create episode
  fastify.post('/series/:seriesId/create', async (request, reply) => {
    try {
      await verifyCreator(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);
      const { seriesId } = request.params;
      const {
        episodeNumber,
        title,
        description,
        mediaUrl,
        thumbnailUrl,
        hookStart,
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
        return sendError(
          reply,
          'Title, media URL, genre, cultural category, and language are required',
          400
        );
      }
      if (
        !EPISODE_GENRES.includes(genre) ||
        !CULTURAL_CATEGORIES.includes(culturalCategory) ||
        !EPISODE_LANGUAGES.includes(language)
      ) {
        return sendError(reply, 'Invalid genre, cultural category, or language', 400);
      }
      if (!/^https?:\/\/.+/i.test(mediaUrl)) {
        return sendError(reply, 'Media URL must be a valid secure web link', 400);
      }

      const series = await Series.findById(seriesId);
      if (!series) return sendError(reply, 'Series not found', 404);
      const creator = await Creator.findOne({ userId: request.user._id });
      if (!creator || series.creatorId.toString() !== creator._id.toString()) {
        return sendError(reply, 'Forbidden - not series creator', 403);
      }
      if (isFree === true) {
        return sendError(reply, 'Free episodes are no longer supported', 400);
      }

      const normalizedCost = coinCost !== undefined ? Math.max(1, Math.floor(Number(coinCost) || 10)) : 10;
      const resolvedHookStart = extractHookStart({ mediaUrl }, hookStart);
      const nextEpisodeNumber =
        episodeNumber ||
        ((await Episode.findOne({ seriesId }).sort({ episodeNumber: -1 }))?.episodeNumber || 0) + 1;

      const episode = new Episode({
        seriesId,
        episodeNumber: nextEpisodeNumber,
        title,
        description: description || '',
        mediaUrl,
        thumbnailUrl: thumbnailUrl || null,
        hookStart: resolvedHookStart,
        genre,
        culturalCategory,
        language,
        tags: Array.isArray(tags) ? tags : [],
        duration: duration || 0,
        isFree: false,
        coinCost: normalizedCost,
        adUnlockable: adUnlockable !== undefined ? adUnlockable : true,
        isPublished: isPublished === true,
        publishedAt: isPublished === true ? new Date() : null,
      });

      await episode.save();
      series.totalEpisodes = await Episode.countDocuments({ seriesId });
      await series.save();

      if (episode.isPublished) {
        const followers = await Follow.find({ creatorId: creator._id });
        Promise.allSettled(
          followers.map((follow) =>
            createNotification({
              userId: follow.followerId,
              type: 'NEW_EPISODE',
              title: 'New Episode Published! 🎬',
              message: `${creator.brandName} just published a new episode: ${episode.title}`,
              targetUrl: '#watch',
              icon: 'https://ui-avatars.com/api/?name=AfriStory&background=d4a017&color=fff&size=192',
              image: episode.thumbnailUrl || null,
              data: { episodeId: episode._id, seriesId: series._id },
              dedupeKey: `new_ep_${episode._id}_${follow.followerId}`,
            })
          )
        ).catch((err) => fastify.log.error('Push loop error:', err));
      }

      return sendSuccess(reply, episode, 'Episode created successfully', 201);
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to create episode', 500, error.message);
    }
  });

  // Update episode
  fastify.put('/:episodeId/update', async (request, reply) => {
    try {
      await verifyCreator(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);
      const { episodeId } = request.params;
      const {
        title,
        description,
        mediaUrl,
        thumbnailUrl,
        hookStart,
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
      if (!episode) return sendError(reply, 'Episode not found', 404);
      const series = await Series.findById(episode.seriesId);
      if (!series) return sendError(reply, 'Series not found', 404);
      const creator = await Creator.findOne({ userId: request.user._id });
      if (!creator || series.creatorId.toString() !== creator._id.toString()) {
        return sendError(reply, 'Forbidden - not series creator', 403);
      }

      const wasPublished = episode.isPublished;
      if (title) episode.title = title;
      if (description !== undefined) episode.description = description;
      if (mediaUrl) {
        if (!/^https?:\/\/.+/i.test(mediaUrl)) {
          return sendError(reply, 'Media URL must be a valid secure web link', 400);
        }
        episode.mediaUrl = mediaUrl;
      }
      if (hookStart !== undefined || mediaUrl) {
        episode.hookStart = extractHookStart({ mediaUrl: mediaUrl || episode.mediaUrl }, hookStart);
      }
      if (thumbnailUrl !== undefined) episode.thumbnailUrl = thumbnailUrl;
      if (genre !== undefined) episode.genre = genre;
      if (culturalCategory !== undefined) episode.culturalCategory = culturalCategory;
      if (language !== undefined) episode.language = language;
      if (tags !== undefined) episode.tags = Array.isArray(tags) ? tags : [];
      if (duration !== undefined) episode.duration = duration;
      if (isFree === true) return sendError(reply, 'Free episodes are no longer supported', 400);
      if (isFree !== undefined) episode.isFree = false;
      if (coinCost !== undefined) {
        episode.coinCost = Math.max(1, Math.floor(Number(coinCost) || 10));
      }
      if (adUnlockable !== undefined) episode.adUnlockable = adUnlockable;
      if (isPublished !== undefined) {
        episode.isPublished = isPublished;
        if (isPublished && !episode.publishedAt) episode.publishedAt = new Date();
      }

      await episode.save();

      if (isPublished === true && !wasPublished) {
        const followers = await Follow.find({ creatorId: creator._id });
        Promise.allSettled(
          followers.map((follow) =>
            createNotification({
              userId: follow.followerId,
              type: 'NEW_EPISODE',
              title: 'New Episode Published! 🎬',
              message: `${creator.brandName} just published a new episode: ${episode.title}`,
              targetUrl: '#watch',
              icon: 'https://ui-avatars.com/api/?name=AfriStory&background=d4a017&color=fff&size=192',
              image: episode.thumbnailUrl || null,
              data: { episodeId: episode._id, seriesId: series._id },
              dedupeKey: `new_ep_${episode._id}_${follow.followerId}`,
            })
          )
        ).catch((err) => fastify.log.error('Push loop error:', err));
      }

      return sendSuccess(reply, episode, 'Episode updated successfully');
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to update episode', 500, error.message);
    }
  });

  // Delete episode
  fastify.delete('/:episodeId', async (request, reply) => {
    try {
      await verifyCreator(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);
      const { episodeId } = request.params;
      const episode = await Episode.findById(episodeId);
      if (!episode) return sendError(reply, 'Episode not found', 404);
      const series = await Series.findById(episode.seriesId);
      const creator = await Creator.findOne({ userId: request.user._id });
      if (!creator || series.creatorId.toString() !== creator._id.toString()) {
        return sendError(reply, 'Forbidden - not series creator', 403);
      }

      await Episode.findByIdAndDelete(episodeId);
      await Unlock.deleteMany({ episodeId });
      await History.deleteMany({ episodeId });
      await Like.deleteMany({ episodeId });
      await Rating.deleteMany({ episodeId });
      await EpisodeView.deleteMany({ episodeId });

      series.totalEpisodes = await Episode.countDocuments({ seriesId: series._id });
      await series.save();
      return sendSuccess(reply, null, 'Episode deleted successfully');
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to delete episode', 500, error.message);
    }
  });

  fastify.post('/:episodeId/watch', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);
      const { episodeId } = request.params;
      const { lastPosition, watchedPercentage, completed } = request.body || {};
      const episode = await Episode.findById(episodeId);
      if (!episode) return sendError(reply, 'Episode not found', 404);

      let history = await History.findOne({ userId: request.user._id, episodeId });
      if (!history) {
        history = new History({ userId: request.user._id, episodeId, seriesId: episode.seriesId });
      }
      if (lastPosition !== undefined) history.lastPosition = lastPosition;
      if (watchedPercentage !== undefined) history.watchedPercentage = watchedPercentage;
      if (completed !== undefined) {
        history.completed = completed;
        if (completed && !history.completedAt) history.completedAt = new Date();
      }
      await history.save();
      return sendSuccess(reply, history, 'Watch history updated successfully');
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to update watch history', 500, error.message);
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
        await Like.deleteOne({ _id: existingLike._id });
        updatedEpisode = await Episode.findByIdAndUpdate(
          episodeId,
          { $inc: { likeCount: -1, likes: -1 } },
          { new: true }
        );
        isLiked = false;
      } else {
        await Like.create({ userId, episodeId });
        updatedEpisode = await Episode.findByIdAndUpdate(
          episodeId,
          { $inc: { likeCount: 1, likes: 1 } },
          { new: true }
        );
        isLiked = true;

        const series = await Series.findById(updatedEpisode.seriesId).lean();
        const creator = series?.creatorId ? await Creator.findById(series.creatorId).lean() : null;
        if (creator?.userId && creator.userId.toString() !== userId.toString()) {
          createNotification({
            userId: creator.userId,
            type: 'LIKE',
            title: 'New Like ❤️',
            message: `${request.user.username} liked your episode.`,
            targetUrl: '#watch',
            icon: 'https://ui-avatars.com/api/?name=AfriStory&background=d4a017&color=fff&size=192',
            image: updatedEpisode.thumbnailUrl || null,
            dedupeKey: `like_${episodeId}_${userId}`,
          }).catch((err) => fastify.log.error('Push error:', err));
        }
      }

      const currentCount = Math.max(updatedEpisode?.likeCount || updatedEpisode?.likes || 0, 0);
      return sendSuccess(reply, { isLiked, likeCount: currentCount }, isLiked ? 'Liked' : 'Unliked');
    } catch (error) {
      if (error.code === 11000) return sendSuccess(reply, { isLiked: true });
      fastify.log.error(error);
      return sendError(reply, 'Failed to toggle like', 500, error.message);
    }
  });

  fastify.post('/:episodeId/rate', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);
      const { episodeId } = request.params;
      const { rating } = request.body || {};
      const userId = request.user._id;
      const numRating = Number(rating);
      if (!numRating || numRating < 1 || numRating > 5) {
        return sendError(reply, 'Invalid rating. Must be between 1 and 5.', 400);
      }

      await Rating.findOneAndUpdate(
        { userId, episodeId },
        { $set: { rating: numRating } },
        { upsert: true, new: true }
      );
      const stats = await Rating.aggregate([
        { $match: { episodeId: new mongoose.Types.ObjectId(episodeId) } },
        { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } },
      ]);
      const avg = stats.length > 0 ? stats[0].average : 0;
      const count = stats.length > 0 ? stats[0].count : 0;
      const updated = await Episode.findByIdAndUpdate(
        episodeId,
        { $set: { rating: avg, ratingCount: count } },
        { new: true }
      );
      return sendSuccess(
        reply,
        { rating: formatDecimal(updated.rating), ratingCount: updated.ratingCount },
        'Rating submitted successfully'
      );
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Failed to submit rating', 500, error.message);
    }
  });

  fastify.post('/:episodeId/record-view', async (request, reply) => {
    try {
      if (!request.cookies?.token && !request.headers?.authorization) {
        return sendSuccess(reply, { tracked: false, reason: 'unauthenticated' });
      }
      const isAuthenticated = await verifyAuth(request, reply, false).catch(() => false);
      if (!isAuthenticated || !request.user) {
        return sendSuccess(reply, { tracked: false, reason: 'unauthorized' });
      }

      const { episodeId } = request.params;
      const userId = request.user._id;
      const episode = await Episode.findById(episodeId).lean();
      if (!episode) return sendError(reply, 'Episode not found', 404);
      const series = await Series.findById(episode.seriesId).lean();
      if (!series || !series.creatorId) {
        return sendSuccess(reply, { tracked: false, reason: 'no_creator' });
      }

      const creatorId = series.creatorId;
      await Episode.findByIdAndUpdate(episodeId, { $inc: { totalViews: 1 } });
      await Creator.findByIdAndUpdate(creatorId, { $inc: { totalViews: 1 } });
      const existingEpView = await EpisodeView.findOne({ userId, episodeId }).lean();

      if (!existingEpView) {
        const priorCreatorViewsCount = await EpisodeView.countDocuments({ userId, creatorId });
        await EpisodeView.create({ userId, episodeId, creatorId });
        await Episode.findByIdAndUpdate(episodeId, { $inc: { uniqueViewers: 1 } });
        if (priorCreatorViewsCount === 0) {
          await Creator.findByIdAndUpdate(creatorId, { $inc: { uniqueViewers: 1 } });
        } else if (priorCreatorViewsCount === 1) {
          await Creator.findByIdAndUpdate(creatorId, { $inc: { returningViewers: 1 } });
        }
        return sendSuccess(reply, {
          tracked: true,
          type: priorCreatorViewsCount > 0 ? 'returning' : 'new',
        });
      }
      return sendSuccess(reply, { tracked: true, type: 'repeat' });
    } catch (error) {
      if (error.code === 11000) return sendSuccess(reply, { tracked: true, type: 'duplicate_race' });
      fastify.log.error(error);
      return sendError(reply, 'Failed to record view', 500, error.message);
    }
  });
}
