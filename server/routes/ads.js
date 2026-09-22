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

// Strict server-side URL validation.
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
  
  // Secure Adscod Advertising Proxy
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

      // Exact integration parameters required by Adscod
      const params = new URLSearchParams({
        source: 'publisher',
        placementId: '9c206398-e10f-4e3f-893b-481196e8f191'
      });

      const apiUrl = process.env.ADSCOD_API_URL || 'https://api.adscod.com/api/v1/serve';
      const fullUrl = `${apiUrl}?${params.toString()}`;

      // Request ad securely server-to-server using the exact header required
      const adResponse = await axios.get(fullUrl, {
        headers: {
          'X-Adscod-Key': publisherKey,
          'Content-Type': 'application/json'
        },
        timeout: 5000 // 5-second timeout to prevent player freezing if Adscod is slow
      });

      // Adscod returns { ads: [...] }, not a flat object. Check for array length.
      if (!adResponse.data || !adResponse.data.ads || adResponse.data.ads.length === 0) {
         return sendError(reply, 'No sponsored message available.', 404);
      }

      // Extract the first ad from the array
      const ad = adResponse.data.ads[0];

      // Return ONLY the safe rendering data to the browser mapped to Adscod's response structure
      sendSuccess(reply, {
        adContent: ad.body || ad.html || null,
        clickUrl: validateHttpsUrl(ad.clickUrl),
        imageUrl: validateHttpsUrl(ad.imageUrl),
        videoUrl: validateHttpsUrl(ad.videoUrl),
        title: ad.title || 'Sponsored Message',
        description: ad.description || '',
        ctaLabel: ad.ctaLabel || 'Click Here'
      });
    } catch (error) {
      // Graceful failure: If Adscod is down, the user simply sees an unavailable message.
      fastify.log.error('Adscod proxy error: ' + error.message);
      return sendError(reply, 'Sponsored messages are currently unavailable.', 503);
    }
  });
}
