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

      const escapedQuery = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = { $regex: escapedQuery, $options: 'i' };
      let results = {};

      if (!type || type === 'series') {
        const series = await Series.find({
          $or: [
            { title: searchRegex },
            { description: searchRegex },
            { tags: searchRegex },
          ],
          isPublished: true,
        })
          .populate('creatorId', 'brandName profileImage')
          .skip(skip)
          .limit(l);

        const total = await Series.countDocuments({
          $or: [
            { title: searchRegex },
            { description: searchRegex },
            { tags: searchRegex },
          ],
          isPublished: true,
        });

        results.series = {
          data: series.map(s => ({
            ...s.toObject(),
            rating: formatDecimal(s.rating),
          })),
          total,
          pages: Math.ceil(total / l),
        };
      }

      if (!type || type === 'creators') {
        const creators = await Creator.find({
          $or: [{ brandName: searchRegex }, { bio: searchRegex }],
          isVerified: true,
        })
          .skip(skip)
          .limit(l)
          .populate('userId', 'username profileImage');

        const total = await Creator.countDocuments({
          $or: [{ brandName: searchRegex }, { bio: searchRegex }],
          isVerified: true,
        });

        results.creators = {
          data: creators.map(c => ({
            ...c.toObject(),
            totalViews: formatDecimal(c.totalViews),
            totalEarnings: formatDecimal(c.totalEarnings),
          })),
          total,
          pages: Math.ceil(total / l),
        };
      }

      if (!type || type === 'episodes') {
        const episodes = await Episode.find({
          $or: [
            { title: searchRegex },
            { description: searchRegex },
            { genre: searchRegex },
            { culturalCategory: searchRegex },
            { language: searchRegex },
            { tags: searchRegex },
          ],
          isPublished: true,
        })
          .populate({ path: 'seriesId', populate: { path: 'creatorId', select: 'brandName profileImage' } })
          .skip(skip)
          .limit(l);

        const total = await Episode.countDocuments({
          $or: [
            { title: searchRegex },
            { description: searchRegex },
            { genre: searchRegex },
            { culturalCategory: searchRegex },
            { language: searchRegex },
            { tags: searchRegex },
          ],
          isPublished: true,
        });

        results.episodes = {
          data: episodes.map(e => ({
            ...e.toObject(),
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
      const escapedQuery = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = { $regex: escapedQuery, $options: 'i' };

      let query = {
        $or: [
          { title: searchRegex },
          { description: searchRegex },
          { tags: searchRegex },
        ],
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
      const escapedQuery = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = { $regex: escapedQuery, $options: 'i' };

      const creators = await Creator.find({
        $or: [{ brandName: searchRegex }, { bio: searchRegex }],
        isVerified: true,
      })
        .populate('userId', 'username profileImage')
        .sort({ totalViews: -1 })
        .skip(skip)
        .limit(l);

      const total = await Creator.countDocuments({
        $or: [{ brandName: searchRegex }, { bio: searchRegex }],
        isVerified: true,
      });

      sendSuccess(reply, {
        creators: creators.map(c => ({
          ...c.toObject(),
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

      sendSuccess(reply, {
        trending: trendingEpisodes.map(episode => ({
          ...episode.toObject(),
          rating: formatDecimal(episode.rating),
        })),
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch trending', 500, error.message);
    }
  });
}
