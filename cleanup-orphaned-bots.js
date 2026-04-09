#!/usr/bin/env node
/**
 * Cleanup script to delete orphaned chatbots
 * Run this script to remove bots with null or missing userId
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Chatbot = require('./models/Chatbot');

async function cleanupOrphanedBots() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatbot';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Find all orphaned bots (null, undefined, or missing userId)
    const orphanedBots = await Chatbot.find({
      $or: [
        { userId: null },
        { userId: { $exists: false } },
        { userId: '' }
      ]
    });

    console.log(`🔍 Found ${orphanedBots.length} orphaned bots`);

    if (orphanedBots.length === 0) {
      console.log('✨ No orphaned bots to clean up');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Log orphaned bots for review
    console.log('\n📋 Orphaned bots to be deleted:');
    orphanedBots.forEach((bot, i) => {
      console.log(`  ${i + 1}. ${bot.name || 'Unnamed'} (${bot.widgetId}) - userId: ${bot.userId || 'null/missing'}`);
    });

    // Delete orphaned bots
    const result = await Chatbot.deleteMany({
      $or: [
        { userId: null },
        { userId: { $exists: false } },
        { userId: '' }
      ]
    });

    console.log(`\n✅ Deleted ${result.deletedCount} orphaned bots`);
    console.log('🎉 Cleanup complete!');

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

// Run the cleanup
cleanupOrphanedBots();
