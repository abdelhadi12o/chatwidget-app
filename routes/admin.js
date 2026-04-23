const express = require('express');
const router = express.Router();
const { ClerkExpressRequireAuth, clerkClient } = require('@clerk/clerk-sdk-node');
const Chatbot = require('../models/Chatbot');
const Lead = require('../models/Lead');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const DailyStats = require('../models/DailyStats');

// Plan configuration
const PLAN_CONFIG = {
  free: { name: 'Free (Trial)', maxBots: 1, maxMessages: 50, price: 0 },
  starter: { name: 'Starter', maxBots: 1, maxMessages: 1000, price: 29 },
  pro: { name: 'Pro', maxBots: 3, maxMessages: 5000, price: 79 },
  agency: { name: 'Agency', maxBots: 10, maxMessages: 20000, price: 199 }
};

// Helper to get client IP
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.headers['x-real-ip'] ||
         req.connection.remoteAddress ||
         'unknown';
}

// Helper to log admin actions
async function logAdminAction(req, action, target = {}, details = {}, success = true, errorMessage = null) {
  try {
    const adminUser = await clerkClient.users.getUser(req.auth.userId);
    await AuditLog.log({
      action,
      actor: {
        userId: req.auth.userId,
        email: adminUser.emailAddresses?.[0]?.emailAddress || 'unknown',
        name: adminUser.firstName && adminUser.lastName
          ? `${adminUser.firstName} ${adminUser.lastName}`
          : adminUser.firstName || adminUser.lastName || 'Admin',
        isAdmin: true
      },
      target,
      details,
      ipAddress: getClientIP(req),
      userAgent: req.headers['user-agent'] || 'unknown',
      success,
      errorMessage
    });
  } catch (error) {
    console.error('Failed to log admin action:', error);
  }
}

const requireAdmin = async (req, res, next) => {
  // Trim and clean the admin email to handle env var whitespace/quotes
  const adminEmail = process.env.ADMIN_EMAIL?.trim().replace(/^["']|["']$/g, '');

  // 1. Strict existence check: Lock the route if the env var is missing
  if (!adminEmail) {
    console.error('CRITICAL: ADMIN_EMAIL is not set in environment variables. Admin routes disabled.');
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  try {
    if (!req.auth || !req.auth.userId) {
      return res.status(401).json({ error: 'Unauthorized: No user session' });
    }

    // 2. Safely extract user email from Clerk
    const user = await clerkClient.users.getUser(req.auth.userId);
    const userEmail = user.emailAddresses?.[0]?.emailAddress?.trim().toLowerCase();

    // Debug logging for production troubleshooting
    console.log('[Admin Check] User email:', userEmail, '| Configured admin:', adminEmail.toLowerCase());

    // 3. Strict, fail-closed comparison
    if (!userEmail || userEmail !== adminEmail.toLowerCase()) {
      console.error(`[Admin Check] Access denied for user: ${userEmail} (expected: ${adminEmail.toLowerCase()})`);
      return res.status(403).json({ error: 'Forbidden: Admin access required.' });
    }

    next();
  } catch (error) {
    console.error('Admin check error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// GET /dashboard - Admin dashboard data
router.get('/dashboard', ClerkExpressRequireAuth(), requireAdmin, async (req, res) => {
  try {
    // Fetch all users from Clerk (with limit)
    let userResponse;
    try {
      userResponse = await clerkClient.users.getUserList({ limit: 100 });
    } catch (err) {
      console.error('❌ Failed to fetch users from Clerk:', err.message);
      throw err;
    }

    // Extract array safely regardless of SDK response shape
    const usersArray = Array.isArray(userResponse)
      ? userResponse
      : (userResponse?.data || []);

    // Fetch all chatbots from MongoDB (only those with valid userId - no orphaned bots)
    let allChatbots;
    try {
      allChatbots = await Chatbot.find({ userId: { $exists: true, $ne: null } });
    } catch (err) {
      console.error('❌ Failed to fetch chatbots from MongoDB:', err.message);
      allChatbots = [];
    }

    // Fetch actual lead count from Lead collection
    let totalLeads;
    try {
      totalLeads = await Lead.countDocuments();
    } catch (err) {
      console.error('❌ Failed to fetch leads count:', err.message);
      totalLeads = 0;
    }

    // Calculate real metrics
    const totalUsers = usersArray.length;
    const totalBots = allChatbots.length;
    const totalConversations = allChatbots.reduce((sum, bot) => sum + (bot.conversationCount || 0), 0);

    // Fetch all User documents from MongoDB for subscription data
    const clerkIds = usersArray.map(u => u.id);
    const dbUsers = await User.find({ clerkId: { $in: clerkIds } }).lean();
    const dbUserMap = {};
    dbUsers.forEach(u => { dbUserMap[u.clerkId] = u; });

    // Map users with their data and bot stats from MongoDB
    const usersData = await Promise.all(
      usersArray.map(async (user) => {
        const userBots = allChatbots.filter(bot => bot.userId === user.id);
        const userConversationCount = userBots.reduce((sum, bot) => sum + (bot.conversationCount || 0), 0);
        const dbUser = dbUserMap[user.id];

        // Get plan config
        const planKey = dbUser?.plan || 'free';
        const planConfig = PLAN_CONFIG[planKey] || PLAN_CONFIG.free;

        // Check trial status
        const trialEndsAt = dbUser?.trialEndsAt;
        const isTrialExpired = planKey === 'free' && trialEndsAt && Date.now() > new Date(trialEndsAt).getTime();

        return {
          clerkUserId: user.id,
          name: user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.firstName || user.lastName || 'Unknown',
          email: user.emailAddresses?.[0]?.emailAddress || 'No email',
          plan: planKey,
          planName: planConfig.name,
          planPrice: planConfig.price,
          maxBots: planConfig.maxBots,
          maxMessages: planConfig.maxMessages,
          hasBot: userBots.length > 0,
          botCount: userBots.length,
          conversationCount: userConversationCount,
          monthlyMessageCount: dbUser?.monthlyMessageCount || 0,
          trialEndsAt: trialEndsAt ? new Date(trialEndsAt).toLocaleDateString() : null,
          isTrialExpired,
          botNames: userBots.map(bot => bot.botName || 'Unnamed Bot').join(', ') || 'No bots',
          joinedAt: new Date(user.createdAt).toLocaleDateString(),
          lastActive: user.lastSignInAt ? new Date(user.lastSignInAt).toLocaleDateString() : 'Never',
          location: user.publicMetadata?.country || 'Unknown (Requires IP API)',
          features: user.publicMetadata?.features || []
        };
      })
    );

    res.json({ totalUsers, totalBots, totalConversations, totalLeads, users: usersData });
  } catch (error) {
    console.error('Error fetching dashboard data:', error.message);
    res.status(500).send('Server error');
  }
});

// PATCH /users/:userId/plan - Change user plan (supports any plan)
router.patch('/users/:userId/plan', ClerkExpressRequireAuth(), requireAdmin, async (req, res) => {
  try {
    const userId = req.params.userId;
    const { plan } = req.body;

    if (!plan || !PLAN_CONFIG[plan]) {
      return res.status(400).json({ error: 'Invalid plan specified' });
    }

    const targetUser = await clerkClient.users.getUser(userId);
    const previousPlan = targetUser.publicMetadata?.plan || 'free';

    // Update Clerk metadata
    await clerkClient.users.updateUser(userId, {
      publicMetadata: { ...targetUser.publicMetadata, plan }
    });

    // Update or create User in MongoDB
    await User.findOneAndUpdate(
      { clerkId: userId },
      { plan },
      { upsert: true, returnDocument: 'after' }
    );

    // Log the action
    await logAdminAction(req, 'USER_UPGRADE', {
      userId,
      email: targetUser.emailAddresses?.[0]?.emailAddress
    }, { previousPlan, newPlan: plan });

    res.json({ message: `Plan changed to ${PLAN_CONFIG[plan].name}`, plan });
  } catch (error) {
    console.error('Error changing plan:', error.message);
    await logAdminAction(req, 'USER_UPGRADE', { userId: req.params.userId }, {}, false, error.message);
    res.status(500).json({ error: 'Failed to change plan' });
  }
});

// PATCH /upgrade/:userId - Legacy: Upgrade user to Pro plan (DEPRECATED)
router.patch('/upgrade/:userId', ClerkExpressRequireAuth(), requireAdmin, async (req, res) => {
  try {
    const userId = req.params.userId;
    const targetUser = await clerkClient.users.getUser(userId);

    await clerkClient.users.updateUser(userId, {
      publicMetadata: { plan: 'pro' }
    });

    // Update MongoDB as well
    await User.findOneAndUpdate(
      { clerkId: userId },
      { plan: 'pro' },
      { upsert: true }
    );

    // Log the action
    await logAdminAction(req, 'USER_UPGRADE', {
      userId,
      email: targetUser.emailAddresses?.[0]?.emailAddress
    }, { previousPlan: 'free', newPlan: 'pro' });

    res.send('User upgraded successfully');
  } catch (error) {
    console.error('Error upgrading user:', error.message);
    await logAdminAction(req, 'USER_UPGRADE', { userId: req.params.userId }, {}, false, error.message);
    res.status(500).send('Failed to upgrade user');
  }
});

// DELETE /user/:userId - Delete user and their bots
router.delete('/user/:userId', ClerkExpressRequireAuth(), requireAdmin, async (req, res) => {
  try {
    const userId = req.params.userId;
    let targetEmail = 'unknown';

    try {
      const targetUser = await clerkClient.users.getUser(userId);
      targetEmail = targetUser.emailAddresses?.[0]?.emailAddress || 'unknown';
    } catch (e) {
      // User might not exist, continue with deletion
    }

    // Delete user from Clerk
    await clerkClient.users.delete(userId);

    // Delete associated chatbots from MongoDB
    const deletedBots = await Chatbot.deleteMany({ userId: String(userId) });

    // Log the action
    await logAdminAction(req, 'USER_DELETE', {
      userId,
      email: targetEmail
    }, { deletedBotsCount: deletedBots.deletedCount });

    console.log(`Deleted user ${userId} and ${deletedBots.deletedCount} associated chatbots`);

    res.send('User and associated bots deleted successfully');
  } catch (error) {
    console.error('Error deleting user:', error.message);
    await logAdminAction(req, 'USER_DELETE', { userId: req.params.userId }, {}, false, error.message);
    res.status(500).send('Failed to delete user');
  }
});

// POST /users/:userId/features - Update user feature flags
router.post('/users/:userId/features', ClerkExpressRequireAuth(), requireAdmin, async (req, res) => {
  try {
    const userId = req.params.userId;
    const { features } = req.body;

    // Validate features is an array
    if (!Array.isArray(features)) {
      return res.status(400).json({ error: 'Features must be an array' });
    }

    // Get current user metadata to preserve other fields
    const user = await clerkClient.users.getUser(userId);
    const currentMetadata = user.publicMetadata || {};
    const previousFeatures = currentMetadata.features || [];

    // Update user with new features array while preserving other metadata
    await clerkClient.users.updateUser(userId, {
      publicMetadata: {
        ...currentMetadata,
        features: features
      }
    });

    // Log the action
    await logAdminAction(req, 'USER_FEATURES_UPDATE', {
      userId,
      email: user.emailAddresses?.[0]?.emailAddress
    }, { previousFeatures, newFeatures: features });

    res.json({ message: 'Features updated successfully', features });
  } catch (error) {
    console.error('Error updating user features:', error.message);
    await logAdminAction(req, 'USER_FEATURES_UPDATE', { userId: req.params.userId }, {}, false, error.message);
    res.status(500).json({ error: 'Failed to update user features' });
  }
});

// GET /chatbots - Get all chatbots with owner info
router.get('/chatbots', ClerkExpressRequireAuth(), requireAdmin, async (req, res) => {
  try {
    // Fetch all chatbots
    const chatbots = await Chatbot.find({ userId: { $exists: true, $ne: null } });

    // Fetch users from Clerk to get owner info
    let users = [];
    try {
      const userResponse = await clerkClient.users.getUserList({ limit: 100 });
      users = Array.isArray(userResponse) ? userResponse : (userResponse?.data || []);
    } catch (err) {
      console.error('Failed to fetch users:', err.message);
    }

    // Create a user lookup map
    const userMap = {};
    users.forEach(user => {
      userMap[user.id] = {
        name: user.firstName && user.lastName
          ? `${user.firstName} ${user.lastName}`
          : user.firstName || user.lastName || 'Unknown',
        email: user.emailAddresses?.[0]?.emailAddress || 'No email'
      };
    });

    // Get leads count for each bot
    const leadsCounts = await Lead.aggregate([
      { $group: { _id: '$widgetId', count: { $sum: 1 } } }
    ]);
    const leadsMap = {};
    leadsCounts.forEach(l => { leadsMap[l._id] = l.count; });

    // Map chatbots with owner info
    const chatbotsData = chatbots.map(bot => ({
      widgetId: bot.widgetId,
      botName: bot.customization?.botName || 'Unnamed Bot',
      websiteUrl: bot.websiteUrl,
      isActive: bot.isActive,
      conversationCount: bot.conversationCount || 0,
      leadsCount: leadsMap[bot.widgetId] || 0,
      customization: bot.customization,
      userId: bot.userId,
      ownerName: userMap[bot.userId]?.name || 'Unknown',
      ownerEmail: userMap[bot.userId]?.email || 'No email',
      createdAt: bot.createdAt
    }));

    res.json({ chatbots: chatbotsData });
  } catch (error) {
    console.error('Error fetching chatbots:', error.message);
    res.status(500).json({ error: 'Failed to fetch chatbots' });
  }
});

// PATCH /chatbots/:widgetId/status - Update bot active status
router.patch('/chatbots/:widgetId/status', ClerkExpressRequireAuth(), requireAdmin, async (req, res) => {
  try {
    const { widgetId } = req.params;
    const { isActive } = req.body;

    const bot = await Chatbot.findOneAndUpdate(
      { widgetId },
      { isActive },
      { returnDocument: 'after' }
    );

    if (!bot) {
      return res.status(404).json({ error: 'Chatbot not found' });
    }

    // Log the action
    await logAdminAction(req, 'BOT_STATUS_TOGGLE', {
      botId: widgetId,
      botName: bot.customization?.botName || 'Unnamed Bot'
    }, { previousStatus: !isActive, newStatus: isActive });

    res.json({ message: 'Status updated', isActive: bot.isActive });
  } catch (error) {
    console.error('Error updating bot status:', error.message);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// DELETE /chatbots/:widgetId - Delete a chatbot
router.delete('/chatbots/:widgetId', ClerkExpressRequireAuth(), requireAdmin, async (req, res) => {
  try {
    const { widgetId } = req.params;

    // Get bot info before deletion for logging
    const bot = await Chatbot.findOne({ widgetId });
    const botName = bot?.customization?.botName || 'Unnamed Bot';
    const userId = bot?.userId;

    const result = await Chatbot.deleteOne({ widgetId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Chatbot not found' });
    }

    // Also delete associated leads
    const deletedLeads = await Lead.deleteMany({ widgetId });

    // Log the action
    await logAdminAction(req, 'BOT_DELETE', {
      botId: widgetId,
      botName
    }, { userId, deletedLeadsCount: deletedLeads.deletedCount });

    res.json({ message: 'Chatbot deleted successfully' });
  } catch (error) {
    console.error('Error deleting chatbot:', error.message);
    res.status(500).json({ error: 'Failed to delete chatbot' });
  }
});

// GET /audit-logs - Get audit logs with filtering and pagination
router.get('/audit-logs', ClerkExpressRequireAuth(), requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const action = req.query.action;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    // Build query
    const query = {};
    if (action) query.action = action;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // Get total count
    const total = await AuditLog.countDocuments(query);

    // Get logs with pagination
    const logs = await AuditLog.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.json({
      logs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error.message);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// GET /audit-logs/export - Export audit logs to CSV
router.get('/audit-logs/export', ClerkExpressRequireAuth(), requireAdmin, async (req, res) => {
  try {
    const action = req.query.action;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    // Build query
    const query = {};
    if (action) query.action = action;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // Get all matching logs (limit to 10000 for performance)
    const logs = await AuditLog.find(query)
      .sort({ createdAt: -1 })
      .limit(10000)
      .lean();

    // Build CSV
    const headers = ['Timestamp', 'Action', 'Actor', 'Target', 'Details', 'IP Address', 'Success', 'Error'];
    const rows = logs.map(log => [
      new Date(log.createdAt).toISOString(),
      log.action,
      `${log.actor.name} (${log.actor.email})`,
      log.target.email || log.target.botName || 'N/A',
      JSON.stringify(log.details).replace(/"/g, '""'),
      log.ipAddress,
      log.success ? 'Yes' : 'No',
      log.errorMessage || ''
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"');
    res.send(csv);
  } catch (error) {
    console.error('Error exporting audit logs:', error.message);
    res.status(500).json({ error: 'Failed to export audit logs' });
  }
});

// GET /audit-logs/summary - Get audit log statistics
router.get('/audit-logs/summary', ClerkExpressRequireAuth(), requireAdmin, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const last7Days = new Date(today);
    last7Days.setDate(last7Days.getDate() - 7);

    // Get counts for different time periods
    const [totalCount, todayCount, weekCount] = await Promise.all([
      AuditLog.countDocuments(),
      AuditLog.countDocuments({ createdAt: { $gte: today } }),
      AuditLog.countDocuments({ createdAt: { $gte: last7Days } })
    ]);

    // Get action breakdown
    const actionBreakdown = await AuditLog.aggregate([
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    res.json({
      total: totalCount,
      today: todayCount,
      last7Days: weekCount,
      actionBreakdown: actionBreakdown.map(a => ({ action: a._id, count: a.count }))
    });
  } catch (error) {
    console.error('Error fetching audit summary:', error.message);
    res.status(500).json({ error: 'Failed to fetch audit summary' });
  }
});

// GET /analytics/conversations - Get conversation data for charts
router.get('/analytics/conversations', ClerkExpressRequireAuth(), requireAdmin, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const data = await DailyStats.getRange(days);

    res.json({
      labels: data.map(d => d.date),
      values: data.map(d => d.conversations)
    });
  } catch (error) {
    console.error('Error fetching conversation analytics:', error.message);
    res.status(500).json({ error: 'Failed to fetch analytics data' });
  }
});

// GET /analytics/signups - Get user signup data for charts
router.get('/analytics/signups', ClerkExpressRequireAuth(), requireAdmin, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const data = await DailyStats.getRange(days);

    res.json({
      labels: data.map(d => d.date),
      values: data.map(d => d.users)
    });
  } catch (error) {
    console.error('Error fetching signup analytics:', error.message);
    res.status(500).json({ error: 'Failed to fetch analytics data' });
  }
});

// GET /analytics/top-bots - Get top performing bots
router.get('/analytics/top-bots', ClerkExpressRequireAuth(), requireAdmin, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const limit = parseInt(req.query.limit) || 5;

    // Get real-time bot stats from Chatbot collection
    const topBots = await Chatbot.aggregate([
      { $match: { userId: { $exists: true, $ne: null } } },
      { $sort: { conversationCount: -1 } },
      { $limit: limit },
      {
        $project: {
          widgetId: 1,
          botName: { $ifNull: ['$customization.botName', 'Unnamed Bot'] },
          conversationCount: { $ifNull: ['$conversationCount', 0] },
          websiteUrl: 1
        }
      }
    ]);

    res.json({
      bots: topBots.map(b => ({
        name: b.botName,
        conversations: b.conversationCount || 0
      }))
    });
  } catch (error) {
    console.error('Error fetching top bots:', error.message);
    res.status(500).json({ error: 'Failed to fetch top bots' });
  }
});

// GET /analytics/summary - Get real-time summary stats
router.get('/analytics/summary', ClerkExpressRequireAuth(), requireAdmin, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Get real-time counts
    const [
      totalUsers,
      totalBots,
      totalLeads,
      totalConversations,
      todayStats,
      yesterdayStats
    ] = await Promise.all([
      User.countDocuments(),
      Chatbot.countDocuments({ userId: { $exists: true, $ne: null } }),
      Lead.countDocuments(),
      Chatbot.aggregate([{ $group: { _id: null, total: { $sum: '$conversationCount' } } }]).then(r => r[0]?.total || 0),
      DailyStats.findOne({ date: today }),
      DailyStats.findOne({ date: yesterday })
    ]);

    // Calculate daily active (users who signed in today - approximated from Clerk)
    // This would need Clerk's active session data for true accuracy
    const dailyActive = todayStats?.users?.active || 0;

    // Calculate trends (vs yesterday)
    const conversationsToday = todayStats?.conversations?.new || 0;
    const conversationsYesterday = yesterdayStats?.conversations?.new || 0;
    const conversationTrend = conversationsYesterday > 0
      ? ((conversationsToday - conversationsYesterday) / conversationsYesterday * 100).toFixed(1)
      : 0;

    res.json({
      totalUsers,
      totalBots,
      totalLeads,
      totalConversations,
      dailyActive,
      trends: {
        conversations: parseFloat(conversationTrend),
        users: 0, // Would need historical data comparison
        bots: 0
      },
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching analytics summary:', error.message);
    res.status(500).json({ error: 'Failed to fetch analytics summary' });
  }
});

module.exports = router;
