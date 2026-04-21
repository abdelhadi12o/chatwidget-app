const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  // Action details
  action: {
    type: String,
    required: true,
    enum: [
      'USER_LOGIN',
      'USER_LOGOUT',
      'USER_UPGRADE',
      'USER_DELETE',
      'USER_FEATURES_UPDATE',
      'BOT_CREATE',
      'BOT_UPDATE',
      'BOT_DELETE',
      'BOT_STATUS_TOGGLE',
      'SETTINGS_UPDATE',
      'ADMIN_LOGIN',
      'BULK_UPGRADE',
      'BULK_DELETE'
    ]
  },

  // Who performed the action
  actor: {
    userId: String,
    email: String,
    name: String,
    isAdmin: { type: Boolean, default: false }
  },

  // Target of the action (if applicable)
  target: {
    userId: String,
    email: String,
    botId: String,
    botName: String
  },

  // Action details
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // IP and user agent
  ipAddress: String,
  userAgent: String,

  // Result
  success: { type: Boolean, default: true },
  errorMessage: String

}, {
  timestamps: true
});

// Indexes for efficient querying
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ 'actor.userId': 1, createdAt: -1 });
auditLogSchema.index({ 'target.userId': 1, createdAt: -1 });

// Static method to log an action
auditLogSchema.statics.log = async function(data) {
  try {
    return await this.create(data);
  } catch (error) {
    console.error('Failed to create audit log:', error);
    // Don't throw - logging should not break the app
  }
};

module.exports = mongoose.model('AuditLog', auditLogSchema);
