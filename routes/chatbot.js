const express = require('express');
const router = express.Router();
const Chatbot = require('../models/Chatbot');
const Lead = require('../models/Lead');
const { scrapeWebsite } = require('../scraper/scrape');
const { authenticateToken } = require('../middleware/auth');
const Groq = require('groq-sdk');
const multer = require('multer');

// --- NEW MODERN PDF LIBRARY ---
const { PDFExtract } = require('pdf.js-extract');
const pdfExtract = new PDFExtract();

// Configure multer for in-memory file storage (5MB limit)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

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
      scrapedContent: chatbot.scrapedContent,
      customKnowledge: chatbot.customKnowledge || '',
      trainedFiles: chatbot.trainedFiles || [],
      apiKey: chatbot.apiKey || '',
      webhookUrl: chatbot.webhookUrl || ''
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
        customKnowledge: '',
        customization: { botName: "AI Assistant", bubbleColor: "#6366f1", welcomeMessage: "Hi! How can I help you today?", position: "bottom-right", bookingLink: '' }
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

    const systemPrompt = `You are the official customer support assistant for this website. You are here to help the customer, NOT the other way around.

CRITICAL RULES YOU MUST FOLLOW:
1. THE INITIAL GREETING: Your very first message must ALWAYS be a proactive offer to help the customer.
2. STRICT LANGUAGE MATCHING: Instantly adapt to the user's language.
3. YOUR ROLE (CRITICAL): You are the store's employee. Never act like a confused visitor.
4. CONCISENESS: Keep your answers brief, friendly, and highly relevant.
5. UNKNOWN ANSWERS: If a customer asks something not in the provided website data, politely apologize. Do not invent facts.
6. PRODUCT LINKS: If the provided knowledge context explicitly contains a website link for a product, share it. DO NOT use brackets if you don't have a real link.

Here is the knowledge you have about the website:
${context.substring(0, 8000)}

ADDITIONAL BUSINESS RULES & CUSTOM KNOWLEDGE (PRIORITIZE THIS INFORMATION):
${chatbot.customKnowledge ? chatbot.customKnowledge : 'No additional rules provided.'}

BOOKING/ACTION LINK:
${chatbot.customization.bookingLink ? `If the user wants to book an appointment, ALWAYS give them this exact link: ${chatbot.customization.bookingLink}` : ''}
`;

    const messages = [
      { role: 'system', content: systemPrompt }
    ];

    if (Array.isArray(history) && history.length > 0) {
      messages.push(...history);
    }

    messages.push({ role: 'user', content: message });

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: messages,
      temperature: 0.7,
      max_tokens: 1000
    });

    const answer = response.choices[0].message.content;

    let cleanedAnswer = answer.replace(/\[([^\]]+)\]\((?:URL|URL[^)]*|غير متوفر[^)]*)\)/ig, '$1');
    cleanedAnswer = cleanedAnswer.replace(/\[([^\]]+)\]\(\)/g, '$1'); 

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

// Add knowledge (Text)
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

// Upload PDF and extract text
router.post('/upload-pdf', authenticateToken, upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    pdfExtract.extractBuffer(req.file.buffer, {}, async (err, data) => {
      if (err) {
        console.error('PDF extraction error:', err);
        return res.status(500).json({ error: 'Failed to read PDF file structure.' });
      }

      try {
        const chatbot = await Chatbot.findOne({ userId: req.user.userId });
        if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });

        let extractedText = data.pages
          .map(page => page.content.map(item => item.str).join(' '))
          .join('\n\n');

        extractedText = extractedText.trim();
        if (!extractedText) return res.status(400).json({ error: 'No text extracted from PDF' });

        const newChunks = extractedText.split('\n\n').filter(chunk => chunk.trim() !== '');
        
        if (chatbot.customKnowledge) {
          chatbot.customKnowledge += '\n\n' + newChunks.join('\n\n');
        } else {
          chatbot.customKnowledge = newChunks.join('\n\n');
        }

        if (!chatbot.trainedFiles) chatbot.trainedFiles = [];
        chatbot.trainedFiles.push({ fileName: req.file.originalname, uploadDate: Date.now() });

        await chatbot.save();
        res.json({ message: 'Success', fileName: req.file.originalname });
      } catch (dbError) {
        console.error('DB Error:', dbError);
        res.status(500).json({ error: dbError.message });
      }
    });
  } catch (error) {
    console.error('Upload Error:', error);
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
    const { botName, bubbleColor, welcomeMessage, position, leadCaptureTiming, quickReplies, botLogo, bookingLink } = req.body;
    const chatbot = await Chatbot.findOne({ userId: req.user.userId });
    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });
    if (botName) chatbot.customization.botName = botName;
    if (bubbleColor) chatbot.customization.bubbleColor = bubbleColor;
    if (welcomeMessage) chatbot.customization.welcomeMessage = welcomeMessage;
    if (position) chatbot.customization.position = position;
    if (leadCaptureTiming !== undefined) chatbot.customization.leadCaptureTiming = leadCaptureTiming;
    if (quickReplies) chatbot.customization.quickReplies = quickReplies;
    if (botLogo !== undefined) chatbot.customization.botLogo = botLogo;
    if (bookingLink !== undefined) chatbot.customization.bookingLink = bookingLink;
    await chatbot.save();
    res.json({ message: 'Customization updated', customization: chatbot.customization });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save custom knowledge
router.patch('/knowledge', authenticateToken, async (req, res) => {
  try {
    const chatbot = await Chatbot.findOne({ userId: req.user.userId });
    if (!chatbot) return res.status(404).json({ error: 'Chatbot not found' });
    chatbot.customKnowledge = req.body.customKnowledge || '';
    await chatbot.save();
    res.json({ message: 'Knowledge saved' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a specific knowledge source (Text or File)
router.delete('/knowledge/:type/:index', authenticateToken, async (req, res) => {
  try {
    const { type, index } = req.params;
    const chatbot = await Chatbot.findOne({ userId: req.user.userId });

    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });

    const idx = parseInt(index, 10);

    if (type === 'text') {
      if (!chatbot.customKnowledge) return res.status(400).json({ error: 'No text to delete' });
      // Split the text into an array, remove the specific index, and stitch it back together
      let chunks = chatbot.customKnowledge.split('\n\n').filter(chunk => chunk.trim() !== '');
      if (idx >= 0 && idx < chunks.length) {
        chunks.splice(idx, 1);
        chatbot.customKnowledge = chunks.join('\n\n');
      }
    } else if (type === 'file') {
      if (!chatbot.trainedFiles || chatbot.trainedFiles.length === 0) return res.status(400).json({ error: 'No files to delete' });
      // Remove the file from the array
      if (idx >= 0 && idx < chatbot.trainedFiles.length) {
        chatbot.trainedFiles.splice(idx, 1);
      }
    }

    await chatbot.save();

    // Send the updated lists back to the frontend
    res.json({
      message: 'Deleted successfully',
      customKnowledge: chatbot.customKnowledge || '',
      trainedFiles: chatbot.trainedFiles || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Lead capture & Webhook Firing
router.post('/lead', async (req, res) => {
  try {
    const { widgetId, name, whatsapp, email, question } = req.body;
    if (!widgetId || !name || !whatsapp) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const chatbot = await Chatbot.findOne({ widgetId });
    if (!chatbot) return res.status(404).json({ error: 'Chatbot not found' });

    // 1. Save lead to your database
    const lead = new Lead({
      widgetId,
      userId: chatbot.userId,
      name,
      whatsapp,
      email: email || '',
      question: question || ''
    });
    await lead.save();

    // 2. FIRE THE WEBHOOK (If the user has one configured)
    if (chatbot.webhookUrl && chatbot.webhookUrl.trim() !== '') {
      try {
        // We don't await this because we don't want to slow down the user's chat experience!
        // It fires silently in the background.
        fetch(chatbot.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'new_lead_captured',
            botName: chatbot.customization?.botName || 'AI Assistant',
            websiteUrl: chatbot.websiteUrl,
            lead: {
              name: name,
              whatsapp: whatsapp,
              email: email || 'Not provided',
              question: question || 'No context'
            },
            timestamp: new Date().toISOString()
          })
        }).catch(err => console.error('Webhook delivery failed (Network):', err.message));
      } catch (webhookError) {
        console.error('Webhook execution error:', webhookError.message);
      }
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get leads by widgetId
router.get('/leads/:widgetId', authenticateToken, async (req, res) => {
  try {
    const chatbot = await Chatbot.findOne({ widgetId: req.params.widgetId, userId: req.user.userId });
    if (!chatbot) return res.status(403).json({ error: 'Unauthorized' });
    const leads = await Lead.find({ widgetId: req.params.widgetId }).sort({ createdAt: -1 });
    res.json(leads);
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching leads' });
  }
});

// Save API Key
router.patch('/api-key', authenticateToken, async (req, res) => {
  try {
    const { apiKey } = req.body;
    const chatbot = await Chatbot.findOne({ userId: req.user.userId });
    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });

    chatbot.apiKey = apiKey;
    await chatbot.save();

    res.json({ message: 'API Key saved successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save Webhook URL
router.patch('/webhook', authenticateToken, async (req, res) => {
  try {
    const { webhookUrl } = req.body;
    const chatbot = await Chatbot.findOne({ userId: req.user.userId });
    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });

    chatbot.webhookUrl = webhookUrl;
    await chatbot.save();

    res.json({ message: 'Webhook saved successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
