import mongoose from 'mongoose';
import Episode from '../models/Episode.js';
import Unlock from '../models/Unlock.js';
import PendingReward from '../models/PendingReward.js';
import AdbnkReward from '../models/AdbnkReward.js';
import { verifyAuth } from '../middleware/auth.js';
import { sendError, sendSuccess } from '../utils/response.js';

export const ADBNK_ZONE_CODE = 'zone_f3fcad23db83';
export const ADBNK_VERIFY_URL = 'https://api.adbnk.co/ad/reward/verify';
export const ADBNK_CALLBACK_URL = 'https://afristory.onrender.com/api/ads/adbnk-callback';

export const ADBNK_ZONE_ID_MAP = { "1040": "zone_f3fcad23db83" };

export function normalizeAdbnkPayload(payload = {}) {
  return {
    transactionId: payload.transactionId || payload.transaction_id || null,
    signature: payload.signature || null,
    keyId: payload.keyId || payload.key_id || null,
    userId: payload.userId || payload.user_id || null,
    customData: payload.customData || payload.custom_data || null,
    zoneId: payload.zoneId || payload.zone_id || null,
    pendingId: payload.pendingId || payload.pending_id || null,
  };
}

export function validateAdbnkRecord(record, expected) {
  if (!record || record.valid !== true) return { valid: false, reason: 'provider_invalid' };
  if (record.zone_id === undefined || record.zone_id === null || record.zone_id === '') {
    return { valid: false, reason: 'zone_unmapped' };
  }

  const mappedZone = ADBNK_ZONE_ID_MAP[String(record.zone_id)];
  if (mappedZone !== ADBNK_ZONE_CODE) return { valid: false, reason: 'zone_unmapped' };

  if (expected?.userId && String(record.user_id) !== String(expected.userId)) {
    return { valid: false, reason: 'user_mismatch' };
  }
  if (expected?.episodeId && String(record.custom_data) !== String(expected.episodeId)) {
    return { valid: false, reason: 'episode_mismatch' };
  }
  return { valid: true };
}

export async function verifyWithAdbnk({ transactionId, signature, keyId, fetchImpl = fetch }) {
  if (!transactionId || !signature || !keyId) {
    const error = new Error('Missing ADBNK verification fields');
    error.statusCode = 400;
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetchImpl(ADBNK_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transaction_id: transactionId,
        signature,
        key_id: keyId,
      }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.code !== 0) {
      const error = new Error('ADBNK verification request failed');
      error.statusCode = response.status >= 500 ? 503 : 403;
      throw error;
    }
    return body.data || {};
  } finally {
    clearTimeout(timeout);
  }
}

async function markPendingFailed(pendingId) {
  if (!pendingId || !mongoose.isValidObjectId(pendingId)) return;
  await PendingReward.updateOne(
    { _id: pendingId, status: 'pending' },
    { $set: { status: 'failed' } }
  );
}

async function grantAdbnkReward({ providerRecord, pending, userId, episodeId, source, transactionId }) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const existing = await AdbnkReward.findOne({ transactionId }).session(session);
    if (existing) {
      await session.abortTransaction();
      return { duplicate: true, unlocked: true };
    }

    const episode = await Episode.findById(episodeId).session(session);
    if (!episode) throw Object.assign(new Error('Episode not found'), { statusCode: 404 });

    const unlock = await Unlock.findOne({ userId, episodeId, isActive: true }).session(session);
    if (!unlock) {
      await Unlock.create([{
        userId,
        episodeId,
        seriesId: episode.seriesId,
        method: 'AD',
        provider: 'ADBNK',
        transactionId,
      }], { session });
      await Episode.updateOne({ _id: episodeId }, { $inc: { totalUnlocks: 1, totalAdUnlocks: 1 } }, { session });
    }

    await AdbnkReward.create([{
      transactionId,
      userId,
      episodeId,
      pendingRewardId: pending?._id || null,
      providerData: providerRecord,
      source,
    }], { session });

    if (pending) {
      await PendingReward.updateOne(
        { _id: pending._id, status: 'pending' },
        { $set: { status: 'used' } },
        { session }
      );
    }

    await session.commitTransaction();
    return { duplicate: false, unlocked: true };
  } catch (error) {
    await session.abortTransaction();
    if (error?.code === 11000) return { duplicate: true, unlocked: true };
    throw error;
  } finally {
    await session.endSession();
  }
}

async function loadPendingForUser(pendingId, userId) {
  if (!pendingId || !mongoose.isValidObjectId(pendingId)) return null;
  const pending = await PendingReward.findOne({ _id: pendingId, userId });
  if (!pending || pending.status !== 'pending' || pending.expiresAt <= new Date()) return null;
  return pending;
}

export default async function adsRoutes(fastify) {
  fastify.post('/adbnk/pending', async (request, reply) => {
    if (!(await verifyAuth(request, reply)) || !request.user) return;
    const { episodeId } = request.body || {};
    if (!mongoose.isValidObjectId(episodeId)) return sendError(reply, 'Valid episode ID is required', 400);

    const episode = await Episode.findById(episodeId).select('_id isFree adUnlockable');
    if (!episode || episode.isFree || !episode.adUnlockable) return sendError(reply, 'Episode is not eligible for ad unlock', 400);

    const pending = await PendingReward.create({
      userId: request.user._id,
      episodeId,
      zoneCode: ADBNK_ZONE_CODE,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    return sendSuccess(reply, { pendingId: pending._id.toString(), zoneCode: ADBNK_ZONE_CODE });
  });

  fastify.post('/adbnk/verify', async (request, reply) => {
    if (!(await verifyAuth(request, reply)) || !request.user) return;
    const { transactionId, signature, keyId, pendingId } = request.body || {};
    if (!transactionId || !signature || !keyId || !pendingId) return sendError(reply, 'Missing ADBNK verification fields', 400);

    const pending = await loadPendingForUser(pendingId, request.user._id);
    if (!pending) {
      const pendingById = mongoose.isValidObjectId(pendingId) ? await PendingReward.findOne({ _id: pendingId, userId: request.user._id }) : null;
      if (!pendingById || pendingById.status !== 'pending' || pendingById.expiresAt <= new Date()) {
        return sendError(reply, 'Pending reward is invalid or expired', 403);
      }
    }
    const validPending = pending || await PendingReward.findOne({ _id: pendingId, userId: request.user._id, status: 'pending' });

    let providerRecord;
    try {
      providerRecord = await verifyWithAdbnk({ transactionId, signature, keyId });
    } catch (error) {
      await markPendingFailed(pendingId);
      return sendError(reply, error.statusCode === 503 ? 'ADBNK verification unavailable' : 'ADBNK reward is invalid', error.statusCode || 403);
    }

    const expected = { userId: request.user._id, episodeId: validPending.episodeId };
    if (providerRecord.user_id !== undefined || providerRecord.custom_data !== undefined || providerRecord.zone_id !== undefined) {
      const validation = validateAdbnkRecord(providerRecord, expected);
      if (!validation.valid) {
        await markPendingFailed(pendingId);
        return sendError(reply, 'ADBNK reward does not match this unlock request', 403);
      }
    } else if (providerRecord.valid !== true) {
      await markPendingFailed(pendingId);
      return sendError(reply, 'ADBNK reward is invalid', 403);
    }

    try {
      const result = await grantAdbnkReward({
        providerRecord,
        pending: validPending,
        userId: request.user._id,
        episodeId: validPending.episodeId,
        source: 'verify',
        transactionId,
      });
      return sendSuccess(reply, result, result.duplicate ? 'Reward already processed' : 'Episode unlocked');
    } catch (error) {
      fastify.log.error(error);
      return sendError(reply, 'Unable to apply ADBNK reward', error.statusCode || 500);
    }
  });

  fastify.all('/adbnk-callback', async (request, reply) => {
    const payload = request.method === 'GET' ? request.query : (request.body || {});
    const fields = normalizeAdbnkPayload(payload);
    if (!fields.transactionId || !fields.signature || !fields.keyId) return reply.code(400).send({ ok: false });

    try {
      const providerRecord = await verifyWithAdbnk(fields);
      if (providerRecord.valid !== true) return reply.code(200).send({ ok: false });

      const existing = await AdbnkReward.findOne({ transactionId: fields.transactionId });
      if (existing) return reply.code(200).send({ ok: true, duplicate: true });

      if (!mongoose.isValidObjectId(providerRecord.user_id) || !mongoose.isValidObjectId(providerRecord.custom_data)) {
        request.log.warn({ transactionId: fields.transactionId }, 'ADBNK callback has no usable server association');
        return reply.code(200).send({ ok: false, manualReview: true });
      }

      const pending = await PendingReward.findOne({
        userId: providerRecord.user_id,
        episodeId: providerRecord.custom_data,
        zoneCode: ADBNK_ZONE_CODE,
        status: 'pending',
        expiresAt: { $gt: new Date() },
      });
      if (!pending) return reply.code(200).send({ ok: false, manualReview: true });

      const validation = validateAdbnkRecord(providerRecord, {
        userId: pending.userId,
        episodeId: pending.episodeId,
      });
      if (!validation.valid) {
        request.log.warn({ transactionId: fields.transactionId, reason: validation.reason }, 'ADBNK callback rejected');
        return reply.code(200).send({ ok: false, manualReview: true });
      }

      await grantAdbnkReward({
        providerRecord,
        pending,
        userId: pending.userId,
        episodeId: pending.episodeId,
        source: 'ssv',
        transactionId: fields.transactionId,
      });
      return reply.code(200).send({ ok: true });
    } catch (error) {
      request.log.error(error);
      return reply.code(error.statusCode === 503 ? 503 : 200).send({ ok: false });
    }
  });

  fastify.get('/check-unlock/:episodeId', async (request, reply) => {
    if (!(await verifyAuth(request, reply)) || !request.user) return;
    const unlocked = await Unlock.exists({ userId: request.user._id, episodeId: request.params.episodeId, isActive: true });
    return reply.send({ unlocked: Boolean(unlocked) });
  });
}
