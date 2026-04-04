const express = require('express');
const router = express.Router();
const Chatbot = require('../models/Chatbot');
const Lead = require('../models/Lead');
const User = require('../models/User');
const { scrapeWebsite } = require('../scraper/scrape');
const requireAuth = require('../middleware/auth'); // CLERK: Updated import
const Groq = require('groq-sdk');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const dns = require('dns');
const net = require('net');

// SSRF Protection: Validate that a URL does not resolve to a private/internal IP
const validatePublicUrl = (urlString) => {
  try {
    const url = new URL(urlString);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { valid: false, reason: 'Only HTTP and HTTPS protocols are allowed' };
    }
    const hostname = url.hostname;
    // Block obvious internal hostnames
    if (['localhost', '169.254.169.254', 'metadata.google.internal'].includes(hostname)) {
      return { valid: false, reason: 'Access to internal services is not allowed' };
    }
    // Resolve hostname to IP and check
    return new Promise((resolve) => {
      dns.lookup(hostname, { all: true }, (err, addresses) => {
        if (err || !addresses) {
          return resolve({ valid: false, reason: 'Could not resolve hostname' });
        }
        for (const addr of addresses) {
          const ip = addr.address;
          // Check if any IP is private/internal
          if (
            ip.startsWith('10.') ||                      // 10.0.0.0/8
            ip.startsWith('127.') ||                     // 127.0.0.0/8 (loopback)
            ip === '169.254.169.254' ||                   // AWS metadata
            ip.startsWith('169.254.') ||                  // 169.254.0.0/16 (link-local)
            ip.startsWith('::1') ||                       // ::1 (IPv6 loopback)
            ip.startsWith('fd') ||                         // IPv6 unique local
            ip.startsWith('fc') ||                         // IPv6 unique local
            (ip.startsWith('fe80:') && ip.startsWith('fe80:')) || // IPv6 link-local
            net.isIPv4(ip) && (                          // 172.16.0.0/12 and 192.168.0.0/16
              ip.split('.')[0] === '172' && parseInt(ip.split('.')[1]) >= 16 && parseInt(ip.split('.')[1]) <= 31 ||
              ip.startsWith('192.168.')
            )
          ) {
            return resolve({ valid: false, reason: 'Access to internal/private networks is not allowed' });
          }
        }
        resolve({ valid: true });
      });
    });
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }
};

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "You are sending messages too fast. Please wait a moment." },
  standardHeaders: true,
  legacyHeaders: false,
});

// CORS middleware for public endpoints (chat, lead, settings) —
// allows ANY origin so embedded widgets work on client sites
const publicCors = (req, res, next) => {
  const origin = req.headers.origin || '*';
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Max-Age', '86400');
    return res.sendStatus(204);
  }
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Credentials', 'false');
  next();
};

// Explicit OPTIONS handlers for public routes (preflight)
router.options('/chat', publicCors);
router.options('/settings/:widgetId', publicCors);
router.options('/lead', publicCors);

// Strict CORS for dashboard/auth routes — only allows specified origins
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');
const strictCors = (req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin || '');
    res.header('Access-Control-Allow-Credentials', 'true');
    next();
  } else {
    // For preflight, still respond properly
    if (req.method === 'OPTIONS') {
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      return res.status(403).json({ error: 'Not allowed by CORS' });
    }
    return res.status(403).json({ error: 'Not allowed by CORS' });
  }
};

// OPTIONS handlers for all protected routes (preflight)
router.options('/create', strictCors);
router.options('/retrain', strictCors);
router.options('/my-bot', strictCors);
router.options('/delete/:id', strictCors);
router.options('/update-status', strictCors);
router.options('/list', strictCors);
router.options('/:id', strictCors);
router.options('/add-knowledge', strictCors);
router.options('/upload-pdf', strictCors);
router.options('/faqs', strictCors);
router.options('/faqs/:index', strictCors);
router.options('/customization/:id', strictCors);
router.options('/knowledge', strictCors);
router.options('/knowledge/:type/:index', strictCors);
router.options('/leads/:widgetId', strictCors);
router.options('/api-key', strictCors);
router.options('/webhook', strictCors);

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

function getTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} mins ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Create chatbot
router.post('/create', strictCors, requireAuth, async (req, res) => {
  try {
    const { websiteUrl } = req.body;
    if (!websiteUrl) return res.status(400).json({ error: 'Website URL is required' });

    // Validate URL format
    let parsedUrl;
    try {
      parsedUrl = new URL(websiteUrl);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return res.status(400).json({ error: 'Website URL must use HTTP or HTTPS' });
      }
    } catch (urlError) {
      return res.status(400).json({ error: 'Invalid website URL format' });
    }

    // CLERK: Updated to req.auth.userId
    // (One bot per user limit removed — users can now create multiple chatbots)

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
      userId: req.auth.userId, // CLERK: Updated
      websiteUrl,
      scrapedContent: scrapeResult,
      widgetId: generateWidgetId(),
      name: req.body.botName || 'My Chatbot'
    });
    await chatbot.save();

    res.status(201).json({
      widgetId: chatbot.widgetId,
      websiteUrl: chatbot.websiteUrl,
      createdAt: chatbot.createdAt
    });
  } catch (error) {
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Retrain chatbot
router.post('/retrain', strictCors, requireAuth, async (req, res) => {
  try {
    const chatbot = await Chatbot.findOne({ userId: req.auth.userId }); // CLERK: Updated
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
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user's chatbot
router.get('/my-bot', strictCors, requireAuth, async (req, res) => {
  try {
    const chatbot = await Chatbot.findOne({ userId: req.auth.userId }); // CLERK: Updated
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
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Chat endpoint (Public - No Auth Required)
router.post('/chat', chatLimiter, publicCors, async (req, res) => {
  try {
    const { widgetId, message, history } = req.body;
    if (!widgetId || !message) return res.status(400).json({ error: 'Widget ID and message are required' });

    // Input validation
    if (message.length > 5000) {
      return res.status(400).json({ error: 'Message is too long. Keep it under 5000 characters.' });
    }
    if (!Array.isArray(history) || history.length > 20) {
      return res.status(400).json({ error: 'Invalid history or too many messages' });
    }
    // Validate history items
    for (const item of history) {
      if (typeof item.role !== 'string' || typeof item.content !== 'string' || item.content.length > 5000) {
        return res.status(400).json({ error: 'Invalid history format' });
      }
    }

    // === THE BOUNCER: Domain Origin Check ===
    const requestOrigin = req.headers.origin;

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

      // Domain mismatch check (allow localhost for local dev)
      if (requestOrigin && !requestOrigin.includes('localhost')) {
        const cleanOrigin = requestOrigin.replace(/^https?:\/\//, '').replace(/\/$/, '');
        const cleanBotUrl = chatbot.websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

        if (!cleanOrigin.includes(cleanBotUrl) && !cleanBotUrl.includes(cleanOrigin)) {
          console.warn(`🚨 SECURITY BLOCK: ${requestOrigin} tried to use widget ${widgetId}`);
          return res.status(403).json({ error: 'Unauthorized: This widget is not registered for this domain.' });
        }
      }

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

    // --- AI BRAIN INTEGRATION ---
    // 1. Grab their custom system prompt (AI Brain) or use safe default
    const aiBrain = chatbot.customization?.systemPrompt || "You are a helpful and polite AI assistant. Answer questions clearly.";

    // 2. Build the master system message combining AI Brain + Knowledge Base
    const systemMessage = {
      role: "system",
      content: `${aiBrain}

STRICT RULES:
- Base your answers ONLY on the provided Company Knowledge Base.
- If the answer is not in the knowledge base, politely say you don't know and offer to collect their contact info.

COMPANY KNOWLEDGE BASE:
${context.substring(0, 8000)}

ADDITIONAL BUSINESS RULES & CUSTOM KNOWLEDGE (PRIORITIZE THIS INFORMATION):
${chatbot.customKnowledge ? chatbot.customKnowledge : 'No additional rules provided.'}

BOOKING/ACTION LINK:
${chatbot.customization.bookingLink ? `If the user wants to book an appointment, ALWAYS give them this exact link: ${chatbot.customization.bookingLink}` : ''}`
    };

    // 3. Build final messages array with system message first
    const messages = [systemMessage];

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
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete chatbot (specific by ID)
router.delete('/delete/:id', strictCors, requireAuth, async (req, res) => {
  try {
    const botIdToDelete = req.params.id;
    const userId = req.auth.userId; // CLERK: from middleware

    // Validate ID is a non-empty string
    if (!botIdToDelete || typeof botIdToDelete !== 'string') {
      return res.status(400).json({ error: 'Invalid bot ID' });
    }

    // Find EXACTLY that bot, belonging to EXACTLY that user, and delete it
    const deletedBot = await Chatbot.findOneAndDelete({
      _id: botIdToDelete,
      userId: userId
    });

    if (!deletedBot) {
      return res.status(404).json({ error: "Bot not found or already deleted." });
    }

    res.json({ success: true, message: "Bot deleted successfully." });
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({ error: "Failed to delete bot." });
  }
});

// Update status
router.patch('/update-status', strictCors, requireAuth, async (req, res) => {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') return res.status(400).json({ error: 'isActive must be a boolean' });
    const chatbot = await Chatbot.findOneAndUpdate({ userId: req.auth.userId }, { isActive }, { new: true }); // CLERK: Updated
    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });
    res.json({ message: 'Status updated successfully' });
  } catch (error) {
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// NEW: LIST ALL BOTS
router.get('/list', strictCors, requireAuth, async (req, res) => {
  try {
    const bots = await Chatbot.find({ userId: req.auth.userId }).select('_id name createdAt');  // CLERK: use userId from req.auth
    res.status(200).json(bots);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bots' });
  }
});

// NEW: GET SINGLE BOT BY ID
router.get('/:id', strictCors, requireAuth, async (req, res) => {
  try {
    const chatbot = await Chatbot.findOne({
      _id: req.params.id,
      userId: req.auth.userId
    });
    if (!chatbot) return res.status(404).json({ error: 'Chatbot not found' });

    // Build activityChart: last 7 days of message counts
    const conversations = chatbot.conversations || [];
    const last7Days = [...Array(7)].map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }).sort((a, b) => a - b); // Ensure ascending

    const dayCounts = new Array(7).fill(0);
    conversations.forEach(conv => {
      const convTime = new Date(conv.timestamp).getTime();
      for (let i = 0; i < 7; i++) {
        const dayStart = last7Days[i];
        const dayEnd = dayStart + 24 * 60 * 60 * 1000;
        if (convTime >= dayStart && convTime < dayEnd) {
          dayCounts[i]++;
          break;
        }
      }
    });

    // Build recentMessages: last 20 user messages
    const recentMessages = conversations
      .filter(conv => conv.user && conv.user.trim().length > 0)
      .slice(-20)
      .map(conv => ({
        text: conv.user,
        time: getTimeAgo(new Date(conv.timestamp))
      }))
      .reverse();

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
      webhookUrl: chatbot.webhookUrl || '',
      chunkCount: Array.isArray(chatbot.scrapedContent) ? chatbot.scrapedContent.length : 0,
      activityChart: dayCounts,
      recentMessages: recentMessages
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add knowledge (Text)
router.post('/add-knowledge', strictCors, requireAuth, async (req, res) => {
  try {
    const { knowledge } = req.body;
    if (!knowledge) return res.status(400).json({ error: 'Knowledge content is required' });
    if (knowledge.length > 50000) {
      return res.status(400).json({ error: 'Knowledge is too long. Keep it under 50,000 characters.' });
    }
    const chatbot = await Chatbot.findOne({ userId: req.auth.userId }); // CLERK: Updated
    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });
    const newChunks = knowledge.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    await Chatbot.findByIdAndUpdate(chatbot._id, { $push: { scrapedContent: { $each: newChunks } } });
    res.json({ message: 'Knowledge added successfully', addedChunks: newChunks.length });
  } catch (error) {
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload PDF and extract text
router.post('/upload-pdf', strictCors, requireAuth, upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Validate file type
    if (req.file.mimetype !== 'application/pdf') {
      return res.status(400).json({ error: 'Only PDF files are allowed' });
    }

    // Validate file size (5MB limit)
    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'File size exceeds 5MB limit' });
    }

    pdfExtract.extractBuffer(req.file.buffer, {}, async (err, data) => {
      if (err) {
        console.error('PDF extraction error:', err);
        return res.status(500).json({ error: 'Failed to read PDF file structure.' });
      }

      try {
        const chatbot = await Chatbot.findOne({ userId: req.auth.userId }); // CLERK: Updated
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
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  } catch (error) {
    console.error('Upload Error:', error);
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get widget settings (public)
router.get('/settings/:widgetId', publicCors, async (req, res) => {
  try {
    const chatbot = await Chatbot.findOne({ widgetId: req.params.widgetId });
    if (!chatbot) return res.status(404).json({ error: 'Chatbot not found' });
    if (!chatbot.isActive) return res.status(400).json({ error: 'Chatbot is not active' });
    res.json({ customization: chatbot.customization });
  } catch (error) {
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add FAQ
router.post('/faqs', strictCors, requireAuth, async (req, res) => {
  try {
    const { question, answer } = req.body;
    if (!question || !answer) return res.status(400).json({ error: 'Question and answer are required' });
    const chatbot = await Chatbot.findOneAndUpdate(
      { userId: req.auth.userId }, // CLERK: Updated
      { $push: { faqs: { question, answer } } },
      { new: true }
    );
    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });
    res.json({ message: 'FAQ added successfully', faqs: chatbot.faqs });
  } catch (error) {
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete FAQ
router.delete('/faqs/:index', strictCors, requireAuth, async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    const chatbot = await Chatbot.findOne({ userId: req.auth.userId }); // CLERK: Updated
    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });
    chatbot.faqs.splice(index, 1);
    await chatbot.save();
    res.json({ message: 'FAQ removed successfully', faqs: chatbot.faqs });
  } catch (error) {
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update customization (specific bot by ID)
router.patch('/customization/:id', strictCors, requireAuth, async (req, res) => {
  try {
    const botIdToUpdate = req.params.id;
    const userId = req.auth.userId; // CLERK: from middleware

    // Find EXACTLY that bot belonging to this user
    const chatbot = await Chatbot.findOne({ _id: botIdToUpdate, userId });
    if (!chatbot) return res.status(404).json({ error: 'Chatbot not found' });

    const { botName, bubbleColor, welcomeMessage, position, leadCaptureTiming, quickReplies, botLogo, bookingLink, systemPrompt } = req.body;
    // Validate string field lengths
    if (botName) {
      if (botName.length > 50) return res.status(400).json({ error: 'Bot name is too long' });
      chatbot.customization.botName = botName;
    }
    if (bubbleColor) {
      if (!/^#[0-9A-Fa-f]{6}$/.test(bubbleColor)) return res.status(400).json({ error: 'Invalid color format (use hex like #6366f1)' });
      chatbot.customization.bubbleColor = bubbleColor;
    }
    if (welcomeMessage) {
      if (welcomeMessage.length > 500) return res.status(400).json({ error: 'Welcome message is too long' });
      chatbot.customization.welcomeMessage = welcomeMessage;
    }
    if (position) {
      const validPositions = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
      if (!validPositions.includes(position)) return res.status(400).json({ error: 'Invalid position value' });
      chatbot.customization.position = position;
    }
    if (leadCaptureTiming !== undefined) chatbot.customization.leadCaptureTiming = leadCaptureTiming;
    if (quickReplies) {
      if (!Array.isArray(quickReplies) || quickReplies.length > 5) return res.status(400).json({ error: 'Invalid quick replies' });
      for (const qr of quickReplies) {
        if (typeof qr !== 'string' || qr.length > 50) return res.status(400).json({ error: 'Quick reply items must be strings under 50 chars' });
      }
      chatbot.customization.quickReplies = quickReplies;
    }
    if (botLogo !== undefined) {
      if (typeof botLogo !== 'string' || botLogo.length > 500) return res.status(400).json({ error: 'Invalid bot logo URL' });
      chatbot.customization.botLogo = botLogo;
    }
    if (bookingLink !== undefined) {
      if (typeof bookingLink !== 'string' || (bookingLink.length > 500 && bookingLink !== '')) return res.status(400).json({ error: 'Invalid booking link' });
      chatbot.customization.bookingLink = bookingLink;
    }
    if (systemPrompt !== undefined) {
      if (systemPrompt.length > 5000) return res.status(400).json({ error: 'System prompt is too long (5000 chars max)' });
      chatbot.customization.systemPrompt = systemPrompt;
    }

    await chatbot.save();
    res.json({ message: 'Customization updated', customization: chatbot.customization });
  } catch (error) {
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Save custom knowledge
router.patch('/knowledge', strictCors, requireAuth, async (req, res) => {
  try {
    const { customKnowledge } = req.body;
    if (typeof customKnowledge !== 'string' || customKnowledge.length > 50000) {
      return res.status(400).json({ error: 'Custom knowledge must be a string under 50,000 characters.' });
    }
    const chatbot = await Chatbot.findOne({ userId: req.auth.userId }); // CLERK: Updated
    if (!chatbot) return res.status(404).json({ error: 'Chatbot not found' });
    chatbot.customKnowledge = customKnowledge;
    await chatbot.save();
    res.json({ message: 'Knowledge saved' });
  } catch (error) {
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a specific knowledge source (Text or File)
router.delete('/knowledge/:type/:index', strictCors, requireAuth, async (req, res) => {
  try {
    const { type, index } = req.params;
    const chatbot = await Chatbot.findOne({ userId: req.auth.userId }); // CLERK: Updated

    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });

    const idx = parseInt(index, 10);

    if (type === 'text') {
      if (!chatbot.customKnowledge) return res.status(400).json({ error: 'No text to delete' });
      let chunks = chatbot.customKnowledge.split('\n\n').filter(chunk => chunk.trim() !== '');
      if (idx >= 0 && idx < chunks.length) {
        chunks.splice(idx, 1);
        chatbot.customKnowledge = chunks.join('\n\n');
      }
    } else if (type === 'file') {
      if (!chatbot.trainedFiles || chatbot.trainedFiles.length === 0) return res.status(400).json({ error: 'No files to delete' });
      if (idx >= 0 && idx < chatbot.trainedFiles.length) {
        chatbot.trainedFiles.splice(idx, 1);
      }
    }

    await chatbot.save();

    res.json({
      message: 'Deleted successfully',
      customKnowledge: chatbot.customKnowledge || '',
      trainedFiles: chatbot.trainedFiles || []
    });
  } catch (error) {
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Lead capture & Webhook Firing (Public)
router.post('/lead', publicCors, async (req, res) => {
  try {
    const { widgetId, name, whatsapp, email, question } = req.body;
    if (!widgetId || !name || !whatsapp) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Input validation
    if (name.length > 100) {
      return res.status(400).json({ error: 'Name is too long' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    if (whatsapp.length > 20) {
      return res.status(400).json({ error: 'WhatsApp number is too long' });
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

    if (chatbot.webhookUrl && chatbot.webhookUrl.trim() !== '') {
      try {
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
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get leads by widgetId
router.get('/leads/:widgetId', strictCors, requireAuth, async (req, res) => {
  try {
    const chatbot = await Chatbot.findOne({ widgetId: req.params.widgetId, userId: req.auth.userId }); // CLERK: Updated
    if (!chatbot) return res.status(403).json({ error: 'Unauthorized' });
    const leads = await Lead.find({ widgetId: req.params.widgetId }).sort({ createdAt: -1 });
    res.json(leads);
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching leads' });
  }
});

// Save API Key
router.patch('/api-key', strictCors, requireAuth, async (req, res) => {
  try {
    const { apiKey } = req.body;
    const chatbot = await Chatbot.findOne({ userId: req.auth.userId }); // CLERK: Updated
    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });

    chatbot.apiKey = apiKey;
    await chatbot.save();

    res.json({ message: 'API Key saved successfully' });
  } catch (error) {
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Save Webhook URL
router.patch('/webhook', strictCors, requireAuth, async (req, res) => {
  try {
    const { webhookUrl } = req.body;
    const chatbot = await Chatbot.findOne({ userId: req.auth.userId }); // CLERK: Updated
    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });

    if (webhookUrl) {
      const validation = await validatePublicUrl(webhookUrl);
      if (!validation.valid) {
        return res.status(400).json({ error: 'Invalid webhook URL: ' + validation.reason });
      }
    }

    chatbot.webhookUrl = webhookUrl;
    await chatbot.save();

    res.json({ message: 'Webhook saved successfully' });
  } catch (error) {
    console.error('Webhook save error:', error);
    res.status(500).json({ error: 'Failed to save webhook' });
  }
});

module.exports = router;
