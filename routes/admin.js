const express = require('express');
const router = express.Router();
const { ClerkExpressRequireAuth, clerkClient } = require('@clerk/clerk-sdk-node');
const Chatbot = require('../models/Chatbot');
const Lead = require('../models/Lead');

const requireAdmin = async (req, res, next) => {
  try {
    if (!req.auth || !req.auth.userId) {
      return res.status(401).send('Unauthorized: No user session');
    }
    const user = await clerkClient.users.getUser(req.auth.userId);
    const userEmail = user.emailAddresses?.[0]?.emailAddress || '';
    const adminEmail = process.env.ADMIN_EMAIL;

    // Allow if email matches env var OR whitelisted email
    if (userEmail === adminEmail || userEmail === 'abdeouassif10@gmail.com') {
      return next();
    } else {
      return res.status(403).send('Forbidden: Not an admin user');
    }
  } catch (error) {
    console.error('Admin check error:', error);
    return res.status(500).send('Authentication or server error');
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

    // Map users with their data and bot stats from MongoDB
    const usersData = await Promise.all(
      usersArray.map(async (user) => {
        const userBots = allChatbots.filter(bot => bot.userId === user.id);
        const userConversationCount = userBots.reduce((sum, bot) => sum + (bot.conversationCount || 0), 0);
        return {
          clerkUserId: user.id,
          name: user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.firstName || user.lastName || 'Unknown',
          email: user.emailAddresses?.[0]?.emailAddress || 'No email',
          plan: user.publicMetadata?.plan || 'free',
          hasBot: userBots.length > 0,
          conversationCount: userConversationCount,
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
    console.error('Error fetching dashboard data:', error);
    res.status(500).send('Server error');
  }
});

// PATCH /upgrade/:userId - Upgrade user to Pro plan
router.patch('/upgrade/:userId', ClerkExpressRequireAuth(), requireAdmin, async (req, res) => {
  try {
    const userId = req.params.userId;
    await clerkClient.users.update(userId, {
      publicMetadata: { plan: 'pro' }
    });
    res.send('User upgraded successfully');
  } catch (error) {
    console.error('Error upgrading user:', error);
    res.status(500).send('Failed to upgrade user');
  }
});

// DELETE /user/:userId - Delete user and their bots
router.delete('/user/:userId', ClerkExpressRequireAuth(), requireAdmin, async (req, res) => {
  try {
    const userId = req.params.userId;

    // Delete user from Clerk
    await clerkClient.users.delete(userId);

    // Delete associated chatbots from MongoDB
    const deletedBots = await Chatbot.deleteMany({ userId });

    console.log(`Deleted user ${userId} and ${deletedBots.deletedCount} associated chatbots`);

    res.send('User and associated bots deleted successfully');
  } catch (error) {
    console.error('Error deleting user:', error);
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

    // Update user with new features array while preserving other metadata
    await clerkClient.users.update(userId, {
      publicMetadata: {
        ...currentMetadata,
        features: features
      }
    });

    res.json({ message: 'Features updated successfully', features });
  } catch (error) {
    console.error('Error updating user features:', error);
    res.status(500).json({ error: 'Failed to update user features' });
  }
});

module.exports = router;
