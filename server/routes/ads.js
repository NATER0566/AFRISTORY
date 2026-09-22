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

// PHASE 5.1 FIX: Strict server-side URL validation.
// Ensures that malicious payloads (e.g. javascript: schemes) never reach the frontend.
function validateHttpsUrl(urlStr) {
  if (!urlStr) return null;
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch (e) {
    return null;
  }
  return null;
}

export default async function adsRoutes(fastify, opts) {
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
      // PHASE 5.1 FIX: The clickUrl, imageUrl, and videoUrl are now rigorously validated server-side.
      sendSuccess(reply, {
        adContent: adResponse.data.adContent || adResponse.data.html || null,
        clickUrl: validateHttpsUrl(adResponse.data.clickUrl),
        imageUrl: validateHttpsUrl(adResponse.data.imageUrl),
        videoUrl: validateHttpsUrl(adResponse.data.videoUrl),
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
