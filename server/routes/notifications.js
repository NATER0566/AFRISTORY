import Notification from '../models/Notification.js';
import { verifyAuth } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { paginate } from '../utils/helpers.js';

export default async function notificationRoutes(fastify, opts) {
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
      const { userId, type, title, message, data } = request.body || {};

      if (!userId || !type || !title) {
        return sendError(reply, 'Missing required fields', 400);
      }

      const notification = new Notification({
        userId,
        type,
        title,
        message: message || '',
        data: data || {},
      });

      await notification.save();

      sendSuccess(reply, notification, 'Notification created', 201);
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to create notification', 500, error.message);
    }
  });
}
