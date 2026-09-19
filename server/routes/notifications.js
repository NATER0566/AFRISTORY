import Notification from '../models/Notification.js';
import WebpushrSubscriber from '../models/WebpushrSubscriber.js'; // NEW: Added Webpushr model
import { verifyAuth } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { paginate } from '../utils/helpers.js';
import { createNotification } from '../utils/notificationService.js'; // NEW: Added central service

export default async function notificationRoutes(fastify, opts) {
  
  // NEW: Securely link a Webpushr SID to the authenticated user
  fastify.post('/push/register', async (request, reply) => {
    try {
      await verifyAuth(request, reply);
      if (!request.user) return sendError(reply, 'Unauthorized', 401);

      const { sid } = request.body || {};
      if (!sid) return sendError(reply, 'Subscriber ID is required', 400);

      const existing = await WebpushrSubscriber.findOne({ webpushrSid: sid });

      if (existing) {
        if (existing.userId.toString() !== request.user._id.toString()) {
          // Reassign if a new user logged into the same browser
          existing.userId = request.user._id;
        }
        existing.active = true;
        existing.lastSeenAt = new Date();
        await existing.save();
        return sendSuccess(reply, existing, 'Push subscription updated');
      }

      const subscriber = await WebpushrSubscriber.create({
        userId: request.user._id,
        webpushrSid: sid,
        active: true
      });

      sendSuccess(reply, subscriber, 'Push subscription registered', 201);
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to register push subscription', 500, error.message);
    }
  });

  // Get user notifications
  fastify.get('/me', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { page = 1, limit = 10, read } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      let query = { userId: request.user._id };

      if (read !== undefined) {
        query.read = read === 'true';
      }

      const notifications = await Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(l);

      const total = await Notification.countDocuments(query);

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

  // Mark as read
  fastify.put('/:notificationId/read', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { notificationId } = request.params;

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

  // Mark all as read
  fastify.put('/me/read-all', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

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

  // Delete notification
  fastify.delete('/:notificationId', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { notificationId } = request.params;

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

  // Create notification (internal use)
  fastify.post('/internal/create', { preHandler: verifyAuth }, async (request, reply) => {
    try {
      if (request.user.role !== 'ADMIN') {
        return sendError(reply, 'Forbidden', 403);
      }
      const { userId, type, title, message, data, targetUrl } = request.body || {};

      if (!userId || !type || !title) {
        return sendError(reply, 'Missing required fields', 400);
      }

      // NEW: Use the central service to handle DB save + Push routing
      await createNotification({
        userId,
        type,
        title,
        message,
        data,
        targetUrl
      });

      sendSuccess(reply, null, 'Notification processed successfully', 201);
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to create notification', 500, error.message);
    }
  });
}
