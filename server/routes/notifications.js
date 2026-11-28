import mongoose from 'mongoose';
import Notification from '../models/Notification.js';
import WebpushrSubscriber from '../models/WebpushrSubscriber.js';
import { verifyAuth } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { paginate } from '../utils/helpers.js';
import { createNotification } from '../utils/notificationService.js';

export default async function notificationRoutes(fastify, opts) {
  // Securely link a Webpushr SID to the authenticated user
  fastify.post('/push/register', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (reply.sent) return;
      if (!request.user) {
        console.log('[WEBPUSHR_REGISTER] FAILED reason=authentication_failed');
        return sendError(reply, 'Unauthorized', 401);
      }

      const cleanSid = typeof request.body?.sid === 'string' ? request.body.sid.trim() : '';
      if (!cleanSid) {
        console.log(`[WEBPUSHR_REGISTER] FAILED user=${request.user._id} reason=missing_sid`);
        return sendError(reply, 'Subscriber ID is required', 400);
      }

      const maskedSid = cleanSid.length > 8 ? `${cleanSid.substring(0, 8)}***` : '***';
      console.log(`[WEBPUSHR_REGISTER] request received user=${request.user._id} SID=${maskedSid}`);

      const existing = await WebpushrSubscriber.findOne({ webpushrSid: cleanSid });

      if (existing) {
        let reassigned = false;
        if (existing.userId.toString() !== request.user._id.toString()) {
          // Reassign if a new user logged into the same browser
          existing.userId = request.user._id;
          reassigned = true;
        }
        existing.active = true;
        existing.lastSeenAt = new Date();
        await existing.save();
        console.log(`[WEBPUSHR_REGISTER] subscriber updated reassigned=${reassigned} SUCCESS`);
        return sendSuccess(reply, existing, 'Push subscription updated');
      }

      const subscriber = await WebpushrSubscriber.create({
        userId: request.user._id,
        webpushrSid: cleanSid,
        active: true,
      });

      console.log('[WEBPUSHR_REGISTER] subscriber created SUCCESS');
      sendSuccess(reply, subscriber, 'Push subscription registered', 201);
    } catch (error) {
      console.log(`[WEBPUSHR_REGISTER] FAILED reason=database_error message="${error.message}"`);
      fastify.log.error(error);
      sendError(reply, 'Failed to register push subscription', 500, error.message);
    }
  });

  // Get user notifications
  fastify.get('/me', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (reply.sent) return;

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { page = 1, limit = 10, read } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      const query = { userId: request.user._id };

      if (read !== undefined) {
        query.read = read === 'true';
      }

      const [notifications, total] = await Promise.all([
        Notification.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(l),
        Notification.countDocuments(query),
      ]);

      sendSuccess(reply, {
        notifications,
        pagination: {
          page: p,
          limit: l,
          total,
          pages: Math.ceil(total / l),
        },
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch notifications', 500, error.message);
    }
  });

  // Get unread count
  fastify.get('/me/unread-count', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (reply.sent) return;

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const count = await Notification.countDocuments({
        userId: request.user._id,
        read: false,
      });

      sendSuccess(reply, { unreadCount: count });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch unread count', 500, error.message);
    }
  });

  // Mark all as read
  fastify.put('/me/read-all', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (reply.sent) return;

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      await Notification.updateMany(
        {
          userId: request.user._id,
          read: false,
        },
        {
          read: true,
          readAt: new Date(),
        }
      );

      sendSuccess(reply, null, 'All notifications marked as read');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to mark notifications as read', 500, error.message);
    }
  });

  // Mark single notification as read
  fastify.put('/:notificationId/read', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (reply.sent) return;

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { notificationId } = request.params;
      if (!mongoose.Types.ObjectId.isValid(notificationId)) {
        return sendError(reply, 'Notification not found', 404);
      }

      const notification = await Notification.findById(notificationId);

      if (!notification) {
        return sendError(reply, 'Notification not found', 404);
      }

      if (notification.userId.toString() !== request.user._id.toString()) {
        return sendError(reply, 'Forbidden', 403);
      }

      notification.read = true;
      notification.readAt = new Date();
      await notification.save();

      sendSuccess(reply, notification, 'Notification marked as read');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to mark notification as read', 500, error.message);
    }
  });

  // Delete notification
  fastify.delete('/:notificationId', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (reply.sent) return;

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { notificationId } = request.params;
      if (!mongoose.Types.ObjectId.isValid(notificationId)) {
        return sendError(reply, 'Notification not found', 404);
      }

      const notification = await Notification.findById(notificationId);

      if (!notification) {
        return sendError(reply, 'Notification not found', 404);
      }

      if (notification.userId.toString() !== request.user._id.toString()) {
        return sendError(reply, 'Forbidden', 403);
      }

      await Notification.findByIdAndDelete(notificationId);

      sendSuccess(reply, null, 'Notification deleted');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to delete notification', 500, error.message);
    }
  });

  // Create notification (internal admin use)
  fastify.post('/internal/create', { preHandler: verifyAuth }, async (request, reply) => {
    try {
      if (String(request.user?.role || '').toUpperCase() !== 'ADMIN') {
        return sendError(reply, 'Forbidden', 403);
      }
      const { userId, type, title, message, data, targetUrl } = request.body || {};

      if (!userId || !type || !title) {
        return sendError(reply, 'Missing required fields', 400);
      }

      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return sendError(reply, 'Invalid userId', 400);
      }

      await createNotification({
        userId,
        type,
        title,
        message,
        data,
        targetUrl,
      });

      sendSuccess(reply, null, 'Notification processed successfully', 201);
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to create notification', 500, error.message);
    }
  });

  // Admin safe diagnostics endpoint
  fastify.get('/admin/diagnostics/push', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (reply.sent) return;

      if (!request.user || String(request.user.role || '').toUpperCase() !== 'ADMIN') {
        return sendError(reply, 'Forbidden', 403);
      }

      const [activeCount, totalCount] = await Promise.all([
        WebpushrSubscriber.countDocuments({ active: true }),
        WebpushrSubscriber.countDocuments(),
      ]);

      sendSuccess(reply, {
        webpushrConfiguration: {
          apiKeyPresent: !!process.env.WEBPUSHR_API_KEY,
          authTokenPresent: !!process.env.WEBPUSHR_AUTH_TOKEN,
        },
        subscribers: {
          active: activeCount,
          total: totalCount,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Diagnostics failed', 500, error.message);
    }
  });
}
