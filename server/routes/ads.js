import User from '../models/User.js';
import Unlock from '../models/Unlock.js';
import Episode from '../models/Episode.js';
import Creator from '../models/Creator.js';
import Wallet from '../models/Wallet.js';
import Transaction from '../models/Transaction.js';
import mongoose from 'mongoose';
import { verifyAuth } from '../middleware/auth.js';
import { generateReference } from '../utils/helpers.js';
import { verifyAdbnkSignature } from '../utils/adVerification.js';

export default async function adsRoutes(fastify, opts) {
  
  // ---------------------------------------------------------
  // ADBNK Server-Side Verification (SSV) Webhook
  // Target: https://afristory.onrender.com/api/ads/adbnk-callback
  // ---------------------------------------------------------
  fastify.all('/adbnk-callback', async (request, reply) => {
    const payload = request.method === 'GET' ? request.query : (request.body || {});

    if (!verifyAdbnkSignature(request, payload)) {
      fastify.log.warn('Rejected ADBNK callback with an invalid signature');
      return reply.code(401).send('INVALID_SIGNATURE');
    }

    try {
      fastify.log.info({
        method: request.method,
        transactionId: payload.transactionId || payload.transaction_id || payload.tx_id
      }, 'ADBNK SSV Callback Received');

      // 2. Extract standard ADBNK rewarded callback fields
      const transactionId = payload.transactionId || payload.transaction_id || payload.tx_id;
      const userId = payload.userId || payload.user_id || payload.uid;
      const episodeId = payload.customData || payload.custom_data || payload.extra;

      // Basic validation
      if (!transactionId || !userId || !episodeId) {
        fastify.log.warn('ADBNK Callback missing userId or episodeId');
        return reply.code(200).send('MISSING_DATA');
      }

      const alreadyClaimed = await Transaction.findOne({ 'metadata.adbnkTxId': transactionId });
      if (alreadyClaimed) {
        fastify.log.info(`ADBNK transaction ${transactionId} already processed. Skipping duplicate.`);
        return reply.code(200).send('ALREADY_PROCESSED');
      }

      const session = await mongoose.startSession();
      session.startTransaction();
      let committed = false;

      try {
        const episode = await Episode.findById(episodeId).session(session);
        if (!episode) {
          fastify.log.warn(`ADBNK Callback: Episode ${episodeId} not found`);
          return reply.code(200).send('EPISODE_NOT_FOUND');
        }

        const wallet = await Wallet.findOne({ userId }).session(session);
        if (!wallet) return reply.code(200).send('USER_NOT_FOUND');

        const existingUnlock = await Unlock.findOne({ userId, episodeId, isActive: true }).session(session);
        if (existingUnlock) return reply.code(200).send('ALREADY_UNLOCKED');

        await Unlock.create([{
          userId,
          episodeId,
          seriesId: episode.seriesId,
          method: 'AD',
          provider: 'ADBNK',
          transactionId
        }], { session });

        await Transaction.create([{
          walletId: wallet._id,
          userId,
          type: 'AD_REWARD',
          status: 'SUCCESS',
          amount: mongoose.Types.Decimal128.fromString('0.00'),
          reference: generateReference('ADBNK'),
          description: `Ad unlock via ADBNK (${episode.title || 'Episode'})`,
          metadata: { adbnkTxId: transactionId, episodeId, seriesId: episode.seriesId, provider: 'ADBNK' }
        }], { session });

        await session.commitTransaction();
        committed = true;
        fastify.log.info(`Episode ${episodeId} unlocked successfully for user ${userId} via ADBNK`);

        return reply.code(200).send('OK');
      } finally {
        if (!committed) await session.abortTransaction();
        await session.endSession();
      }

    } catch (error) {
      if (error.code === 11000) return reply.code(200).send('ALREADY_PROCESSED');
      fastify.log.error('ADBNK Webhook Error: ' + error.message);
      return reply.code(200).send('ERROR_HANDLED');
    }
  });

  // ---------------------------------------------------------
  // Episode Access Verification Helper
  // Used by the frontend after ad completion to verify unlock status
  // ---------------------------------------------------------
  fastify.get('/check-unlock/:episodeId', async (request, reply) => {
    try {
      if (!(await verifyAuth(request, reply))) return;
      const { episodeId } = request.params;
      const userId = request.user._id;

      if (!userId || !episodeId) {
        return reply.code(400).send({ unlocked: false });
      }

      const unlocked = await Unlock.findOne({ userId, episodeId, isActive: true });
      return reply.code(200).send({ unlocked: !!unlocked });
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ unlocked: false });
    }
  });
}
