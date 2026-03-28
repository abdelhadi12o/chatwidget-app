const mongoose = require('mongoose');

const ChatbotSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  websiteUrl: { type: String, required: true },
  scrapedContent: { type: mongoose.Schema.Types.Mixed, default: [] },
  widgetId: { type: String, required: true, unique: true },
  isActive: { type: Boolean, default: true },
  conversationCount: { type: Number, default: 0 },
  conversations: { type: Array, default: [] },
  faqs: { type: Array, default: [] },
  customization: {
    botName: { type: String, default: 'AI Assistant' },
    bubbleColor: { type: String, default: '#6366f1' },
    welcomeMessage: { type: String, default: 'Hi! How can I help you today?' },
    position: { type: String, default: 'bottom-right' },
    quickReplies: { type: [String], default: [] },
    botLogo: { type: String, default: '' }
  },
  offlineMessages: { type: Array, default: [] },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Chatbot', ChatbotSchema);
