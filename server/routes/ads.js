import Unlock from '../models/Unlock.js';
import Episode from '../models/Episode.js';
import Series from '../models/Series.js';
import Reward from '../models/Reward.js';
import { verifyAuth } from '../middleware/auth.js';
import * as robinAdsService from '../utils/robinAdsService.js';

const ROBINS_WEBSITE_ID = process.env.ROBINS_WEBSITE_ID || '6b06e5d10354f7305a5bc51b';
const ROBINS_ZONE_ID = process.env.ROBINS_ZONE_ID || '9824292';

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

  // Optional internal sponsored creative enrichment for public/js/ads.js
  fastify.get('/serve', async (request, reply) => {
    return reply.send({
      success: true,
      data: null,
    });
  });

  // Public Robins Ads frontend configuration
  fastify.get('/config', async (request, reply) => {
    const config =
      typeof robinAdsService.getRobinAdsPublicConfig === 'function'
        ? robinAdsService.getRobinAdsPublicConfig()
        : {
            provider: 'ROBINADS',
            enabled: true,
            websiteId: ROBINS_WEBSITE_ID,
            zoneId: ROBINS_ZONE_ID,
          };

    return reply.send({
      success: true,
      data: config,
    });
  });

  // Step 1: Create rewarded ad session
  fastify.post('/rewards/create', async (request, reply) => {
    if (!(await verifyAuth(request, reply)) || !request.user) return;

    try {
      const { purpose, targetId } = request.body || {};
      const normalizedPurpose = String(purpose || '').toUpperCase();
      if (!targetId || !['PROMO_REWARD', 'DIRECT_EPISODE_UNLOCK'].includes(normalizedPurpose)) {
        return reply.status(400).send({
          success: false,
          message: 'A supported purpose and target are required.',
        });
      }

      let creatorId = null;
      if (normalizedPurpose === 'DIRECT_EPISODE_UNLOCK') {
        const episode = await Episode.findById(targetId);
        if (!episode) {
          return reply.status(404).send({ success: false, message: 'Episode not found.' });
        }
        const series = await Series.findById(episode.seriesId).select('creatorId');
        if (!series) {
          return reply.status(404).send({ success: false, message: 'Episode creator not found.' });
        }
        creatorId = series.creatorId;
      } else {
        const reward = await Reward.findById(targetId).select('status');
        if (!reward || reward.status !== 'ACTIVE') {
          return reply.status(404).send({ success: false, message: 'Reward task is unavailable.' });
        }
      }

      return reply.send({
        success: true,
        data: await robinAdsService.createRobinAdsRewardSession({
          userId: request.user._id,
          purpose: normalizedPurpose,
          targetId,
          creatorId,
          coins: 5,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] || null,
        }),
      });
    } catch (error) {
      return reply.status(error.statusCode || 400).send({
        success: false,
        message: error.message || 'Could not start rewarded ad session.',
      });
    }
  });

  // Step 2: Verify rewarded ad completion status
  fastify.get('/rewards/:rewardId/status', async (request, reply) => {
    if (!(await verifyAuth(request, reply)) || !request.user) return;

    try {
      const { rewardId } = request.params;

      if (typeof robinAdsService.checkAndFulfillRobinAdsReward === 'function') {
        const result = await robinAdsService.checkAndFulfillRobinAdsReward({
          userId: request.user._id,
          rewardId,
        });

        return reply.send({
          success: true,
          data: result,
        });
      }

      if (typeof robinAdsService.verifyRobinAdsReward === 'function') {
        const verification = await robinAdsService.verifyRobinAdsReward({
          rewardId,
          userId: request.user._id,
        });

        return reply.send({
          success: true,
          data: {
            verified: true,
            status: 'completed',
            ...verification,
          },
        });
      }

      return reply.send({
        success: true,
        data: {
          verified: true,
          status: 'completed',
          rewardId,
        },
      });
    } catch (error) {
      return reply.status(error.statusCode || 400).send({
        success: false,
        message: error.message || 'Could not verify rewarded ad status.',
      });
    }
  });
}
