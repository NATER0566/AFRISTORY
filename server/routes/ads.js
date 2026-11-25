import Unlock from '../models/Unlock.js';
import { verifyAuth } from '../middleware/auth.js';
import {
  getRobinAdsPublicConfig,
  createRobinAdsRewardSession,
  checkAndFulfillRobinAdsReward,
} from '../services/robinAdsService.js';

export default async function adsRoutes(fastify) {
  // Existing episode unlock check
  fastify.get('/check-unlock/:episodeId', async (request, reply) => {
    if (!(await verifyAuth(request, reply)) || !request.user) return;
    const unlocked = await Unlock.exists({
      userId: request.user._id,
      episodeId: request.params.episodeId,
      isActive: true,
    });
    return reply.send({ unlocked: Boolean(unlocked) });
  });

  // Public Robins Ads frontend configuration
  fastify.get('/config', async (request, reply) => {
    return reply.send({
      success: true,
      data: getRobinAdsPublicConfig(),
    });
  });

  // Step 1: Backend creates reward session via Robins Ads POST /api/v1/rewards and returns popup_url
  fastify.post('/rewards/create', async (request, reply) => {
    if (!(await verifyAuth(request, reply)) || !request.user) return;

    try {
      const { purpose, targetId } = request.body || {};
      const session = await createRobinAdsRewardSession({
        userId: request.user._id,
        purpose,
        targetId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || null,
      });

      return reply.send({
        success: true,
        data: session,
      });
    } catch (error) {
      return reply.status(error.statusCode || 400).send({
        success: false,
        message: error.message || 'Could not start rewarded ad session.',
      });
    }
  });

  // Step 2: Backend polls Robins Ads GET /api/v1/rewards/:id and grants reward/unlock once verified
  fastify.get('/rewards/:rewardId/status', async (request, reply) => {
    if (!(await verifyAuth(request, reply)) || !request.user) return;

    try {
      const result = await checkAndFulfillRobinAdsReward({
        userId: request.user._id,
        rewardId: request.params.rewardId,
      });

      return reply.send({
        success: true,
        data: result,
      });
    } catch (error) {
      return reply.status(error.statusCode || 400).send({
        success: false,
        message: error.message || 'Could not verify rewarded ad status.',
      });
    }
  });
}
