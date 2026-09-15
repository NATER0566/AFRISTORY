import Favorite from '../models/Favorite.js';
import Series from '../models/Series.js';
import { verifyAuth } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';

export default async function favoriteRoutes(fastify) {
  fastify.get('/', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);
      const favorites = await Favorite.find({ userId: request.user._id }).populate('seriesId').sort({ createdAt: -1 });
      sendSuccess(reply, favorites.map(item => item.seriesId).filter(Boolean));
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch favorites', 500, error.message);
    }
  });

  fastify.get('/:seriesId/status', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);
      const favorite = await Favorite.exists({ userId: request.user._id, seriesId: request.params.seriesId });
      sendSuccess(reply, { saved: Boolean(favorite) });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch favorite status', 500, error.message);
    }
  });

  fastify.post('/:seriesId/toggle', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);
      const series = await Series.findById(request.params.seriesId);
      if (!series) return sendError(reply, 'Series not found', 404);
      const existing = await Favorite.findOne({ userId: request.user._id, seriesId: series._id });
      if (existing) {
        await existing.deleteOne();
        return sendSuccess(reply, { saved: false }, 'Removed from favorites');
      }
      await Favorite.create({ userId: request.user._id, seriesId: series._id });
      sendSuccess(reply, { saved: true }, 'Added to favorites');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to update favorite', 500, error.message);
    }
  });
}
