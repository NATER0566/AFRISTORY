import User from '../models/User.js';
import Unlock from '../models/Unlock.js';
import Episode from '../models/Episode.js';
import Creator from '../models/Creator.js';
import Wallet from '../models/Wallet.js';
import Transaction from '../models/Transaction.js';

export default async function adsRoutes(fastify, opts) {
  
  // ---------------------------------------------------------
  // ADBNK Server-Side Verification (SSV) Webhook
  // Target: https://afristory.onrender.com/api/ads/adbnk-callback
  // ---------------------------------------------------------
  fastify.all('/adbnk-callback', async (request, reply) => {
    try {
      // 1. ADBNK can send data via GET query parameters or POST body
      const payload = request.method === 'GET' ? request.query : (request.body || {});

      fastify.log.info({
        method: request.method,
        payload
      }, 'ADBNK SSV Callback Received');

      // 2. Extract standard ADBNK rewarded callback fields
      const transactionId = payload.transactionId || payload.transaction_id || payload.tx_id;
      const userId = payload.userId || payload.user_id || payload.uid;
      const episodeId = payload.customData || payload.custom_data || payload.extra;

      // Basic validation
      if (!userId || !episodeId) {
        fastify.log.warn('ADBNK Callback missing userId or episodeId');
        // Return 200 so ADBNK does not retry corrupt payloads indefinitely
        return reply.code(200).send('MISSING_DATA');
      }

      // 3. Replay Protection: Check if this transactionId has already been recorded
      if (transactionId) {
        const alreadyClaimed = await Transaction.findOne({ 'metadata.adbnkTxId': transactionId });
        if (alreadyClaimed) {
          fastify.log.info(`ADBNK transaction ${transactionId} already processed. Skipping duplicate.`);
          return reply.code(200).send('ALREADY_PROCESSED');
        }
      }

      // 4. Verify episode exists
      const episode = await Episode.findById(episodeId);
      if (!episode) {
        fastify.log.warn(`ADBNK Callback: Episode ${episodeId} not found`);
        return reply.code(200).send('EPISODE_NOT_FOUND');
      }

      // 5. Unlock the episode for the user in the database
      await Unlock.findOneAndUpdate(
        { userId, episodeId },
        {
          userId,
          episodeId,
          seriesId: episode.seriesId,
          unlockedAt: new Date(),
          method: 'AD',
          provider: 'ADBNK',
          transactionId: transactionId || `adbnk_${Date.now()}`
        },
        { upsert: true, new: true }
      );

      // 6. Record transaction for auditing, accounting, and anti-fraud
      await Transaction.create({
        userId,
        type: 'UNLOCK',
        status: 'COMPLETED',
        amount: 0,
        description: `Ad unlock via ADBNK (${episode.title || 'Episode'})`,
        metadata: {
          adbnkTxId: transactionId,
          episodeId,
          seriesId: episode.seriesId,
          provider: 'ADBNK'
        }
      });

      fastify.log.info(`Episode ${episodeId} unlocked successfully for user ${userId} via ADBNK`);

      // 7. Acknowledge with HTTP 200 OK
      return reply.code(200).send('OK');

    } catch (error) {
      fastify.log.error('ADBNK Webhook Error: ' + error.message);
      // Return 200 so ad network does not deactivate your webhook endpoint
      return reply.code(200).send('ERROR_HANDLED');
    }
  });

  // ---------------------------------------------------------
  // Episode Access Verification Helper
  // Used by the frontend after ad completion to verify unlock status
  // ---------------------------------------------------------
  fastify.get('/check-unlock/:episodeId', async (request, reply) => {
    try {
      const { episodeId } = request.params;
      const userId = request.user?._id || request.query.userId;

      if (!userId || !episodeId) {
        return reply.code(400).send({ unlocked: false });
      }

      const unlocked = await Unlock.findOne({ userId, episodeId });
      return reply.code(200).send({ unlocked: !!unlocked });
    } catch (err) {
      return reply.code(200).send({ unlocked: false });
    }
  });
}
