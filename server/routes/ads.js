import Unlock from '../models/Unlock.js';
import Episode from '../models/Episode.js';
import Series from '../models/Series.js';
import Reward from '../models/Reward.js';
import { verifyAuth } from '../middleware/auth.js';
import * as robinAdsService from '../utils/robinAdsService.js';

const ROBINS_WEBSITE_ID = process.env.ROBINS_WEBSITE_ID || '6b06e5d10354f7305a5bc51b';
const ROBINS_ZONE_ID = process.env.ROBINS_ZONE_ID || '9824292';

async function resolvePromoRewardTarget(targetId) {
  const raw = String(targetId || '').trim();
  if (!raw || raw.toLowerCase() === 'watch_ads') {
    const watchReward = await Reward.findOneAndUpdate(
      { 'metadata.key': 'watch_ads' },
      {
        $set: {
          rewardAmount: 5,
          recurrenceType: 'per_ad',
          verificationMode: 'ad',
          status: 'ACTIVE',
          'metadata.requiresAd': true,
        },
        $setOnInsert: {
          name: 'Watch Ads & Earn Coins',
          description: 'Complete a verified sponsor ad to earn 5 promotional coins.',
          type: 'DAILY',
          category: 'ads',
          rewardAmount: 5,
          recurrenceType: 'per_ad',
          verificationMode: 'ad',
          status: 'ACTIVE',
          metadata: { key: 'watch_ads', requiresAd: true },
          createdAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );
    return watchReward;
  }

  return Reward.findById(raw).select('status');
}

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

  // Step 1: Create target-bound rewarded ad session (PROMO_REWARD or DIRECT_EPISODE_UNLOCK)
  fastify.post('/rewards/create', async (request, reply) => {
    if (!(await verifyAuth(request, reply)) || !request.user) return;

    try {
      const { purpose, targetId } = request.body || {};
      const rawPurpose = String(purpose || '').toUpperCase();
      const normalizedPurpose = ['REWARD', 'EARN_COINS', 'REWARD_CLAIM', 'PROMO_REWARD'].includes(rawPurpose)
        ? 'PROMO_REWARD'
        : ['EPISODE_UNLOCK', 'UNLOCK_EPISODE', 'DIRECT_EPISODE_UNLOCK'].includes(rawPurpose)
        ? 'DIRECT_EPISODE_UNLOCK'
        : '';

      if (!normalizedPurpose) {
        return reply.status(400).send({
          success: false,
          message: 'A supported purpose (PROMO_REWARD or DIRECT_EPISODE_UNLOCK) is required.',
        });
      }

      let resolvedTargetId = targetId ? String(targetId).trim() : '';
      let creatorId = null;

      if (normalizedPurpose === 'DIRECT_EPISODE_UNLOCK') {
        if (!resolvedTargetId) {
          return reply.status(400).send({
            success: false,
            message: 'Episode targetId is required for direct episode ad unlock.',
          });
        }

        const alreadyUnlocked = await Unlock.exists({
          userId: request.user._id,
          episodeId: resolvedTargetId,
          isActive: true,
        });
        if (alreadyUnlocked) {
          return reply.status(409).send({
            success: false,
            message: 'This episode is already unlocked.',
          });
        }

        const episode = await Episode.findById(resolvedTargetId);
        if (!episode) {
          return reply.status(404).send({ success: false, message: 'Episode not found.' });
        }
        const series = await Series.findById(episode.seriesId).select('creatorId');
        if (!series) {
          return reply.status(404).send({ success: false, message: 'Episode creator not found.' });
        }
        creatorId = series.creatorId;
        resolvedTargetId = String(episode._id);
      } else {
        const reward = await resolvePromoRewardTarget(resolvedTargetId);
        if (!reward || reward.status !== 'ACTIVE') {
          return reply.status(404).send({ success: false, message: 'Reward task is unavailable.' });
        }
        resolvedTargetId = String(reward._id);
      }

      const sessionData = await robinAdsService.createRobinAdsRewardSession({
        userId: request.user._id,
        purpose: normalizedPurpose,
        targetId: resolvedTargetId,
        creatorId,
        coins: normalizedPurpose === 'PROMO_REWARD' ? 5 : 0,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] || null,
      });

      return reply.send({
        success: true,
        data: {
          ...sessionData,
          purpose: normalizedPurpose,
          targetId: resolvedTargetId,
        },
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
      const result = await robinAdsService.checkAndFulfillRobinAdsReward({
        userId: request.user._id,
        rewardId,
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
