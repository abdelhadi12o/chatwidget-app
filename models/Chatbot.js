const mongoose = require('mongoose');

const ChatbotSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  websiteUrl: { type: String, required: true },
    name: { type: String, default: 'My Chatbot' },
  scrapedContent: { type: mongoose.Schema.Types.Mixed, default: [] },
  widgetId: { type: String, required: true, unique: true, index: true },
  apiKey: { type: String },
  webhookUrl: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  conversationCount: { type: Number, default: 0 },
  conversations: { type: Array, default: [] },
  faqs: { type: Array, default: [] },
  customKnowledge: { type: String, default: '' },
  trainedFiles: [{ fileName: String, uploadDate: { type: Date, default: Date.now } }],
  customization: {
    botName: { type: String, default: 'AI Assistant' },
    bubbleColor: { type: String, default: '#6366f1' },
    welcomeMessage: { type: String, default: 'Hi! How can I help you today?' },
    position: { type: String, default: 'bottom-right' },
    quickReplies: { type: [String], default: [] },
    botLogo: { type: String, default: '' },
    bookingLink: { type: String, default: '' },
    systemPrompt: { type: String, default: '' },
    launcherImage: { type: String, default: '' }
  },
  offlineMessages: { type: Array, default: [] },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Chatbot', ChatbotSchema);
