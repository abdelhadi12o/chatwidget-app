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
  lemonSqueezySubscriptionStatus: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
