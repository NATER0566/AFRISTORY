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

// Only allow HTTPS URLs to reach the frontend.
function validateHttpsUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') {
    return null;
  }

  try {
    const parsed = new URL(urlStr);

    if (parsed.protocol !== 'https:') {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export default async function adsRoutes(fastify, opts) {

  /*
   * GET /serve
   *
   * Secure server-side Adscod publisher proxy.
   *
   * IMPORTANT:
   * - The Adscod publisher key NEVER reaches the browser.
   * - This requests the VIDEO slot.
   * - This endpoint does NOT grant an episode unlock.
   * - The frontend must render videoUrl when Adscod returns one.
   */
  fastify.get('/serve', async (request, reply) => {
    try {

      // ---------------------------------------------------------
      // 1. Require authenticated user
      // ---------------------------------------------------------

      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }


      // ---------------------------------------------------------
      // 2. Get Adscod publisher key
      // ---------------------------------------------------------

      const publisherKey = process.env.ADSCOD_PUBLISHER_KEY;

      if (!publisherKey) {
        fastify.log.error(
          'ADSCOD_PUBLISHER_KEY is missing from environment variables.'
        );

        return sendError(
          reply,
          'Sponsored messages are currently unavailable.',
          503
        );
      }


      // ---------------------------------------------------------
      // 3. Request the VIDEO placement from Adscod
      // ---------------------------------------------------------

      const params = new URLSearchParams({
        source: 'publisher',

        // Your Adscod placement ID
        placementId: '9c206398-e10f-4e3f-893b-481196e8f191',

        // IMPORTANT:
        // This tells Adscod this request is for the video slot.
        placement: 'video',

        // Current user's market/device
        country: 'NG',
        device: 'MOBILE',

        // We only need one advertisement.
        limit: '1'
      });


      // ---------------------------------------------------------
      // 4. Adscod API endpoint
      // ---------------------------------------------------------

      const apiUrl =
        process.env.ADSCOD_API_URL ||
        'https://api.adscod.com/api/v1/serve';

      const fullUrl = `${apiUrl}?${params.toString()}`;


      // ---------------------------------------------------------
      // 5. Server-to-server request
      // ---------------------------------------------------------

      const adResponse = await axios.get(fullUrl, {
        headers: {
          'X-Adscod-Key': publisherKey,
          'Accept': 'application/json'
        },

        timeout: 5000
      });


      // ---------------------------------------------------------
      // 6. Validate Adscod response
      // ---------------------------------------------------------

      const ads = adResponse?.data?.ads;

      if (!Array.isArray(ads) || ads.length === 0) {
        fastify.log.info(
          {
            placementId: '9c206398-e10f-4e3f-893b-481196e8f191',
            placement: 'video'
          },
          'Adscod returned no ads'
        );

        return sendError(
          reply,
          'No sponsored message available.',
          404
        );
      }


      // ---------------------------------------------------------
      // 7. Get first matched advertisement
      // ---------------------------------------------------------

      const ad = ads[0];


      // ---------------------------------------------------------
      // 8. Diagnostic information
      // ---------------------------------------------------------
      //
      // This is intentionally useful for debugging.
      //
      // DO NOT log the publisher API key.
      //

      fastify.log.info(
        {
          campaignId: ad.campaignId || null,
          title: ad.title || null,
          ctaLabel: ad.ctaLabel || null,
          hasVideoUrl: Boolean(ad.videoUrl),
          hasImageUrl: Boolean(ad.imageUrl),
          hasClickUrl: Boolean(ad.clickUrl),
          cpcUsd: ad.cpcUsd || null,
          matchContext: ad.matchContext || null
        },
        'Adscod video-placement response'
      );


      // ---------------------------------------------------------
      // 9. Prepare safe response for frontend
      // ---------------------------------------------------------

      const safeAd = {
        title: ad.title || 'Sponsored Message',

        description:
          ad.description ||
          ad.body ||
          '',

        adContent:
          ad.body ||
          null,

        imageUrl:
          validateHttpsUrl(ad.imageUrl),

        videoUrl:
          validateHttpsUrl(ad.videoUrl),

        clickUrl:
          validateHttpsUrl(ad.clickUrl),

        ctaLabel:
          ad.ctaLabel ||
          'Learn More',

        // Useful for your frontend/debugging.
        // This does NOT mean the user has watched the ad.
        hasVideo:
          Boolean(validateHttpsUrl(ad.videoUrl))
      };


      // ---------------------------------------------------------
      // 10. Return safe data to frontend
      // ---------------------------------------------------------

      return sendSuccess(reply, safeAd);

    } catch (error) {

      // ---------------------------------------------------------
      // Handle Adscod/API errors
      // ---------------------------------------------------------

      fastify.log.error(
        {
          message: error.message,
          status: error.response?.status || null,
          data: error.response?.data || null
        },
        'Adscod proxy error'
      );

      return sendError(
        reply,
        'Sponsored messages are currently unavailable.',
        503
      );
    }
  });
}
