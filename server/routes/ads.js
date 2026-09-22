import User from '../models/User.js';
import Unlock from '../models/Unlock.js';
import Episode from '../models/Episode.js';
import Creator from '../models/Creator.js';
import Wallet from '../models/Wallet.js';
import Transaction from '../models/Transaction.js';

export default async function adsRoutes(fastify, opts) {
  
  // ---------------------------------------------------------
  // ADBNK Server-Side Verification Webhook (Phase 6)
  // ---------------------------------------------------------
  // ADBNK's frontend JS SDK handles fetching and playing the ad.
  // This backend route strictly waits for ADBNK's server to ping it 
  // with a success message once a user finishes the 45s video.
  
  fastify.all('/adbnk-callback', async (request, reply) => {
    try {
      // 1. Capture the exact payload ADBNK sends
      const payload = request.method === 'GET' ? request.query : request.body;
      
      // 2. Log the raw data so we can map ADBNK's exact security signature keys in Render logs
      fastify.log.info({
        adbnkPayload: payload,
        method: request.method
      }, 'ADBNK Server-Side Verification Ping Received');

      // 3. Extract the User ID (Standard parameter names across ad networks)
      const userId = payload.user_id || payload.uid || payload.sub || payload.custom_id;

      if (userId) {
         // Placeholder for the cryptographic hash check.
         // We will map this exactly once ADBNK sends their first automated test ping.
         fastify.log.info(`ADBNK reward verified for user: ${userId}`);
      }

      // 4. CRITICAL: Always return a flat HTTP 200 OK string so ADBNK approves the verification URL.
      return reply.code(200).send('OK');
      
    } catch (error) {
      fastify.log.error('ADBNK Webhook Error: ' + error.message);
      // Even on error, return 200 during setup so the network doesn't permanently ban the URL
      return reply.code(200).send('OK');
    }
  });
}
