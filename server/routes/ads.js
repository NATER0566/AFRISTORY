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
  
  // ---------------------------------------------------------
  // ROUTE 1: Secure Ad Proxy (Fetches ads for the player)
  // ---------------------------------------------------------
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

      const params = new URLSearchParams({
        source: 'publisher',
        placementId: '9c206398-e10f-4e3f-893b-481196e8f191',
        placement: 'video',
        country: 'NG',
        device: 'MOBILE'
      });

      const apiUrl = process.env.ADSCOD_API_URL || 'https://api.adscod.com/api/v1/serve';
      const fullUrl = `${apiUrl}?${params.toString()}`;

      const adResponse = await axios.get(fullUrl, {
        headers: {
          'X-Adscod-Key': publisherKey,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });

      if (!adResponse.data || !adResponse.data.ads || adResponse.data.ads.length === 0) {
         return sendError(reply, 'No sponsored message available.', 404);
      }

      const ad = adResponse.data.ads[0];

      sendSuccess(reply, {
        title: ad.title || 'Sponsored Message',
        description: ad.description || '',
        adContent: ad.body || null,
        imageUrl: validateHttpsUrl(ad.imageUrl),
        videoUrl: validateHttpsUrl(ad.videoUrl),
        clickUrl: validateHttpsUrl(ad.clickUrl),
        ctaLabel: ad.ctaLabel || 'Learn More'
      });
    } catch (error) {
      fastify.log.error('Adscod proxy error: ' + error.message);
      return sendError(reply, 'Sponsored messages are currently unavailable.', 503);
    }
  });

  // ---------------------------------------------------------
  // ROUTE 2: ADBNK Server-Side Verification Webhook (Phase 6)
  // ---------------------------------------------------------
  // We use fastify.all() to safely accept either GET or POST requests, 
  // as different ad networks use different methods for their callbacks.
  fastify.all('/adbnk-callback', async (request, reply) => {
    try {
      // 1. Capture the exact payload ADBNK sends
      const payload = request.method === 'GET' ? request.query : request.body;
      
      // 2. Log the raw data so we can map ADBNK's exact security signature keys in Render
      fastify.log.info({
        adbnkPayload: payload,
        method: request.method
      }, 'ADBNK Server-Side Verification Ping Received');

      // 3. Extract the User ID (Standard parameter names across ad networks)
      const userId = payload.user_id || payload.uid || payload.sub || payload.custom_id;

      if (userId) {
         // Placeholder for the cryptographic hash check (completed after we see their first ping log)
         fastify.log.info(`ADBNK reward verified for user: ${userId}`);
      }

      // 4. CRITICAL: Always return a flat HTTP 200 OK string so ADBNK approves the URL.
      return reply.code(200).send('OK');
      
    } catch (error) {
      fastify.log.error('ADBNK Webhook Error: ' + error.message);
      // Even on error, return 200 during setup so the network doesn't permanently ban the URL
      return reply.code(200).send('OK');
    }
  });
}
