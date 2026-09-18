import User from '../models/User.js';
import Creator from '../models/Creator.js';
import Report from '../models/Report.js';
import Series from '../models/Series.js';
import Episode from '../models/Episode.js';
import { verifyAdmin } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { paginate, formatDecimal } from '../utils/helpers.js';

export default async function adminRoutes(fastify, opts) {
  // Get admin dashboard stats
  fastify.get('/dashboard/stats', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const totalUsers = await User.countDocuments();
      const totalCreators = await Creator.countDocuments();
      const totalSeries = await Series.countDocuments();
      const totalEpisodes = await Episode.countDocuments();
      const pendingReports = await Report.countDocuments({ status: 'PENDING' });

      sendSuccess(reply, {
        totalUsers,
        totalCreators,
        totalSeries,
        totalEpisodes,
        pendingReports,
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch dashboard stats', 500, error.message);
    }
  });

  // Get all users (admin)
  fastify.get('/users', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { page = 1, limit = 10, role } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      let query = {};
      if (role) {
        query.role = role;
      }

      const users = await User.find(query)
        .select('-passwordHash -pinHash')
        .skip(skip)
        .limit(l)
        .sort({ createdAt: -1 });

      const total = await User.countDocuments(query);

      sendSuccess(reply, {
        users,
        pagination: {
          page: p,
          limit: l,
          total,
          pages: Math.ceil(total / l),
        },
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch users', 500, error.message);
    }
  });

  // Suspend user
  fastify.put('/users/:userId/suspend', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { userId } = request.params;

      const user = await User.findById(userId);

      if (!user) {
        return sendError(reply, 'User not found', 404);
      }

      user.isActive = false;
      await user.save();

      sendSuccess(reply, null, 'User suspended');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to suspend user', 500, error.message);
    }
  });

  // Unsuspend user
  fastify.put('/users/:userId/unsuspend', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { userId } = request.params;

      const user = await User.findById(userId);

      if (!user) {
        return sendError(reply, 'User not found', 404);
      }

      user.isActive = true;
      await user.save();

      sendSuccess(reply, null, 'User unsuspended');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to unsuspend user', 500, error.message);
    }
  });

  // Get reports
  fastify.get('/reports', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { page = 1, limit = 10, status = 'PENDING' } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      const reports = await Report.find({ status })
        .populate('reportedBy', 'username email')
        .populate('resolvedBy', 'username')
        .skip(skip)
        .limit(l)
        .sort({ createdAt: -1 });

      const total = await Report.countDocuments({ status });

      sendSuccess(reply, {
        reports,
        pagination: {
          page: p,
          limit: l,
          total,
          pages: Math.ceil(total / l),
        },
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch reports', 500, error.message);
    }
  });

  // Resolve report
  fastify.put('/reports/:reportId/resolve', async (request, reply) => {
    try {
      await verifyAdmin(request, reply);

      if (!request.user) {
        return sendError(reply, 'Unauthorized', 401);
      }

      const { reportId } = request.params;
      const { status, adminNotes, actionTaken } = request.body || {};

      if (!status || !['RESOLVED', 'DISMISSED'].includes(status)) {
        return sendError(reply, 'Invalid status', 400);
      }

      const report = await Report.findById(reportId);

      if (!report) {
        return sendError(reply, 'Report not found', 404);
      }

      report.status = status;
      report.adminNotes = adminNotes || '';
      report.resolvedBy = request.user._id;
      report.resolvedAt = new Date();
      await report.save();

      // TODO: If actionTaken is 'suspend', suspend the reported user
      // TODO: If actionTaken is 'remove_content', delete the reported content

      sendSuccess(reply, report, 'Report resolved');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to resolve report', 500, error.message);
    }
  });

  // Verify creator
  fastify.put('/creators/:creatorId/verify', async (request, reply) => {
    try {
      await verifyAdmin(request, reply);

      const { creatorId } = request.params;

      const creator = await Creator.findById(creatorId);

      if (!creator) {
        return sendError(reply, 'Creator not found', 404);
      }

      creator.isVerified = true;
      await creator.save();

      sendSuccess(reply, null, 'Creator verified');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to verify creator', 500, error.message);
    }
  });

  // Get analytics
  fastify.get('/analytics', async (request, reply) => {
    try {
      await verifyAdmin(request, reply);

      const { startDate, endDate } = request.query;

      let query = {};
      if (startDate && endDate) {
        query.createdAt = {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        };
      }

      const newUsers = await User.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      });

      const newSeries = await Series.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      });

      const newEpisodes = await Episode.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      });

      sendSuccess(reply, {
        newUsersLast30Days: newUsers,
        newSeriesLast30Days: newSeries,
        newEpisodesLast30Days: newEpisodes,
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch analytics', 500, error.message);
    }
  });

  // NEW FEATURE: Lightweight Performance & Error Logger
  // Note: No verifyAdmin here so regular users can submit errors!
  fastify.post('/log-client-error', async (request, reply) => {
    try {
      const { type, message, stack, url, time, userId } = request.body || {};

      // Log directly to the Fastify logger (which admins/system monitors can read via terminal/logs)
      fastify.log.warn({
        event: 'CLIENT_PERFORMANCE_LOG',
        userId: userId || 'unauthenticated',
        type: type || 'unknown',
        message: message || 'No message',
        stack: stack || 'No stack',
        url: url || 'Unknown URL',
        clientTime: time || new Date().toISOString()
      });

      return sendSuccess(reply, { logged: true });
    } catch (error) {
      // Fail silently for performance loggers to avoid interrupting the client
      fastify.log.error('Failed to process client log', error);
      return reply.code(200).send({ success: true, data: { logged: false }});
    }
  });
}
