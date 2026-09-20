import Comment from '../models/Comment.js';
import Episode from '../models/Episode.js';
import Series from '../models/Series.js'; // NEW: Imported to resolve creator for top-level comments
import { verifyAuth } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { paginate } from '../utils/helpers.js';
import { createNotification } from '../utils/notificationService.js'; // NEW: Central notification service

export default async function commentRoutes(fastify, opts) {
  // Get episode comments
  fastify.get('/episode/:episodeId', async (request, reply) => {
    try {
      const { episodeId } = request.params;
      const { page = 1, limit = 10 } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      const episode = await Episode.findById(episodeId);

      if (!episode) {
        return sendError(reply, 'Episode not found', 404);
      }

      const comments = await Comment.find({
        episodeId,
        parentCommentId: null,
        isDeleted: false,
      })
        .populate('userId', 'username profileImage')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(l);

      const total = await Comment.countDocuments({
        episodeId,
        parentCommentId: null,
        isDeleted: false,
      });

      // Get replies for each comment
      const commentsWithReplies = await Promise.all(
        comments.map(async (comment) => {
          const replies = await Comment.find({
            parentCommentId: comment._id,
            isDeleted: false,
          })
            .populate('userId', 'username profileImage')
            .sort({ createdAt: 1 });

          return {
            ...comment.toObject(),
            replies,
          };
        })
      );

      sendSuccess(reply, {
        comments: commentsWithReplies,
        pagination: {
          page: p,
          limit: l,
          total,
          pages: Math.ceil(total / l),
        },
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch comments', 500, error.message);
    }
  });

  // Create comment
  fastify.post('/create', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { episodeId, text, parentCommentId } = request.body || {};

      if (!episodeId || typeof text !== 'string' || !text.trim()) {
        return sendError(reply, 'Episode ID and text are required', 400);
      }

      if (text.trim().length > 1000) {
        return sendError(reply, 'Comment too long (max 1000 characters)', 400);
      }

      const episode = await Episode.findById(episodeId);

      if (!episode) {
        return sendError(reply, 'Episode not found', 404);
      }

      const comment = new Comment({
        userId: request.user._id,
        episodeId,
        seriesId: episode.seriesId,
        text: text.trim(),
        parentCommentId: parentCommentId || null,
      });

      await comment.save();
      await comment.populate('userId', 'username profileImage');

      // NEW: Trigger Beautiful Branded Notifications asynchronously
      if (parentCommentId) {
        const parentComment = await Comment.findById(parentCommentId);
        // Do not notify a user if they reply to themselves
        if (parentComment && parentComment.userId.toString() !== request.user._id.toString()) {
          createNotification({
            userId: parentComment.userId,
            type: 'COMMENT_REPLY',
            title: 'New Reply 💬',
            message: `${request.user.username} replied to your comment.`,
            targetUrl: '#watch',
            icon: 'https://ui-avatars.com/api/?name=AfriStory&background=d4a017&color=fff&size=192', // ADDED GOLD BRANDING
            image: episode.thumbnailUrl || null, // ADDED: Shows the actual video thumbnail in the pop-up!
            data: { episodeId, commentId: comment._id, parentCommentId },
            dedupeKey: `reply_${comment._id}`
          }).catch(err => fastify.log.error('Push error:', err));
        }
      } else {
        // NEW: Top-level comment logic
        const series = await Series.findById(episode.seriesId);
        if (series && series.creatorId.toString() !== request.user._id.toString()) {
           createNotification({
             userId: series.creatorId,
             type: 'COMMENT',
             title: 'New Comment 💬',
             message: `${request.user.username} commented on your episode.`,
             targetUrl: '#watch',
             icon: 'https://ui-avatars.com/api/?name=AfriStory&background=d4a017&color=fff&size=192', // ADDED GOLD BRANDING
             image: episode.thumbnailUrl || null, // ADDED: Shows the actual video thumbnail in the pop-up!
             dedupeKey: `comment_${comment._id}`
           }).catch(err => fastify.log.error('Push error:', err));
        }
      }

      sendSuccess(reply, comment, 'Comment created successfully', 201);
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to create comment', 500, error.message);
    }
  });

  // Update comment
  fastify.put('/:commentId', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { commentId } = request.params;
      const { text } = request.body || {};

      if (typeof text !== 'string' || !text.trim() || text.length > 1000) {
        return sendError(reply, 'Text is required', 400);
      }

      const comment = await Comment.findById(commentId);

      if (!comment) {
        return sendError(reply, 'Comment not found', 404);
      }

      if (comment.userId.toString() !== request.user._id.toString()) {
        return sendError(reply, 'Forbidden - not comment author', 403);
      }

      comment.text = text.trim();
      comment.isEdited = true;
      await comment.save();

      sendSuccess(reply, comment, 'Comment updated successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to update comment', 500, error.message);
    }
  });

  // Delete comment
  fastify.delete('/:commentId', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { commentId } = request.params;

      const comment = await Comment.findById(commentId);

      if (!comment) {
        return sendError(reply, 'Comment not found', 404);
      }

      if (comment.userId.toString() !== request.user._id.toString()) {
        return sendError(reply, 'Forbidden - not comment author', 403);
      }

      comment.isDeleted = true;
      await comment.save();

      sendSuccess(reply, null, 'Comment deleted successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to delete comment', 500, error.message);
    }
  });

  // Like comment
  fastify.post('/:commentId/like', async (request, reply) => {
    try {
      await verifyAuth(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { commentId } = request.params;

      const comment = await Comment.findById(commentId);

      if (!comment) {
        return sendError(reply, 'Comment not found', 404);
      }

      comment.likes += 1;
      await comment.save();

      sendSuccess(reply, comment, 'Comment liked');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to like comment', 500, error.message);
    }
  });
}
