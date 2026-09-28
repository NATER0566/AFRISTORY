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

// DYNAMIC BANNER SCHEMA (Ensures it works immediately without needing a separate file)
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
        Creator.countDocuments({ isVerified: false }),
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

  // =========================================================================
  // 2. HOMEPAGE BANNERS & SLIDESHOWS (NEW)
  // =========================================================================

  // Get active banners based on type (IMAGE or VIDEO)
  fastify.get('/banners', async (request, reply) => {
    try {
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

  // Create a new banner/slideshow item
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

  // Delete a banner
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
  // 3. USER MANAGEMENT
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
        pagination: { page: p, limit: l, total, pages: Math.ceil(total / l) }
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch users', 500, error.message);
    }
  });

  fastify.put('/users/:userId/suspend', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { userId } = request.params;
      const user = await User.findByIdAndUpdate(userId, { isActive: false });
      if (!user) return sendError(reply, 'User not found', 404);

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
      const user = await User.findByIdAndUpdate(userId, { isActive: true });
      if (!user) return sendError(reply, 'User not found', 404);

      sendSuccess(reply, null, 'User unsuspended successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to unsuspend user', 500, error.message);
    }
  });

  // =========================================================================
  // 4. CREATOR ONBOARDING & VERIFICATION
  // =========================================================================

  fastify.get('/creators', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { page = 1, limit = 10, verified } = request.query;
      const { skip, limit: l, page: p } = paginate(page, limit);

      let query = {};
      if (verified !== undefined) {
        query.isVerified = verified === 'true';
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
        pagination: { page: p, limit: l, total, pages: Math.ceil(total / l) }
      });
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to fetch creators', 500, error.message);
    }
  });

  fastify.put('/creators/:creatorId/verify', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { creatorId } = request.params;
      const creator = await Creator.findById(creatorId);
      if (!creator) return sendError(reply, 'Creator not found', 404);

      creator.isVerified = true;
      await creator.save();

      await User.findByIdAndUpdate(creator.userId, { role: 'CREATOR' });

      createNotification({
        userId: creator.userId,
        type: 'CREATOR_VERIFIED',
        title: 'Creator Account Approved! 🌟',
        message: 'Your creator verification has been approved. You can now publish stories.',
        targetUrl: '#creator-dashboard',
        dedupeKey: `creator_verify_${creator._id}`
      }).catch(err => fastify.log.error('Notification error:', err));

      sendSuccess(reply, creator, 'Creator verified successfully');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to verify creator', 500, error.message);
    }
  });

  fastify.put('/creators/:creatorId/reject', async (request, reply) => {
    try {
      if (!(await verifyAdmin(request, reply))) return;

      const { creatorId } = request.params;
      const { reason } = request.body || {};

      const creator = await Creator.findById(creatorId);
      if (!creator) return sendError(reply, 'Creator not found', 404);

      creator.isVerified = false;
      await creator.save();

      createNotification({
        userId: creator.userId,
        type: 'CREATOR_REJECTED',
        title: 'Creator Application Update',
        message: reason || 'Your application requires changes.',
        targetUrl: '#creator-setup',
        dedupeKey: `creator_reject_${creator._id}_${Date.now()}`
      }).catch(err => fastify.log.error('Notification error:', err));

      sendSuccess(reply, null, 'Creator verification rejected');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to reject creator', 500, error.message);
    }
  });

  // =========================================================================
  // 5. MODERATION & REPORTS
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
        pagination: { page: p, limit: l, total, pages: Math.ceil(total / l) }
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

      const report = await Report.findById(reportId);
      if (!report) return sendError(reply, 'Report not found', 404);

      if (actionTaken === 'remove_content' && report.targetId && report.targetType) {
        if (report.targetType === 'SERIES') {
          await Series.findByIdAndUpdate(report.targetId, { isPublished: false, isFlagged: true });
        } else if (report.targetType === 'EPISODE') {
          await Episode.findByIdAndUpdate(report.targetId, { isPublished: false, isFlagged: true });
        }
      }

      report.status = status;
      report.actionTaken = actionTaken || 'none';
      report.resolvedBy = request.user._id;
      await report.save();

      sendSuccess(reply, report, 'Report resolved');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to resolve report', 500, error.message);
    }
  });

  // =========================================================================
  // 6. PAYOUTS
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
        pagination: { page: p, limit: l, total, pages: Math.ceil(total / l) }
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
      if (!tx || tx.type !== 'WITHDRAWAL') return sendError(reply, 'Withdrawal not found', 404);
      if (tx.status !== 'PENDING') return sendError(reply, `Transaction is already ${tx.status}`, 400);

      tx.status = 'COMPLETED';
      tx.adminNotes = notes || '';
      tx.payoutReference = payoutReference || 'MANUAL_DISBURSEMENT';
      await tx.save();

      sendSuccess(reply, tx, 'Payout approved');
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
      if (!tx || tx.type !== 'WITHDRAWAL') return sendError(reply, 'Withdrawal not found', 404);
      if (tx.status !== 'PENDING') return sendError(reply, `Transaction is already ${tx.status}`, 400);

      tx.status = 'REJECTED';
      tx.adminNotes = reason || 'Declined';
      await tx.save();

      await Wallet.findOneAndUpdate({ userId: tx.userId }, { $inc: { lockedEarnings: tx.amount } });

      sendSuccess(reply, tx, 'Payout rejected and refunded');
    } catch (error) {
      fastify.log.error(error);
      sendError(reply, 'Failed to reject payout', 500, error.message);
    }
  });
}
