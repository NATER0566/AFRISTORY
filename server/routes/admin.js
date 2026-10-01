import mongoose from 'mongoose';
import User from '../models/User.js';
import Creator from '../models/Creator.js';
import Report from '../models/Report.js';
import Series from '../models/Series.js';
import Episode from '../models/Episode.js';
import Wallet from '../models/Wallet.js';
import Transaction from '../models/Transaction.js';
import { verifyAdmin } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { paginate, formatDecimal } from '../utils/helpers.js';
import { createNotification } from '../utils/notificationService.js';

// =========================================================================
// DYNAMIC BANNER SCHEMA
// =========================================================================
const bannerSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  mediaUrl: { type: String, required: true },
  mediaType: { type: String, enum: ['IMAGE', 'VIDEO'], required: true },
  targetUrl: { type: String },
  buttonText: { type: String },
  badgeText: { type: String },
  category: { type: String, enum: ['PROMO_IMAGE', 'PROMO_VIDEO', 'TRENDING'], required: true },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});
const Banner = mongoose.models.Banner || mongoose.model('Banner', bannerSchema);

export default async function adminRoutes(fastify, opts) {

  // =========================================================================
  // 1. DASHBOARD ANALYTICS & STATS
  // =========================================================================

  fastify.get('/dashboard/stats', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const [
        totalUsers,
        totalCreators,
        pendingCreators,
        totalSeries,
        totalEpisodes,
        pendingReports,
        pendingPayouts
      ] = await Promise.all([
        User.countDocuments(),
        Creator.countDocuments({ isVerified: true }),
        Creator.countDocuments({ applicationStatus: 'PENDING' }), // Updated to check status
        Series.countDocuments(),
        Episode.countDocuments(),
        Report.countDocuments({ status: 'PENDING' }),
        Transaction.countDocuments({ type: 'WITHDRAWAL', status: 'PENDING' })
      ]);

      const revenueAggregate = await Transaction.aggregate([
        { $match: { status: 'COMPLETED', type: {$in: ['COIN_PURCHASE', 'PAYOUT', 'UNLOCK'] } } },
        { $group: { _id: null, totalVolume: { $sum: '$amount' } } }
      ]);

      const totalVolume = revenueAggregate[0]?.totalVolume || 0;

      sendSuccess(reply, {
        totalUsers,
        totalCreators,
        pendingCreators,
        totalSeries,
        totalEpisodes,
        pendingReports,
        pendingPayouts,
        totalVolume: formatDecimal(totalVolume)
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch dashboard stats', 500, error.message);
    }
  });

  fastify.get('/analytics', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { startDate, endDate } = request.query;
      let dateFilter = { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };

      if (startDate && endDate) {
        dateFilter = {
          $gte: new Date(startDate),$lte: new Date(endDate)
        };
      }

      const [newUsers, newSeries, newEpisodes, newTransactions] = await Promise.all([
        User.countDocuments({ createdAt: dateFilter }),
        Series.countDocuments({ createdAt: dateFilter }),
        Episode.countDocuments({ createdAt: dateFilter }),
        Transaction.countDocuments({ createdAt: dateFilter, status: 'COMPLETED' })
      ]);

      sendSuccess(reply, {
        period: {
          start: startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          end: endDate || new Date().toISOString()
        },
        newUsers,
        newSeries,
        newEpisodes,
        newTransactions
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch analytics', 500, error.message);
    }
  });

  // =========================================================================
  // HOMEPAGE BANNERS & SLIDESHOWS
  // =========================================================================

  fastify.get('/banners', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;
      
      const { type } = request.query; 
      let query = { isActive: true };
      if (type) query.mediaType = type;

      const banners = await Banner.find(query).sort({ createdAt: -1 });
      sendSuccess(reply, banners);
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch banners', 500, error.message);
    }
  });

  fastify.post('/banners', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;
      
      const newBanner = new Banner(request.body);
      await newBanner.save();
      
      sendSuccess(reply, newBanner, 'Banner created successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to create banner', 500, error.message);
    }
  });

  fastify.delete('/banners/:id', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;
      
      const { id } = request.params;
      await Banner.findByIdAndDelete(id);
      
      sendSuccess(reply, null, 'Banner deleted successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to delete banner', 500, error.message);
    }
  });

  // =========================================================================
  // 2. USER MANAGEMENT
  // =========================================================================

  fastify.get('/users', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { page = 1, limit = 10, role, search, status } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      let query = {};
      if (role) query.role = role;
      if (status === 'active') query.isActive = true;
      if (status === 'suspended') query.isActive = false;

      if (search) {
        query.$or = [
          { username: { $regex: search,$options: 'i' } },
          { email: { $regex: search,$options: 'i' } }
        ];
      }

      const [users, total] = await Promise.all([
        User.find(query)
          .select('-passwordHash -pinHash')
          .skip(skip)
          .limit(l)
          .sort({ createdAt: -1 }),
        User.countDocuments(query)
      ]);

      sendSuccess(reply, {
        users,
        pagination: {
          page: p,
          limit: l,
          total,
          pages: Math.ceil(total / l)
        }
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch users', 500, error.message);
    }
  });

  fastify.get('/users/:userId', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { userId } = request.params;
      const user = await User.findById(userId).select('-passwordHash -pinHash');
      if (!user) return sendError(reply, 'User not found', 404);

      const [creatorProfile, wallet] = await Promise.all([
        Creator.findOne({ userId }),
        Wallet.findOne({ userId })
      ]);

      sendSuccess(reply, {
        user,
        creatorProfile: creatorProfile || null,
        wallet: wallet || null
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch user details', 500, error.message);
    }
  });

  fastify.put('/users/:userId/suspend', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { userId } = request.params;
      const { reason } = request.body || {};

      const user = await User.findById(userId);
      if (!user) return sendError(reply, 'User not found', 404);

      user.isActive = false;
      await user.save();

      createNotification({
        userId: user._id,
        type: 'ACCOUNT_SUSPENDED',
        title: 'Account Suspended',
        message: reason || 'Your account has been suspended for violating terms of service.',
        targetUrl: '#support',
        dedupeKey: `user_suspend_${user._id}_${Date.now()}`
      }).catch(err => fastify.log.error('Notification error:', err));

      sendSuccess(reply, null, 'User suspended successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to suspend user', 500, error.message);
    }
  });

  fastify.put('/users/:userId/unsuspend', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { userId } = request.params;
      const user = await User.findById(userId);
      if (!user) return sendError(reply, 'User not found', 404);

      user.isActive = true;
      await user.save();

      sendSuccess(reply, null, 'User unsuspended successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to unsuspend user', 500, error.message);
    }
  });

  // =========================================================================
  // 3. CREATOR ONBOARDING & VERIFICATION
  // =========================================================================

  fastify.get('/creators', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { page = 1, limit = 10, verified } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      let query = {};
      if (verified !== undefined) {
        // Check for PENDING status so rejected ones don't show up in the admin list
        if (verified === 'false') {
          query.applicationStatus = 'PENDING';
        } else {
          query.isVerified = true;
        }
      }

      const [creators, total] = await Promise.all([
        Creator.find(query)
          .populate('userId', 'username email avatar')
          .skip(skip)
          .limit(l)
          .sort({ createdAt: -1 }),
        Creator.countDocuments(query)
      ]);

      sendSuccess(reply, {
        creators,
        pagination: {
          page: p,
          limit: l,
          total,
          pages: Math.ceil(total / l)
        }
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch creators', 500, error.message);
    }
  });

  // APPROVE CREATOR
  fastify.put('/creators/:creatorId/verify', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { creatorId } = request.params;
      const creator = await Creator.findById(creatorId);
      if (!creator) return sendError(reply, 'Creator not found', 404);

      // Set to approved
      creator.isVerified = true;
      creator.applicationStatus = 'APPROVED';
      creator.rejectionReason = null;
      await creator.save();

      await User.findByIdAndUpdate(creator.userId, { role: 'CREATOR' });

      createNotification({
        userId: creator.userId,
        type: 'CREATOR_VERIFIED',
        title: 'Creator Account Approved! 🌟',
        message: 'Your creator verification has been approved. You can now publish stories and monetize.',
        targetUrl: '#creator-dashboard',
        dedupeKey: `creator_verify_${creator._id}`
      }).catch(err => fastify.log.error('Notification error:', err));

      sendSuccess(reply, creator, 'Creator verified successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to verify creator', 500, error.message);
    }
  });

  // REJECT CREATOR (Keeps the record, sets status to REJECTED)
  fastify.put('/creators/:creatorId/reject', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { creatorId } = request.params;
      const { reason } = request.body || {};

      const creator = await Creator.findById(creatorId);
      if (!creator) return sendError(reply, 'Creator not found', 404);

      // Update to rejected
      creator.isVerified = false;
      creator.applicationStatus = 'REJECTED';
      creator.rejectionReason = reason || 'Your creator application requires changes or has been declined.';
      await creator.save();

      createNotification({
        userId: creator.userId,
        type: 'CREATOR_REJECTED',
        title: 'Creator Application Update',
        message: creator.rejectionReason,
        targetUrl: '#creator-setup',
        dedupeKey: `creator_reject_${creator._id}_${Date.now()}`
      }).catch(err => fastify.log.error('Notification error:', err));

      sendSuccess(reply, creator, 'Creator verification rejected');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to reject creator', 500, error.message);
    }
  });

  // =========================================================================
  // 4. CONTENT MODERATION (SERIES & EPISODES)
  // =========================================================================

  fastify.get('/series', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { page = 1, limit = 10, search, published } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      let query = {};
      if (published !== undefined) query.isPublished = published === 'true';
      if (search) query.title = { $regex: search,$options: 'i' };

      const [seriesList, total] = await Promise.all([
        Series.find(query)
          .populate('creatorId', 'name penName')
          .skip(skip)
          .limit(l)
          .sort({ createdAt: -1 }),
        Series.countDocuments(query)
      ]);

      sendSuccess(reply, {
        series: seriesList,
        pagination: {
          page: p,
          limit: l,
          total,
          pages: Math.ceil(total / l)
        }
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch series list', 500, error.message);
    }
  });

  fastify.put('/series/:seriesId/status', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { seriesId } = request.params;
      const { isPublished, isFlagged, reason } = request.body || {};

      const series = await Series.findById(seriesId);
      if (!series) return sendError(reply, 'Series not found', 404);

      if (isPublished !== undefined) series.isPublished = isPublished;
      if (isFlagged !== undefined) series.isFlagged = isFlagged;
      await series.save();

      sendSuccess(reply, series, 'Series status updated successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to update series status', 500, error.message);
    }
  });

  fastify.delete('/episodes/:episodeId', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { episodeId } = request.params;
      const episode = await Episode.findById(episodeId);
      if (!episode) return sendError(reply, 'Episode not found', 404);

      await Series.findByIdAndUpdate(episode.seriesId, {
        $inc: { totalEpisodes: -1 }
      });

      await Episode.findByIdAndDelete(episodeId);

      sendSuccess(reply, null, 'Episode permanently deleted by administrator');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to delete episode', 500, error.message);
    }
  });

  // =========================================================================
  // 5. REPORT & DISPUTE RESOLUTION (WITH AUTOMATIC ENFORCEMENT)
  // =========================================================================

  fastify.get('/reports', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { page = 1, limit = 10, status = 'PENDING' } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      const [reports, total] = await Promise.all([
        Report.find({ status })
          .populate('reportedBy', 'username email')
          .populate('resolvedBy', 'username')
          .skip(skip)
          .limit(l)
          .sort({ createdAt: -1 }),
        Report.countDocuments({ status })
      ]);

      sendSuccess(reply, {
        reports,
        pagination: {
          page: p,
          limit: l,
          total,
          pages: Math.ceil(total / l)
        }
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch reports', 500, error.message);
    }
  });

  fastify.put('/reports/:reportId/resolve', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { reportId } = request.params;
      const { status, adminNotes, actionTaken } = request.body || {};

      if (!status || !['RESOLVED', 'DISMISSED'].includes(status)) {
        return sendError(reply, 'Status must be either RESOLVED or DISMISSED', 400);
      }

      const report = await Report.findById(reportId);
      if (!report) return sendError(reply, 'Report not found', 404);

      // Execute automated sanctions based on actionTaken
      if (actionTaken === 'suspend_user' && report.targetUser) {
        await User.findByIdAndUpdate(report.targetUser, { isActive: false });
      } else if (actionTaken === 'remove_content' && report.targetId && report.targetType) {
        if (report.targetType === 'SERIES') {
          await Series.findByIdAndUpdate(report.targetId, { isPublished: false, isFlagged: true });
        } else if (report.targetType === 'EPISODE') {
          await Episode.findByIdAndUpdate(report.targetId, { isPublished: false, isFlagged: true });
        }
      }

      report.status = status;
      report.adminNotes = adminNotes || '';
      report.actionTaken = actionTaken || 'none';
      report.resolvedBy = request.user._id;
      report.resolvedAt = new Date();
      await report.save();

      sendSuccess(reply, report, 'Report resolved and sanctions applied successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to resolve report', 500, error.message);
    }
  });

  // =========================================================================
  // 6. FINANCIALS & CREATOR PAYOUT APPROVALS
  // =========================================================================

  fastify.get('/payouts', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { page = 1, limit = 10, status = 'PENDING' } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      const query = { type: 'WITHDRAWAL', status };

      const [payouts, total] = await Promise.all([
        Transaction.find(query)
          .populate('userId', 'username email')
          .skip(skip)
          .limit(l)
          .sort({ createdAt: -1 }),
        Transaction.countDocuments(query)
      ]);

      sendSuccess(reply, {
        payouts,
        pagination: {
          page: p,
          limit: l,
          total,
          pages: Math.ceil(total / l)
        }
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch payouts', 500, error.message);
    }
  });

  fastify.put('/payouts/:transactionId/approve', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { transactionId } = request.params;
      const { payoutReference, notes } = request.body || {};

      const tx = await Transaction.findById(transactionId);
      if (!tx || tx.type !== 'WITHDRAWAL') {
        return sendError(reply, 'Withdrawal transaction not found', 404);
      }

      if (tx.status !== 'PENDING') {
        return sendError(reply, `Transaction is already ${tx.status}`, 400);
      }

      tx.status = 'COMPLETED';
      tx.adminNotes = notes || '';
      tx.payoutReference = payoutReference || 'MANUAL_DISBURSEMENT';
      tx.processedAt = new Date();
      await tx.save();

      createNotification({
        userId: tx.userId,
        type: 'PAYOUT_COMPLETED',
        title: 'Withdrawal Processed 💰',
        message: `Your withdrawal of ${tx.amount} has been processed successfully.`,
        targetUrl: '#wallet',
        dedupeKey: `tx_payout_${tx._id}`
      }).catch(err => fastify.log.error('Notification error:', err));

      sendSuccess(reply, tx, 'Payout approved successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to approve payout', 500, error.message);
    }
  });

  fastify.put('/payouts/:transactionId/reject', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { transactionId } = request.params;
      const { reason } = request.body || {};

      const tx = await Transaction.findById(transactionId);
      if (!tx || tx.type !== 'WITHDRAWAL') {
        return sendError(reply, 'Withdrawal transaction not found', 404);
      }

      if (tx.status !== 'PENDING') {
        return sendError(reply, `Transaction is already ${tx.status}`, 400);
      }

      tx.status = 'REJECTED';
      tx.adminNotes = reason || 'Declined by administration';
      tx.processedAt = new Date();
      await tx.save();

      await Wallet.findOneAndUpdate(
        { userId: tx.userId },
        { $inc: { balance: tx.amount } }
      );

      createNotification({
        userId: tx.userId,
        type: 'PAYOUT_REJECTED',
        title: 'Withdrawal Request Declined',
        message: reason ? `Your withdrawal was rejected: ${reason}` : 'Your withdrawal could not be processed. Funds returned to wallet.',
        targetUrl: '#wallet',
        dedupeKey: `tx_reject_${tx._id}`
      }).catch(err => fastify.log.error('Notification error:', err));

      sendSuccess(reply, tx, 'Payout rejected and balance refunded to user wallet');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to reject payout', 500, error.message);
    }
  });

  // =========================================================================
  // 7. SYSTEM MONITORING & CLIENT ERROR LOGS
  // =========================================================================

  fastify.post('/log-client-error', async (request, reply) => {
    try {
      const { type, message, stack, url, time, userId } = request.body || {};

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
      fastify.log.error('Failed to process client log', error);
      return reply.code(200).send({ success: true, data: { logged: false } });
    }
  });
}
