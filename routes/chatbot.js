const express = require('express');
const router = express.Router();
const Chatbot = require('../models/Chatbot');
const Lead = require('../models/Lead');
const User = require('../models/User');
const { scrapeWebsite } = require('../scraper/scrape');
const requireAuth = require('../middleware/auth');
const { checkSubscription } = require('../middleware/subscription');
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
router.post('/create', strictCors, requireAuth, checkSubscription, async (req, res) => {
  try {
    const { websiteUrl } = req.body;
    if (!websiteUrl) return res.status(400).json({ error: 'Website URL is required' });

    // Check max bots limit
    const botCount = await Chatbot.countDocuments({ userId: req.auth.userId });
    if (botCount >= req.planLimits.maxBots) {
        return res.status(403).json({
            error: 'LIMIT_REACHED',
            message: `Your ${req.dbUser.plan} plan is limited to ${req.planLimits.maxBots} chatbot(s). Please upgrade to create more.`
        });
    }

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
      userId: req.auth.userId,
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

// Retrain chatbot - requires widgetId to identify specific bot
router.post('/retrain', strictCors, requireAuth, checkSubscription, async (req, res) => {
  try {
    const { widgetId } = req.body;
    if (!widgetId) return res.status(400).json({ error: 'widgetId is required' });
    const chatbot = await Chatbot.findOne({ userId: req.auth.userId, widgetId });
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

// Get user's chatbot - for backward compatibility returns first bot.
// For multi-bot, prefer using /list or /:id
router.get('/my-bot', strictCors, requireAuth, checkSubscription, async (req, res) => {
  try {
    // For backward compatibility: return first bot
    const chatbot = await Chatbot.findOne({ userId: req.auth.userId });
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
      webhookUrl: chatbot.whatsAppNumber || '',
      bookingQuestions: chatbot.bookingQuestions || [],
      whatsappNumber: chatbot.whatsappNumber || '',
      enableBookingFlow: chatbot.enableBookingFlow || false,
      proactiveMessage: chatbot.proactiveMessage || '👋 Hi there! Have any questions?',
      proactiveDelay: chatbot.proactiveDelay !== undefined ? chatbot.proactiveDelay : 3,
      proactiveEnabled: chatbot.proactiveEnabled !== undefined ? chatbot.proactiveEnabled : true
    });
  } catch (error) {
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Chat endpoint (Public - No Auth Required)
router.post('/chat', chatLimiter, publicCors, async (req, res) => {
  console.log('🚀 CHAT ENDPOINT HIT - widgetId:', req.body?.widgetId, 'message:', req.body?.message);
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
        scrapedContent: [`IMPORTANT PRICING INFORMATION:
Starter Plan - $29/month: 1 chatbot, 1,000 messages, basic knowledge base, lead capture.
Pro Plan (Most Popular) - $79/month: Up to 3 chatbots, 5,000 messages, advanced knowledge base (PDFs up to 5MB), automations (Webhooks/Zapier), The AI Brain.
Agency Plan - $199/month: Up to 10 chatbots, 20,000 messages, unlimited knowledge base, developer access, white-glove support.
Free Trial: 7-day free trial with no credit card required. Direct users to /register.html to get started.`],
        isActive: true,
        conversationCount: 0,
        faqs: [],
        customKnowledge: '',
        customization: { botName: "AI Assistant", bubbleColor: "#6366f1", welcomeMessage: "Hi! How can I help you today?", position: "bottom-right", bookingLink: '' }
      };
    } else {
      chatbot = await Chatbot.findOne({ widgetId });
      console.log('✅ Chatbot found in DB:', chatbot?._id, 'Name:', chatbot?.name);
      if (!chatbot) return res.status(404).json({ error: 'Chatbot not found' });

      // Domain mismatch check (allow localhost and ultramora.com dashboard for testing)
      const requestReferer = req.headers.referer;
      const isDashboard = (requestOrigin && (requestOrigin.includes('ultramora.com') ||
                           requestOrigin.includes('localhost') ||
                           requestOrigin.includes('127.0.0.1'))) ||
                          (requestReferer && (requestReferer.includes('ultramora.com') ||
                           requestReferer.includes('localhost') ||
                           requestReferer.includes('127.0.0.1')));

      if (!isDashboard && requestOrigin) {
        const cleanOrigin = requestOrigin.replace(/^https?:\/\//, '').replace(/\/$/, '');
        const cleanBotUrl = chatbot.websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

        if (!cleanOrigin.includes(cleanBotUrl) && !cleanBotUrl.includes(cleanOrigin)) {
          console.warn(`🚨 SECURITY BLOCK: ${requestOrigin} tried to use widget ${widgetId}`);
          return res.status(403).json({ error: 'Unauthorized: This widget is not registered for this domain.' });
        }
      }

      if (!chatbot.isActive) return res.status(400).json({ error: 'Chatbot is not active' });
    }

    // === PROGRAMMATIC BOOKING INTENT DETECTION ===
    // Detect booking intent BEFORE calling AI to ensure reliable booking flow triggering
    const bookingKeywords = ['book', 'schedule', 'appointment', 'reserve', 'booking', 'slot', 'consultation', 'session', 'visit', 'table', 'reservation'];
    const messageLower = message.toLowerCase();
    const userWantsToBook = bookingKeywords.some(kw => messageLower.includes(kw));

    // Also detect intent patterns like "can i", "i want to", "i'd like to"
    const intentPatterns = ['i want to', "i'd like to", 'can i', 'could i', 'i would like to', 'i need to', 'i wish to', 'help me'];
    const hasBookingIntent = intentPatterns.some(pattern => messageLower.includes(pattern)) &&
                              (messageLower.includes('book') || messageLower.includes('schedule') || messageLower.includes('appointment'));

    const shouldTriggerBooking = userWantsToBook || hasBookingIntent;

    // DEBUG LOGGING
    console.log('=== BOOKING DEBUG ===');
    console.log('WidgetId:', widgetId);
    console.log('User message:', message);
    console.log('userWantsToBook:', userWantsToBook);
    console.log('enableBookingFlow:', chatbot.enableBookingFlow);
    console.log('enableBookingFlow type:', typeof chatbot.enableBookingFlow);
    console.log('bookingQuestions:', chatbot.bookingQuestions);
    console.log('bookingQuestions length:', chatbot.bookingQuestions?.length);
    console.log('=====================');

    // If booking flow is enabled AND user shows intent AND questions exist, trigger immediately
    if (chatbot.enableBookingFlow === true && shouldTriggerBooking && chatbot.bookingQuestions && chatbot.bookingQuestions.length > 0) {
      console.log('✅ TRIGGERING BOOKING FLOW - Returning immediately');
      return res.json({ answer: '[TRIGGER_BOOKING]' });
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

ADDITIONAL BUSINESS RULES:
${chatbot.customKnowledge ? chatbot.customKnowledge : 'No additional rules provided.'}

${chatbot.enableBookingFlow === true ? `AUTOMATED BOOKING FUNNEL RULES:
1. ONLY append the exact string [TRIGGER_BOOKING] to your response IF the user explicitly asks to book, schedule, or reserve an appointment.
2. NEVER append [TRIGGER_BOOKING] to your initial greeting.
3. NEVER append [TRIGGER_BOOKING] if you are merely asking the user if they want to book.
4. You are strictly FORBIDDEN from providing external URLs, links, or phone numbers for scheduling. Let the automated system handle it.` : ''}`
    };

    // 3. Build final messages array with system message first
    const messages = [systemMessage];

    if (Array.isArray(history) && history.length > 0) {
      messages.push(...history);
    }

    messages.push({ role: 'user', content: message });

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: messages,
      temperature: 0.7,
      max_tokens: 1000
    });

    const answer = response.choices[0].message.content;

    let cleanedAnswer = answer.replace(/\[([^\]]+)\]\((?:URL|URL[^)]*|غير متوفر[^)]*)\)/ig, '$1');
    cleanedAnswer = cleanedAnswer.replace(/\[([^\]]+)\]\(\)/g, '$1');

    // Clean trailing periods from URLs to prevent broken links
    cleanedAnswer = cleanedAnswer.replace(/(https?:\/\/[^\s)\]]+)\./g, '$1');

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
router.delete('/delete/:id', strictCors, requireAuth, checkSubscription, async (req, res) => {
  try {
    const botIdToDelete = req.params.id;
    const userId = req.auth.userId;

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

// Update status - requires widgetId in body
router.patch('/update-status', strictCors, requireAuth, checkSubscription, async (req, res) => {
  try {
    const { isActive, widgetId } = req.body;
    if (typeof isActive !== 'boolean') return res.status(400).json({ error: 'isActive must be a boolean' });
    if (!widgetId) return res.status(400).json({ error: 'widgetId is required' });
    const chatbot = await Chatbot.findOneAndUpdate({ userId: req.auth.userId, widgetId }, { isActive }, { returnDocument: 'after' });
    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });
    res.json({ message: 'Status updated successfully' });
  } catch (error) {
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// LIST ALL BOTS
router.get('/list', strictCors, requireAuth, checkSubscription, async (req, res) => {
  try {
    const bots = await Chatbot.find({ userId: req.auth.userId }).select('_id name createdAt widgetId');
    res.status(200).json(bots);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bots' });
  }
});

// GET SINGLE BOT BY ID
router.get('/:id', strictCors, requireAuth, checkSubscription, async (req, res) => {
  try {
    const chatbot = await Chatbot.findOne({
      _id: req.params.id,
      userId: req.auth.userId
    }).slice('conversations', -500); // Fetch last 500 messages only
    if (!chatbot) return res.status(404).json({ error: 'Chatbot not found' });

    // Build activityChart: last 7 days of message counts
    const conversations = chatbot.conversations || [];
    const last7Days = [...Array(7)].map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }).sort((a, b) => a - b);

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
      recentMessages: recentMessages,
      bookingQuestions: chatbot.bookingQuestions || [],
      whatsappNumber: chatbot.whatsappNumber || '',
      enableBookingFlow: chatbot.enableBookingFlow || false,
      proactiveMessage: chatbot.proactiveMessage || '👋 Hi there! Have any questions?',
      proactiveDelay: chatbot.proactiveDelay !== undefined ? chatbot.proactiveDelay : 3,
      proactiveEnabled: chatbot.proactiveEnabled !== undefined ? chatbot.proactiveEnabled : true
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add knowledge (Text) - requires widgetId in body
router.post('/add-knowledge', strictCors, requireAuth, checkSubscription, async (req, res) => {
  try {
    const { knowledge, widgetId } = req.body;
    if (!widgetId) return res.status(400).json({ error: 'widgetId is required' });
    if (!knowledge) return res.status(400).json({ error: 'Knowledge content is required' });
    if (knowledge.length > 50000) {
      return res.status(400).json({ error: 'Knowledge is too long. Keep it under 50,000 characters.' });
    }
    const chatbot = await Chatbot.findOne({ userId: req.auth.userId, widgetId });
    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });
    const newChunks = knowledge.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    await Chatbot.findByIdAndUpdate(chatbot._id, { $push: { scrapedContent: { $each: newChunks } } });
    res.json({ message: 'Knowledge added successfully', addedChunks: newChunks.length });
  } catch (error) {
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload PDF and extract text - requires widgetId in body
router.post('/upload-pdf', strictCors, requireAuth, checkSubscription, upload.single('file'), (req, res) => {
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

    const { widgetId } = req.body;
    if (!widgetId) return res.status(400).json({ error: 'widgetId is required' });

    pdfExtract.extractBuffer(req.file.buffer, {}, async (err, data) => {
      if (err) {
        console.error('PDF extraction error:', err);
        return res.status(500).json({ error: 'Failed to read PDF file structure.' });
      }

      try {
        const chatbot = await Chatbot.findOne({ userId: req.auth.userId, widgetId });
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
    // Don't use lean() - it can cause issues with boolean type conversion
    const chatbot = await Chatbot.findOne({ widgetId: req.params.widgetId });
    if (!chatbot) return res.status(404).json({ error: 'Chatbot not found' });
    if (!chatbot.isActive) return res.status(400).json({ error: 'Chatbot is not active' });

    // Force convert to boolean to ensure correct type
    const enableBookingFlow = Boolean(chatbot.enableBookingFlow);

    const response = {
      customization: chatbot.customization || {},
      enableBookingFlow: enableBookingFlow,
      bookingQuestions: chatbot.bookingQuestions || [],
      whatsappNumber: chatbot.whatsappNumber || '',
      proactiveMessage: chatbot.proactiveMessage || '👋 Hi there! Have any questions?',
      proactiveDelay: chatbot.proactiveDelay !== undefined ? chatbot.proactiveDelay : 3,
      proactiveEnabled: chatbot.proactiveEnabled !== undefined ? chatbot.proactiveEnabled : true
    };

    console.log(`📤 SETTINGS endpoint: widgetId=${req.params.widgetId}`);
    console.log(`   DB enableBookingFlow=${chatbot.enableBookingFlow} (type: ${typeof chatbot.enableBookingFlow})`);
    console.log(`   Converted enableBookingFlow=${enableBookingFlow} (type: ${typeof enableBookingFlow})`);
    console.log(`   bookingQuestions=${chatbot.bookingQuestions?.length || 0}`);
    console.log(`   RESPONSE:`, JSON.stringify(response));

    // Prevent caching - aggressive headers
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('Vary', '*');
    res.json(response);
  } catch (error) {
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add FAQ - requires widgetId in body
router.post('/faqs', strictCors, requireAuth, checkSubscription, async (req, res) => {
  try {
    const { question, answer, widgetId } = req.body;
    if (!question || !answer) return res.status(400).json({ error: 'Question and answer are required' });
    if (!widgetId) return res.status(400).json({ error: 'widgetId is required' });
    const chatbot = await Chatbot.findOneAndUpdate(
      { userId: req.auth.userId, widgetId },
      { $push: { faqs: { question, answer } } },
      { returnDocument: 'after' }
    );
    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });
    res.json({ message: 'FAQ added successfully', faqs: chatbot.faqs });
  } catch (error) {
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete FAQ - uses URL path, no widgetId needed as bot found by index after we get it
router.delete('/faqs/:index', strictCors, requireAuth, checkSubscription, async (req, res) => {
  try {
    const index = parseInt(req.params.index);
    // Note: For multi-bot, we would need widgetId here too.
    // However current implementation doesn't track which FAQ to delete from which bot in the URL,
    // it assumes we've already identified the bot. This route is flawed for multi-bot.
    // We'll need to update frontend to pass widgetId in body or change URL to include widgetId.
    // For now, let's require widgetId in body.
    const { widgetId } = req.body;
    if (!widgetId) return res.status(400).json({ error: 'widgetId is required' });

    const chatbot = await Chatbot.findOne({ userId: req.auth.userId, widgetId });
    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });
    chatbot.faqs.splice(index, 1);
    await chatbot.save();
    res.json({ message: 'FAQ removed successfully', faqs: chatbot.faqs });
  } catch (error) {
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update customization (specific bot by ID) - uses route param id (MongoDB _id)
router.patch('/customization/:id', strictCors, requireAuth, checkSubscription, async (req, res) => {
  try {
    const botIdToUpdate = req.params.id;
    const userId = req.auth.userId;

    console.log(`📝 CUSTOMIZATION endpoint: botId=${botIdToUpdate}, userId=${userId}`);
    console.log(`   Body:`, JSON.stringify(req.body));

    // Find EXACTLY that bot belonging to this user
    const chatbot = await Chatbot.findOne({ _id: botIdToUpdate, userId });
    if (!chatbot) {
      console.log(`   ERROR: Bot not found`);
      return res.status(404).json({ error: 'Chatbot not found' });
    }

    const { botName, bubbleColor, welcomeMessage, position, leadCaptureTiming, quickReplies, botLogo, bookingLink, systemPrompt, launcherImage, bookingQuestions, whatsappNumber, enableBookingFlow, proactiveMessage, proactiveDelay, proactiveEnabled } = req.body;
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
    if (launcherImage !== undefined) {
      if (typeof launcherImage !== 'string' || launcherImage.length > 500000) return res.status(400).json({ error: 'Invalid launcher image (must be base64 string under 500KB)' });
      chatbot.customization.launcherImage = launcherImage;
    }
    if (bookingQuestions !== undefined) {
      if (!Array.isArray(bookingQuestions) || bookingQuestions.length > 10) return res.status(400).json({ error: 'Booking questions must be an array with max 10 items' });
      for (const q of bookingQuestions) {
        if (typeof q !== 'string' || q.length > 200) return res.status(400).json({ error: 'Each booking question must be a string under 200 chars' });
      }
      chatbot.bookingQuestions = bookingQuestions;
    }
    if (whatsappNumber !== undefined) {
      if (typeof whatsappNumber !== 'string' || (whatsappNumber.length > 20 && whatsappNumber !== '')) return res.status(400).json({ error: 'WhatsApp number is too long' });
      chatbot.whatsappNumber = whatsappNumber;
    }
    if (enableBookingFlow !== undefined) {
      if (typeof enableBookingFlow !== 'boolean') return res.status(400).json({ error: 'enableBookingFlow must be a boolean' });
      chatbot.enableBookingFlow = enableBookingFlow;
      console.log(`💾 SAVING enableBookingFlow=${enableBookingFlow} for bot ${chatbot._id} (widgetId: ${chatbot.widgetId})`);
    }
    if (proactiveMessage !== undefined) {
      if (typeof proactiveMessage !== 'string' || proactiveMessage.length > 100) return res.status(400).json({ error: 'Proactive message must be a string under 100 chars' });
      chatbot.proactiveMessage = proactiveMessage;
      chatbot.markModified('proactiveMessage');
    }
    if (proactiveDelay !== undefined) {
      if (typeof proactiveDelay !== 'number' || proactiveDelay < 0 || proactiveDelay > 60) return res.status(400).json({ error: 'Delay must be a number between 0 and 60' });
      chatbot.proactiveDelay = proactiveDelay;
      chatbot.markModified('proactiveDelay');
    }
    if (proactiveEnabled !== undefined) {
      if (typeof proactiveEnabled !== 'boolean') return res.status(400).json({ error: 'proactiveEnabled must be a boolean' });
      chatbot.proactiveEnabled = proactiveEnabled;
      chatbot.markModified('proactiveEnabled');
      console.log(`💾 SAVING proactiveEnabled=${proactiveEnabled} for bot ${chatbot._id}`);
    }

    if (bookingQuestions !== undefined) {
      chatbot.bookingQuestions = bookingQuestions;
      console.log(`💾 SAVING ${bookingQuestions.length} bookingQuestions for bot ${chatbot._id}`);
    }

    await chatbot.save();
    console.log(`✅ SAVED to database for bot ${chatbot._id}`);
    console.log(`   Saved values: enableBookingFlow=${chatbot.enableBookingFlow}, whatsappNumber=${chatbot.whatsappNumber}, bookingQuestions=${chatbot.bookingQuestions?.length || 0}`);
    res.json({ message: 'Customization updated', customization: chatbot.customization, enableBookingFlow: chatbot.enableBookingFlow });
  } catch (error) {
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Save custom knowledge - requires widgetId in body
router.patch('/knowledge', strictCors, requireAuth, checkSubscription, async (req, res) => {
  try {
    const { customKnowledge, widgetId } = req.body;
    if (!widgetId) return res.status(400).json({ error: 'widgetId is required' });
    if (typeof customKnowledge !== 'string' || customKnowledge.length > 50000) {
      return res.status(400).json({ error: 'Custom knowledge must be a string under 50,000 characters.' });
    }
    const chatbot = await Chatbot.findOne({ userId: req.auth.userId, widgetId });
    if (!chatbot) return res.status(404).json({ error: 'Chatbot not found' });
    chatbot.customKnowledge = customKnowledge;
    await chatbot.save();
    res.json({ message: 'Knowledge saved' });
  } catch (error) {
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a specific knowledge source (Text or File) - requires widgetId to identify bot
router.delete('/knowledge/:type/:index', strictCors, requireAuth, checkSubscription, async (req, res) => {
  try {
    const { type, index } = req.params;
    const { widgetId } = req.body;
    if (!widgetId) return res.status(400).json({ error: 'widgetId is required' });

    const chatbot = await Chatbot.findOne({ userId: req.auth.userId, widgetId });

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
    const chatbot = await Chatbot.findOne({ widgetId: req.params.widgetId, userId: req.auth.userId });
    if (!chatbot) return res.status(403).json({ error: 'Unauthorized' });
    const leads = await Lead.find({ widgetId: req.params.widgetId }).sort({ createdAt: -1 });
    res.json(leads);
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching leads' });
  }
});

// Save API Key - requires widgetId in body
router.patch('/api-key', strictCors, requireAuth, async (req, res) => {
  try {
    const { apiKey, widgetId } = req.body;
    if (!widgetId) return res.status(400).json({ error: 'widgetId is required' });
    const chatbot = await Chatbot.findOne({ userId: req.auth.userId, widgetId });
    if (!chatbot) return res.status(404).json({ error: 'No chatbot found' });

    chatbot.apiKey = apiKey;
    await chatbot.save();

    res.json({ message: 'API Key saved successfully' });
  } catch (error) {
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Save Webhook URL - requires widgetId in body
router.patch('/webhook', strictCors, requireAuth, async (req, res) => {
  try {
    const { webhookUrl, widgetId } = req.body;
    if (!widgetId) return res.status(400).json({ error: 'widgetId is required' });
    const chatbot = await Chatbot.findOne({ userId: req.auth.userId, widgetId });
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
