const mongoose = require('mongoose');

const dailyStatsSchema = new mongoose.Schema({
  // Date for this stats entry (normalized to midnight UTC)
  date: {
    type: Date,
    required: true,
    unique: true,
    index: true
  },

  // Daily conversation metrics
  conversations: {
    total: { type: Number, default: 0 },
    new: { type: Number, default: 0 } // Conversations started on this day
  },

  // User metrics
  users: {
    total: { type: Number, default: 0 },
    new: { type: Number, default: 0 }, // New signups on this day
    active: { type: Number, default: 0 } // Active users on this day
  },

  // Bot metrics
  bots: {
    total: { type: Number, default: 0 },
    new: { type: Number, default: 0 },
    active: { type: Number, default: 0 }
  },

  // Lead metrics
  leads: {
    total: { type: Number, default: 0 },
    new: { type: Number, default: 0 }
  },

  // Top performing bots for this day
  topBots: [{
    widgetId: String,
    botName: String,
    conversationCount: Number
  }]

}, {
  timestamps: true
});

// Static method to get or create stats for a specific date
dailyStatsSchema.statics.getOrCreate = async function(date) {
  const normalizedDate = new Date(date);
  normalizedDate.setHours(0, 0, 0, 0);

  let stats = await this.findOne({ date: normalizedDate });
  if (!stats) {
    stats = await this.create({ date: normalizedDate });
  }
  return stats;
};

// Static method to increment conversation count for today
dailyStatsSchema.statics.incrementConversations = async function() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return this.findOneAndUpdate(
    { date: today },
    { $inc: { 'conversations.new': 1 } },
    { upsert: true, new: true }
  );
};

// Static method to increment user signup for today
dailyStatsSchema.statics.incrementUserSignup = async function() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return this.findOneAndUpdate(
    { date: today },
    { $inc: { 'users.new': 1 } },
    { upsert: true, new: true }
  );
};

// Static method to get stats for date range
dailyStatsSchema.statics.getRange = async function(days = 30) {
  const endDate = new Date();
  endDate.setHours(0, 0, 0, 0);

  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days + 1);

  // Check if we have any daily stats at all
  const hasStats = await this.exists({ date: { $gte: startDate, $lte: endDate } });

  // If no daily stats exist, aggregate from actual data
  if (!hasStats) {
    const Chatbot = require('./Chatbot');
    const User = require('./User');

    // Get conversation counts by date from Chatbot.conversations
    const chatbots = await Chatbot.find({
      'conversations.timestamp': { $gte: startDate, $lte: new Date() }
    }).lean();

    // Aggregate conversations by date
    const conversationsByDate = {};
    chatbots.forEach(bot => {
      (bot.conversations || []).forEach(conv => {
        if (conv.timestamp) {
          const dateKey = new Date(conv.timestamp).toISOString().split('T')[0];
          conversationsByDate[dateKey] = (conversationsByDate[dateKey] || 0) + 1;
        }
      });
    });

    // Get user signups by date
    const users = await User.find({
      createdAt: { $gte: startDate }
    }).lean();

    const signupsByDate = {};
    users.forEach(user => {
      if (user.createdAt) {
        const dateKey = new Date(user.createdAt).toISOString().split('T')[0];
        signupsByDate[dateKey] = (signupsByDate[dateKey] || 0) + 1;
      }
    });

    // Build result array with backfilled data
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(endDate);
      d.setDate(d.getDate() - i);
      const dateKey = d.toISOString().split('T')[0];

      result.push({
        date: dateKey,
        conversations: conversationsByDate[dateKey] || 0,
        users: signupsByDate[dateKey] || 0,
        leads: 0 // Would need Lead model with timestamps
      });
    }

    return result;
  }

  // Use stored daily stats
  const stats = await this.find({
    date: { $gte: startDate, $lte: endDate }
  }).sort({ date: 1 }).lean();

  // Fill in missing dates with zeros
  const result = [];
  const statsMap = new Map(stats.map(s => [s.date.toISOString().split('T')[0], s]));

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(endDate);
    d.setDate(d.getDate() - i);
    const dateKey = d.toISOString().split('T')[0];
    const stat = statsMap.get(dateKey);

    result.push({
      date: dateKey,
      conversations: stat?.conversations?.new || 0,
      users: stat?.users?.new || 0,
      leads: stat?.leads?.new || 0
    });
  }

  return result;
};

// Static method to get top bots across date range
dailyStatsSchema.statics.getTopBots = async function(days = 7, limit = 5) {
  const endDate = new Date();
  endDate.setHours(0, 0, 0, 0);

  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days + 1);

  // Aggregate top bots by summing conversation counts
  const topBots = await this.aggregate([
    {
      $match: {
        date: { $gte: startDate, $lte: endDate }
      }
    },
    { $unwind: '$topBots' },
    {
      $group: {
        _id: '$topBots.widgetId',
        botName: { $first: '$topBots.botName' },
        totalConversations: { $sum: '$topBots.conversationCount' }
      }
    },
    { $sort: { totalConversations: -1 } },
    { $limit: limit }
  ]);

  return topBots.map(b => ({
    widgetId: b._id,
    botName: b.botName || 'Unnamed Bot',
    conversationCount: b.totalConversations || 0
  }));
};

module.exports = mongoose.model('DailyStats', dailyStatsSchema);
