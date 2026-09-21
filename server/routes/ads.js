import User from '../models/User.js';
import Unlock from '../models/Unlock.js';
import Episode from '../models/Episode.js';
import Creator from '../models/Creator.js';
import Wallet from '../models/Wallet.js';
import Transaction from '../models/Transaction.js';
import { verifyAuth } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { isResetTime, generateReference } from '../utils/helpers.js';
import mongoose from 'mongoose';
import axios from 'axios';

export default async function adsRoutes(fastify, opts) {
  // PHASE 3 CLEANUP: All legacy routes (/unlocks/remaining, /verify-completion)
  // and the placeholder Monetag /webhook have been permanently removed.
  // 
  // This file remains securely in the architecture. When a genuinely 
  // trusted provider-verified reward mechanism (like a server-to-server 
  // callback) is available, its secure webhook endpoint will be implemented here.

  // PHASE 4/5: Secure Adscod Advertising Proxy
  // This endpoint fetches an ad from Adscod server-side.
  // It DOES NOT grant premium unlocks.
  fastify.get('/serve', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      
      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const publisherKey = process.env.ADSCOD_PUBLISHER_KEY;
      
      if (!publisherKey) {
        fastify.log.warn('ADSCOD_PUBLISHER_KEY is missing from environment variables.');
        return sendError(reply, 'Sponsored messages are currently unavailable.', 503);
      }

      // PHASE 5 FIX: Corrected Adscod API fallback URL to match provider documentation
      const apiUrl = process.env.ADSCOD_API_URL || 'https://api.adscod.com/api/v1/serve';

      // Request ad securely server-to-server
      const adResponse = await axios.get(apiUrl, {
        headers: {
          'Authorization': `Bearer ${publisherKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000 // 5-second timeout to prevent player freezing if Adscod is slow
      });

      if (!adResponse.data) {
         return sendError(reply, 'No sponsored message available.', 404);
      }

      // Return ONLY the safe rendering data to the browser.
      // The publisher key and raw API data are strictly stripped.
      sendSuccess(reply, {
        adContent: adResponse.data.adContent || adResponse.data.html || null,
        clickUrl: adResponse.data.clickUrl || null,
        imageUrl: adResponse.data.imageUrl || null,
        videoUrl: adResponse.data.videoUrl || null,
        title: adResponse.data.title || 'Sponsored Message',
        description: adResponse.data.description || ''
      });
    } catch (error) {
      // Graceful failure: If Adscod is down, the user simply sees an unavailable message.
      fastify.log.error('Adscod proxy error: ' + error.message);
      return sendError(reply, 'Sponsored messages are currently unavailable.', 503);
    }
  });
}
