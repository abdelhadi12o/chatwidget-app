const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  clerkId: { type: String, required: true, unique: true },
  email: { type: String },
  plan: { type: String, enum: ['free', 'starter', 'pro', 'agency'], default: 'free' },
  trialEndsAt: {
    type: Date,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days from creation
  },
  lemonSqueezyCustomerId: { type: String, default: null },
  lemonSqueezySubscriptionId: { type: String, default: null },
  lemonSqueezySubscriptionStatus: { type: String, default: null },
  // Monthly message tracking
  monthlyMessageCount: { type: Number, default: 0 },
  monthlyResetDate: { type: Date, default: () => new Date() }
}, { timestamps: true });

// Helper method to check and reset monthly count if needed
userSchema.methods.checkAndResetMonthlyCount = function() {
  const now = new Date();
  if (now.getMonth() !== this.monthlyResetDate.getMonth() || now.getFullYear() !== this.monthlyResetDate.getFullYear()) {
    this.monthlyMessageCount = 0;
    this.monthlyResetDate = now;
    return true; // Was reset
  }
  return false; // No reset needed
};

// Helper method to increment message count
userSchema.methods.incrementMessageCount = async function() {
  this.checkAndResetMonthlyCount();
  this.monthlyMessageCount += 1;
  await this.save();
  return this.monthlyMessageCount;
};

module.exports = mongoose.model('User', userSchema);
