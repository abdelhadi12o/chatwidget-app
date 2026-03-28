const express = require('express');
const router = express.Router();
const Chatbot = require('../models/Chatbot');
const Lead = require('../models/Lead');
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

// Retrain chatbot
router.post('/retrain', authenticateToken, async (req, res) => {
  try {
    const chatbot = await Chatbot.findOne({ userId: req.user.userId });
    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });

    let scrapeResult;
    try {
      scrapeResult = await scrapeWebsite(chatbot.websiteUrl);
    } catch (scrapeError) {
      return res.status(400).json({ error: 'Failed to scrape website: ' + scrapeError.message });
    }

    if (!scrapeResult || scrapeResult.pages.length === 0) {
      return res.status(400).json({ error: 'No content found on the website' });
    }

    chatbot.scrapedContent = scrapeResult;
    await chatbot.save();

    res.json({ message: 'Chatbot retrained successfully' });
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
    const { widgetId, message, history } = req.body;
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

    // Build the messages array for the AI with conversation history
    const systemPrompt = `You are the official customer support assistant for this website. You are here to help the customer, NOT the other way around.

CRITICAL RULES YOU MUST FOLLOW:
1. THE INITIAL GREETING: Your very first message must ALWAYS be a proactive offer to help the customer (e.g., "Welcome! How can I assist you today?"). This first message MUST be in the primary language of the website data. NEVER ask the customer to help you.
2. STRICT LANGUAGE MATCHING: After the initial greeting, you MUST instantly adapt to the user's language. If they reply in English, switch to English immediately. If they reply in French, switch to French. Do not stay stuck in the website's default language.
3. YOUR ROLE (CRITICAL): You are the store's employee. You answer questions, provide product details, and guide the customer. Never act like a confused visitor. Never break character.
4. CONCISENESS: Keep your answers brief, friendly, and highly relevant. No long essays.
5. UNKNOWN ANSWERS: If a customer asks something not in the provided website data, politely apologize and state that you do not have that specific information. Do not invent facts or prices.
6. PRODUCT LINKS: If the provided knowledge context explicitly contains a website link for a product, you must share it like this: [Product Name](https://actual-link.com). IF NO LINK IS PROVIDED IN THE CONTEXT, just type the product name normally. DO NOT use brackets or parentheses if you don't have a real link.

Here is the knowledge you have about the website:
${context.substring(0, 8000)}
`;

    const messages = [
      { role: 'system', content: systemPrompt }
    ];

    // Add conversation history if provided
    if (Array.isArray(history) && history.length > 0) {
      messages.push(...history);
    }

    // Add the current user message (context is already in system prompt)
    messages.push({ role: 'user', content: message });

    const groq = new Groq({
      apiKey: process.env.GROQ_API_KEY
    });
    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: messages,
      temperature: 0.7,
      max_tokens: 1000
    });

    const answer = response.choices[0].message.content;

    // Safety net: If AI hallucinates a literal "URL" or "غير متوفر" in brackets, strip the brackets and just keep the text.
    let cleanedAnswer = answer.replace(/\[([^\]]+)\]\((?:URL|URL[^)]*|غير متوفر[^)]*)\)/ig, '$1');
    cleanedAnswer = cleanedAnswer.replace(/\[([^\]]+)\]\(\)/g, '$1'); // Catches empty ()

    if (widgetId !== 'demo-widget') {
      await Chatbot.findByIdAndUpdate(chatbot._id, {
        $inc: { conversationCount: 1 },
        $push: { conversations: { user: message, bot: cleanedAnswer, timestamp: new Date() } }
      });
    }

    res.json({ answer: cleanedAnswer });
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
    const { botName, bubbleColor, welcomeMessage, position, leadCaptureTiming, quickReplies, botLogo } = req.body;
    const chatbot = await Chatbot.findOne({ userId: req.user.userId });
    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });
    if (botName) chatbot.customization.botName = botName;
    if (bubbleColor) chatbot.customization.bubbleColor = bubbleColor;
    if (welcomeMessage) chatbot.customization.welcomeMessage = welcomeMessage;
    if (position) chatbot.customization.position = position;
    if (leadCaptureTiming !== undefined) chatbot.customization.leadCaptureTiming = leadCaptureTiming;
    if (quickReplies) chatbot.customization.quickReplies = quickReplies;
    if (botLogo !== undefined) chatbot.customization.botLogo = botLogo;
    await chatbot.save();
    res.json({ message: 'Customization updated', customization: chatbot.customization });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Lead capture
router.post('/lead', async (req, res) => {
  try {
    const { widgetId, name, whatsapp, email, question } = req.body;
    if (!widgetId || !name || !whatsapp) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const chatbot = await Chatbot.findOne({ widgetId });
    if (!chatbot) return res.status(404).json({ error: 'Chatbot not found' });
    const lead = new Lead({
      widgetId,
      userId: chatbot.userId,
      name,
      whatsapp,
      email: email || '',
      question: question || ''
    });
    await lead.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get leads by widgetId (protected)
router.get('/leads/:widgetId', authenticateToken, async (req, res) => {
  try {
    // FIX: Changed req.user.id to req.user.userId
    const chatbot = await Chatbot.findOne({ widgetId: req.params.widgetId, userId: req.user.userId });
    if (!chatbot) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const leads = await Lead.find({ widgetId: req.params.widgetId }).sort({ createdAt: -1 });
    res.json(leads);
  } catch (error) {
    console.error('Error fetching leads:', error);
    res.status(500).json({ error: 'Server error fetching leads' });
  }
});

module.exports = router;
