const express = require('express');
const router = express.Router();
const Chatbot = require('../models/Chatbot');
const { scrapeWebsite } = require('../scraper/scrape');
const { authenticateToken } = require('../middleware/auth');

// Generate unique widget ID
const generateWidgetId = () => {
  return 'widget_' + Math.random().toString(36).substr(2, 16) + Date.now().toString(36);
};

// Create chatbot (scrape website)
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const { websiteUrl } = req.body;

    if (!websiteUrl) {
      return res.status(400).json({ error: 'Website URL is required' });
    }

    // Check if user already has a chatbot
    const existingBot = Chatbot.findByUserId(req.user.userId);
    if (existingBot) {
      return res.status(400).json({ error: 'You already have a chatbot' });
    }

    // Scrape the website
    let scrapeResult;
    try {
      scrapeResult = await scrapeWebsite(websiteUrl);
    } catch (scrapeError) {
      return res.status(400).json({ error: 'Failed to scrape website: ' + scrapeError.message });
    }

    if (!scrapeResult || scrapeResult.pages.length === 0) {
      return res.status(400).json({ error: 'No content found on the website' });
    }

    // Store the full scrape result (with pages)
    const scrapedContent = scrapeResult;

    // Create chatbot
    const chatbot = await Chatbot.create({
      userId: req.user.userId,
      websiteUrl,
      scrapedContent: scrapeResult,
      widgetId: generateWidgetId()
    });

    // Handle both old and new scrapedContent formats for content count
    let contentCount = 0;
    if (Array.isArray(chatbot.scrapedContent)) {
      contentCount = chatbot.scrapedContent.length;
    } else if (chatbot.scrapedContent && chatbot.scrapedContent.totalChunks) {
      contentCount = chatbot.scrapedContent.totalChunks;
    } else if (chatbot.scrapedContent && chatbot.scrapedContent.pages) {
      contentCount = chatbot.scrapedContent.pages.reduce((sum, p) => sum + p.chunkCount, 0);
    }

    res.status(201).json({
      widgetId: chatbot.widgetId,
      websiteUrl: chatbot.websiteUrl,
      contentCount: contentCount,
      createdAt: chatbot.createdAt
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user's chatbot info
router.get('/my-bot', authenticateToken, async (req, res) => {
  try {
    const chatbot = Chatbot.findByUserId(req.user.userId);

    if (!chatbot) {
      return res.status(404).json({ error: 'No chatbot found' });
    }

    // Get conversation history (last 50)
    const conversations = chatbot.conversations || [];
    const recentConversations = conversations.slice(-50).reverse();

    // Handle scrapedContent for response
    const scrapedContentInfo = Array.isArray(chatbot.scrapedContent)
      ? chatbot.scrapedContent
      : chatbot.scrapedContent && chatbot.scrapedContent.pages
      ? chatbot.scrapedContent.pages.map(page => ({ page: page.page, url: page.url, chunkCount: page.chunkCount }))
      : chatbot.scrapedContent || [];

    res.json({
      widgetId: chatbot.widgetId,
      websiteUrl: chatbot.websiteUrl,
      isActive: chatbot.isActive,
      conversationCount: chatbot.conversationCount,
      createdAt: chatbot.createdAt,
      conversations: recentConversations,
      faqs: chatbot.faqs || [],
      customization: chatbot.customization || {
        botName: "AI Assistant",
        bubbleColor: "#6366f1",
        welcomeMessage: "Hi! I'm your AI assistant. How can I help you today?",
        position: "bottom-right"
      },
      totalConversations: conversations.length,
      scrapedContent: scrapedContentInfo
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Chat endpoint (widget sends message)
router.post('/chat', async (req, res) => {
  try {
    const { widgetId, message } = req.body;

    if (!widgetId || !message) {
      return res.status(400).json({ error: 'Widget ID and message are required' });
    }

    // Special handling for demo widget
    let chatbot;
    if (widgetId === 'demo-widget') {
      chatbot = {
        _id: 'demo',
        widgetId: 'demo-widget',
        userId: 'demo',
        websiteUrl: 'chatwidget.com',
        scrapedContent: [
          `ChatWidget is an AI chatbot builder for businesses. You paste your website URL and we train an AI on your content. Customers can then chat with the AI and get instant answers 24/7.\n\nPricing: Free plan includes 1 chatbot and 50 messages per month. Pro plan coming soon with unlimited everything.\n\nSetup takes 3 minutes. No coding required. Works on any website with one line of code.\n\nSupports Arabic, French, English, Spanish, German and more languages automatically.\n\nYou can add custom knowledge manually from the dashboard for info the scraper missed.\n\nTo get started go to chatwidget.com and click Get Started Free. No credit card needed.`
        ],
        isActive: true,
        conversationCount: 0,
        conversations: [],
        faqs: [],
        customization: {
          botName: "AI Assistant",
          bubbleColor: "#6366f1",
          welcomeMessage: "Hi! I'm your AI assistant. How can I help you today?",
          position: "bottom-right"
        },
        offlineMessages: []
      };
    } else {
      // Find chatbot from database
      chatbot = Chatbot.findByWidgetId(widgetId);
      if (!chatbot) {
        return res.status(404).json({ error: 'Chatbot not found' });
      }

      if (!chatbot.isActive) {
        return res.status(400).json({ error: 'Chatbot is not active' });
      }
    }

    // Prepare context from scraped content and FAQs
    let context = '';

    // Handle both old and new scrapedContent formats
    if (Array.isArray(chatbot.scrapedContent)) {
      // Old format: simple array
      context = chatbot.scrapedContent.join('\n\n');
    } else if (chatbot.scrapedContent && chatbot.scrapedContent.pages) {
      // New format: object with pages
      context = chatbot.scrapedContent.pages.map(page => `
Page: ${page.page || page.url}
${page.content.join('\n')}
`).join('\n\n');
    } else {
      // Fallback to empty context
      context = '';
    }

    if (chatbot.faqs && chatbot.faqs.length > 0) {
      context += '\n\nFrequently Asked Questions:\n' + chatbot.faqs.map(faq => `Q: ${faq.question}\nA: ${faq.answer}`).join('\n\n');
    }

    // Build prompt for Groq
    const prompt = `You are a helpful customer support assistant for this business. Use the context provided to answer customer questions in a friendly, detailed and conversational way.

When a customer asks about a service or product, explain it clearly and encourage them to take action (book, buy, contact).

If the question is related to the business but you don't have specific details, give a helpful general response and suggest they contact the business directly for more info.

Only say you don't have information if the question is completely unrelated to the business.

Always respond in the same language the customer is using.

Business context:

${context}

User question: ${message}

Answer:`;

    // Call Groq API
    const Groq = require('groq-sdk');
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    let answer;
    try {
      const response = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful customer support assistant that answers questions based on business context provided. Use friendly, detailed and conversational responses. Encourage customers to take action when appropriate.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 1000
      });

      answer = response.choices[0].message.content;
    } catch (error) {
      console.error('Groq error:', error.message);
      res.status(500).json({ error: 'Failed to get AI response' });
      return;
    }

    // Add to conversation history (max 100)
    const conversation = {
      user: message,
      bot: answer,
      timestamp: new Date().toISOString()
    };

    let conversations = chatbot.conversations || [];
    conversations.push(conversation);
    if (conversations.length > 100) {
      conversations = conversations.slice(-100);
    }

    // Increment conversation count
    chatbot.conversationCount += 1;

    // Update chatbot in database
    Chatbot.update(chatbot._id, {
      conversationCount: chatbot.conversationCount,
      conversations: conversations
    });

    // Check if answer suggests lack of information for offline collection
    const offlineKeywords = ['don\'t have that information', 'not available', 'cannot find', 'not sure', 'don\'t know'];
    const hasNoInfo = offlineKeywords.some(keyword => answer.toLowerCase().includes(keyword.toLowerCase()));

    // If offline collection is enabled and answer suggests no info, collect message
    if (hasNoInfo && chatbot.offlineMessages && chatbot.offlineMessages.length < 50) {
      const offlineMessage = {
        name: 'Anonymous',
        contact: '',
        question: message,
        timestamp: new Date().toISOString(),
        answer: answer
      };

      // Update chatbot with offline message
      Chatbot.update(chatbot._id, {
        offlineMessages: [...(chatbot.offlineMessages || []), offlineMessage]
      });
    }

    res.json({ answer });
  } catch (error) {
    console.error('Groq error:', error.message);
    res.status(500).json({ error: 'Failed to get AI response' });
  }
});

// Delete chatbot
router.delete('/delete', authenticateToken, async (req, res) => {
  console.log('DELETE /api/chatbot/delete called');
  console.log('User ID:', req.user.userId);
  try {
    const chatbot = Chatbot.findByUserId(req.user.userId);
    console.log('Found chatbot:', chatbot ? chatbot._id : 'None');

    if (!chatbot) {
      return res.status(404).json({ error: 'No chatbot found' });
    }

    const deleteResult = Chatbot.delete(chatbot._id);
    console.log('Delete result:', deleteResult);

    res.json({ message: 'Chatbot deleted successfully' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update chatbot status (active/inactive)
router.patch('/update-status', authenticateToken, async (req, res) => {
  try {
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }

    const chatbot = Chatbot.findByUserId(req.user.userId);

    if (!chatbot) {
      return res.status(404).json({ error: 'No chatbot found' });
    }

    Chatbot.update(chatbot._id, { isActive });

    res.json({ message: 'Status updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add custom knowledge
router.post('/add-knowledge', authenticateToken, async (req, res) => {
  try {
    const { knowledge } = req.body;

    if (!knowledge || typeof knowledge !== 'string') {
      return res.status(400).json({ error: 'Knowledge content is required' });
    }

    const chatbot = Chatbot.findByUserId(req.user.userId);

    if (!chatbot) {
      return res.status(404).json({ error: 'No chatbot found' });
    }

    // Parse the knowledge text (can be multi-line) and add as new chunks
    const newChunks = knowledge
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (newChunks.length === 0) {
      return res.status(400).json({ error: 'No valid content provided' });
    }

    // Handle scrapedContent structure (could be old array format or new pages format)
    let updatedContent;
    if (Array.isArray(chatbot.scrapedContent)) {
      // Old format: simple array
      updatedContent = [...chatbot.scrapedContent, ...newChunks];
    } else if (chatbot.scrapedContent && chatbot.scrapedContent.pages) {
      // New format: object with pages, convert custom knowledge to page
      const customPage = {
        page: '/custom-knowledge',
        url: 'custom',
        content: newChunks,
        chunkCount: newChunks.length
      };
      updatedContent = {
        ...chatbot.scrapedContent,
        pages: [...chatbot.scrapedContent.pages, customPage],
        totalChunks: chatbot.scrapedContent.totalChunks + newChunks.length,
        totalPages: chatbot.scrapedContent.pages.length + 1
      };
    } else {
      // Default: create new pages structure
      updatedContent = {
        pages: [{
          page: '/custom-knowledge',
          url: 'custom',
          content: newChunks,
          chunkCount: newChunks.length
        }],
        totalPages: 1,
        totalChunks: newChunks.length
      };
    }

    Chatbot.update(chatbot._id, { scrapedContent: updatedContent });

    // Determine total chunks for response
    const totalChunks = Array.isArray(updatedContent)
      ? updatedContent.length
      : updatedContent.totalChunks || updatedContent.pages.reduce((sum, p) => sum + p.chunkCount, 0);

    res.json({
      message: 'Knowledge added successfully',
      addedChunks: newChunks.length,
      totalChunks: totalChunks
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Retrain chatbot (re-scrape website)
router.post('/retrain', authenticateToken, async (req, res) => {
  try {
    const chatbot = Chatbot.findByUserId(req.user.userId);

    if (!chatbot) {
      return res.status(404).json({ error: 'No chatbot found' });
    }

    if (!chatbot.websiteUrl) {
      return res.status(400).json({ error: 'No website URL associated with chatbot' });
    }

    // Re-scrape the website with new enhanced scraper
    const scrapedContent = await scrapeWebsite(chatbot.websiteUrl, (progress) => {
      console.log(`[Retrain] ${progress}`);
    });

    if (!scrapedContent || scrapedContent.pages.length === 0) {
      return res.status(400).json({ error: 'No content found during retraining' });
    }

    // Update chatbot with new content
    Chatbot.update(chatbot._id, {
      scrapedContent: scrapedContent
    });

    res.json({
      message: 'Chatbot retrained successfully',
      totalPages: scrapedContent.totalPages,
      totalChunks: scrapedContent.totalChunks,
      pages: scrapedContent.pages.length
    });
  } catch (error) {
    console.error('Retrain error:', error);
    res.status(500).json({ error: 'failed to retrain chatbot: ' + error.message });
  }
});

// Get widget settings (public endpoint)
router.get('/settings/:widgetId', async (req, res) => {
  try {
    const { widgetId } = req.params;
    const chatbot = Chatbot.findByWidgetId(widgetId);

    if (!chatbot) {
      return res.status(404).json({ error: 'Chatbot not found' });
    }

    if (!chatbot.isActive) {
      return res.status(400).json({ error: 'Chatbot is not active' });
    }

    res.json({
      customization: chatbot.customization || {
        botName: "AI Assistant",
        bubbleColor: "#6366f1",
        welcomeMessage: "Hi! I'm your AI assistant. How can I help you today?",
        position: "bottom-right"
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// FAQ management endpoints
router.post('/faqs', authenticateToken, async (req, res) => {
  try {
    const { question, answer } = req.body;

    if (!question || !answer) {
      return res.status(400).json({ error: 'Question and answer are required' });
    }

    const chatbot = Chatbot.findByUserId(req.user.userId);

    if (!chatbot) {
      return res.status(404).json({ error: 'No chatbot found' });
    }

    const faqs = chatbot.faqs || [];
    faqs.push({ question, answer });

    Chatbot.update(chatbot._id, { faqs });

    res.json({
      message: 'FAQ added successfully',
      faqs: faqs,
      total: faqs.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/faqs/:index', authenticateToken, async (req, res) => {
  try {
    const index = parseInt(req.params.index);

    const chatbot = Chatbot.findByUserId(req.user.userId);

    if (!chatbot) {
      return res.status(404).json({ error: 'No chatbot found' });
    }

    const faqs = chatbot.faqs || [];
    if (index < 0 || index >= faqs.length) {
      return res.status(400).json({ error: 'Invalid FAQ index' });
    }

    faqs.splice(index, 1);
    Chatbot.update(chatbot._id, { faqs });

    res.json({
      message: 'FAQ removed successfully',
      faqs: faqs,
      total: faqs.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update customization settings
router.patch('/customization', authenticateToken, async (req, res) => {
  try {
    const { botName, bubbleColor, welcomeMessage, position } = req.body;

    const chatbot = Chatbot.findByUserId(req.user.userId);

    if (!chatbot) {
      return res.status(404).json({ error: 'No chatbot found' });
    }

    const customization = chatbot.customization || {};
    if (botName !== undefined) customization.botName = botName;
    if (bubbleColor !== undefined) customization.bubbleColor = bubbleColor;
    if (welcomeMessage !== undefined) customization.welcomeMessage = welcomeMessage;
    if (position !== undefined) customization.position = position;

    Chatbot.update(chatbot._id, { customization });

    res.json({
      message: 'Customization updated successfully',
      customization: customization
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;