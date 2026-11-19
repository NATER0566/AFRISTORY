import Unlock from '../models/Unlock.js';
import { verifyAuth } from '../middleware/auth.js';

export default async function adsRoutes(fastify) {
  fastify.get('/check-unlock/:episodeId', async (request, reply) => {
    if (!(await verifyAuth(request, reply)) || !request.user) return;
    const unlocked = await Unlock.exists({ userId: request.user._id, episodeId: request.params.episodeId, isActive: true });
    return reply.send({ unlocked: Boolean(unlocked) });
  });
}
