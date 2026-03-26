const express = require('express');
const router = express.Router();
const Chatbot = require('../models/Chatbot');
const { scrapeWebsite } = require('../scraper/scrape');
const { authenticateToken } = require('../middleware/auth');
const Groq = require('groq-sdk');

const generateWidgetId = () => {
  return 'widget_' + Math.random().toString(36).substr(2, 16) + Date.now().toString(36);
};

// Create chatbot
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const { websiteUrl } = req.body;
    if (!websiteUrl) return res.status(400).json({ error: 'Website URL is required' });

    const existingBot = await Chatbot.findOne({ userId: req.user.userId });
    if (existingBot) return res.status(400).json({ error: 'You already have a chatbot' });

    let scrapeResult;
    try {
      scrapeResult = await scrapeWebsite(websiteUrl);
    } catch (scrapeError) {
      return res.status(400).json({ error: 'Failed to scrape website: ' + scrapeError.message });
    }

    if (!scrapeResult || scrapeResult.pages.length === 0) {
      return res.status(400).json({ error: 'No content found on the website' });
    }

    const chatbot = new Chatbot({
      userId: req.user.userId,
      websiteUrl,
      scrapedContent: scrapeResult,
      widgetId: generateWidgetId()
    });
    await chatbot.save();

    res.status(201).json({
      widgetId: chatbot.widgetId,
      websiteUrl: chatbot.websiteUrl,
      createdAt: chatbot.createdAt
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user's chatbot
router.get('/my-bot', authenticateToken, async (req, res) => {
  try {
    const chatbot = await Chatbot.findOne({ userId: req.user.userId });
    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });

    res.json({
      widgetId: chatbot.widgetId,
      websiteUrl: chatbot.websiteUrl,
      isActive: chatbot.isActive,
      conversationCount: chatbot.conversationCount,
      createdAt: chatbot.createdAt,
      faqs: chatbot.faqs || [],
      customization: chatbot.customization,
      scrapedContent: chatbot.scrapedContent
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Chat endpoint
router.post('/chat', async (req, res) => {
  try {
    const { widgetId, message } = req.body;
    if (!widgetId || !message) return res.status(400).json({ error: 'Widget ID and message are required' });

    let chatbot;
    if (widgetId === 'demo-widget') {
      chatbot = {
        _id: 'demo',
        widgetId: 'demo-widget',
        scrapedContent: [`ChatWidget is an AI chatbot builder for businesses. Paste your website URL and we train an AI on your content. Customers get instant answers 24/7. Free plan: 1 chatbot, 50 messages/month, no credit card. Setup takes 3 minutes. No coding required.`],
        isActive: true,
        conversationCount: 0,
        faqs: [],
        customization: { botName: "AI Assistant", bubbleColor: "#6366f1", welcomeMessage: "Hi! How can I help you today?", position: "bottom-right" }
      };
    } else {
      chatbot = await Chatbot.findOne({ widgetId });
      if (!chatbot) return res.status(404).json({ error: 'Chatbot not found' });
      if (!chatbot.isActive) return res.status(400).json({ error: 'Chatbot is not active' });
    }

    let context = '';
    if (Array.isArray(chatbot.scrapedContent)) {
      context = chatbot.scrapedContent.join('\n\n');
    } else if (chatbot.scrapedContent && chatbot.scrapedContent.pages) {
      context = chatbot.scrapedContent.pages.map(p => p.content.join('\n')).join('\n\n');
    }

    if (chatbot.faqs && chatbot.faqs.length > 0) {
      context += '\n\nFAQs:\n' + chatbot.faqs.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n');
    }

    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY
    });
    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: 'You are a helpful customer support assistant. Answer based on the business context. Always respond in the same language the customer uses.' },
        { role: 'user', content: `Context:\n${context.substring(0, 1000)}\n\nQuestion: ${message}` }
      ],
      temperature: 0.7,
      max_tokens: 500
    });

    const answer = response.choices[0].message.content;

    if (widgetId !== 'demo-widget') {
      await Chatbot.findByIdAndUpdate(chatbot._id, {
        $inc: { conversationCount: 1 },
        $push: { conversations: { user: message, bot: answer, timestamp: new Date() } }
      });
    }

    res.json({ answer });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete chatbot
router.delete('/delete', authenticateToken, async (req, res) => {
  try {
    const chatbot = await Chatbot.findOne({ userId: req.user.userId });
    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });
    await Chatbot.findByIdAndDelete(chatbot._id);
    res.json({ message: 'Chatbot deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update status
router.patch('/update-status', authenticateToken, async (req, res) => {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') return res.status(400).json({ error: 'isActive must be a boolean' });
    const chatbot = await Chatbot.findOneAndUpdate({ userId: req.user.userId }, { isActive }, { new: true });
    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });
    res.json({ message: 'Status updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add knowledge
router.post('/add-knowledge', authenticateToken, async (req, res) => {
  try {
    const { knowledge } = req.body;
    if (!knowledge) return res.status(400).json({ error: 'Knowledge content is required' });
    const chatbot = await Chatbot.findOne({ userId: req.user.userId });
    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });
    const newChunks = knowledge.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    await Chatbot.findByIdAndUpdate(chatbot._id, { $push: { scrapedContent: { $each: newChunks } } });
    res.json({ message: 'Knowledge added successfully', addedChunks: newChunks.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get widget settings (public)
router.get('/settings/:widgetId', async (req, res) => {
  try {
    const chatbot = await Chatbot.findOne({ widgetId: req.params.widgetId });
    if (!chatbot) return res.status(404).json({ error: 'Chatbot not found' });
    if (!chatbot.isActive) return res.status(400).json({ error: 'Chatbot is not active' });
    res.json({ customization: chatbot.customization });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add FAQ
router.post('/faqs', authenticateToken, async (req, res) => {
  try {
    const { question, answer } = req.body;
    if (!question || !answer) return res.status(400).json({ error: 'Question and answer are required' });
    const chatbot = await Chatbot.findOneAndUpdate(
      { userId: req.user.userId },
      { $push: { faqs: { question, answer } } },
      { new: true }
    );
    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });
    res.json({ message: 'FAQ added successfully', faqs: chatbot.faqs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete FAQ
router.delete('/faqs/:index', authenticateToken, async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    const chatbot = await Chatbot.findOne({ userId: req.user.userId });
    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });
    chatbot.faqs.splice(index, 1);
    await chatbot.save();
    res.json({ message: 'FAQ removed successfully', faqs: chatbot.faqs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update customization
router.patch('/customization', authenticateToken, async (req, res) => {
  try {
    const { botName, bubbleColor, welcomeMessage, position } = req.body;
    const chatbot = await Chatbot.findOne({ userId: req.user.userId });
    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });
    if (botName) chatbot.customization.botName = botName;
    if (bubbleColor) chatbot.customization.bubbleColor = bubbleColor;
    if (welcomeMessage) chatbot.customization.welcomeMessage = welcomeMessage;
    if (position) chatbot.customization.position = position;
    await chatbot.save();
    res.json({ message: 'Customization updated', customization: chatbot.customization });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
