import Series from '../models/Series.js';
import Creator from '../models/Creator.js';
import Episode from '../models/Episode.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { paginate, formatDecimal } from '../utils/helpers.js';

export default async function searchRoutes(fastify, opts) {
  // Global search
  fastify.get('/global', async (request, reply) => {
    try {
      const { q, type, page = 1, limit = 10 } = request.query || {};

      if (!q || q.length < 2) {
        return sendError(reply, 'Search query too short', 400);
      }

      const { skip, limit: l, page: p } = paginate(page, limit);

      // FIX: Split the search query into individual keywords for broad TikTok-style searching
      const words = q.trim().split(/\s+/).filter(w => w.length > 0);
      let results = {};

      if (!type || type === 'series') {
        const seriesQuery = {
          $and: words.map(word => {
            const regex = { $regex: word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
            return {
              $or: [
                { title: regex },
                { description: regex },
                { tags: regex },
                { genre: regex },
                { language: regex }
              ]
            };
          }),
          isPublished: true,
        };

        const series = await Series.find(seriesQuery)
          .populate('creatorId', 'brandName profileImage')
          .skip(skip)
          .limit(l)
          .lean();

        const total = await Series.countDocuments(seriesQuery);

        results.series = {
          data: series.map(s => ({
            ...s,
            rating: formatDecimal(s.rating),
          })),
          total,
          pages: Math.ceil(total / l),
        };
      }

      if (!type || type === 'creators') {
        const creatorQuery = {
          $and: words.map(word => {
            const regex = { $regex: word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
            return {
              $or: [
                { brandName: regex },
                { bio: regex }
              ]
            };
          }),
          isVerified: true,
        };

        const creators = await Creator.find(creatorQuery)
          .skip(skip)
          .limit(l)
          .populate('userId', 'username profileImage')
          .lean();

        const total = await Creator.countDocuments(creatorQuery);

        results.creators = {
          data: creators.map(c => ({
            ...c,
            totalViews: formatDecimal(c.totalViews),
            totalEarnings: formatDecimal(c.totalEarnings),
          })),
          total,
          pages: Math.ceil(total / l),
        };
      }

      if (!type || type === 'episodes') {
        const episodeQuery = {
          $and: words.map(word => {
            const regex = { $regex: word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
            return {
              $or: [
                { title: regex },
                { description: regex },
                { genre: regex },
                { culturalCategory: regex },
                { language: regex },
                { tags: regex }
              ]
            };
          }),
          isPublished: true,
        };

        const episodes = await Episode.find(episodeQuery)
          .populate({ path: 'seriesId', populate: { path: 'creatorId', select: 'brandName profileImage' } })
          .skip(skip)
          .limit(l)
          .lean();

        const total = await Episode.countDocuments(episodeQuery);

        results.episodes = {
          data: episodes.map(e => ({
            ...e,
            rating: formatDecimal(e.rating),
          })),
          total,
          pages: Math.ceil(total / l),
        };
      }

      sendSuccess(reply, results);
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Search failed', 500, error.message);
    }
  });

  // Search series
  fastify.get('/series', async (request, reply) => {
    try {
      const { q, genre, sort = 'relevance', page = 1, limit = 10 } = request.query || {};

      if (!q || q.length < 2) {
        return sendError(reply, 'Search query too short', 400);
      }

      const { skip, limit: l, page: p } = paginate(page, limit);
      
      const words = q.trim().split(/\s+/).filter(w => w.length > 0);
      
      let query = {
        $and: words.map(word => {
          const regex = { $regex: word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
          return {
            $or: [
              { title: regex },
              { description: regex },
              { tags: regex },
              { genre: regex },
              { language: regex }
            ]
          };
        }),
        isPublished: true,
      };

      if (genre) {
        query.genre = genre;
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
        .limit(l)
        .lean();

      const total = await Series.countDocuments(query);

      sendSuccess(reply, {
        series: series.map(s => ({
          ...s,
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
      sendError(reply, 'Search failed', 500, error.message);
    }
  });

  // Search creators
  fastify.get('/creators', async (request, reply) => {
    try {
      const { q, page = 1, limit = 10 } = request.query || {};

      if (!q || q.length < 2) {
        return sendError(reply, 'Search query too short', 400);
      }

      const { skip, limit: l, page: p } = paginate(page, limit);
      
      const words = q.trim().split(/\s+/).filter(w => w.length > 0);
      
      const query = {
        $and: words.map(word => {
          const regex = { $regex: word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
          return {
            $or: [
              { brandName: regex },
              { bio: regex }
            ]
          };
        }),
        isVerified: true,
      };

      const creators = await Creator.find(query)
        .populate('userId', 'username profileImage')
        .sort({ totalViews: -1 })
        .skip(skip)
        .limit(l)
        .lean();

      const total = await Creator.countDocuments(query);

      sendSuccess(reply, {
        creators: creators.map(c => ({
          ...c,
          totalViews: formatDecimal(c.totalViews),
          totalEarnings: formatDecimal(c.totalEarnings),
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
      sendError(reply, 'Search failed', 500, error.message);
    }
  });

  // Get trending
  fastify.get('/trending', async (request, reply) => {
    try {
      const { limit = 10 } = request.query;

      const trendingEpisodes = await Episode.find({ isPublished: true })
        .populate({ path: 'seriesId', populate: { path: 'creatorId', select: 'brandName profileImage' } })
        .sort({ totalViews: -1, createdAt: -1 })
        .limit(parseInt(limit))
        .lean(); 

      sendSuccess(reply, {
        trending: trendingEpisodes.map(episode => ({
          ...episode,
          rating: formatDecimal(episode.rating),
        })),
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch trending', 500, error.message);
    }
  });
}
