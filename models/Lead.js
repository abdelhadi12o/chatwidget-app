const mongoose = require('mongoose');

const LeadSchema = new mongoose.Schema({
  widgetId: { type: String, required: true },
  userId: { type: String, default: null },
  name: { type: String, required: true },
  whatsapp: { type: String, required: true },
  email: { type: String, default: '' },
  question: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Lead', LeadSchema);
