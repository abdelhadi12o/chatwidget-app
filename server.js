require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const helmet = require('helmet');
const connectDB = require('./database');
const Chatbot = require('./models/Chatbot');
const path = require('path');

const app = express();
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);

// HTTPS redirect middleware - only in production
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
    const targetHost = process.env.NODE_ENV === 'production' ? 'ultramora.com' : req.headers.host;
    return res.redirect('https://' + targetHost + req.url);
  }
  next();
});

// Security headers with Helmet - configured to allow widget embedding and external resources
const isDev = process.env.NODE_ENV !== 'production';

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "https://cdn.jsdelivr.net",
                "https://cdn.tailwindcss.com",
                "https://cdnjs.cloudflare.com",
                "https://ultramora.com",
                "https://static.cloudflareinsights.com",
                "https://*.clerk.accounts.dev",
                "https://clerk.com",
                "blob:"
            ],
            scriptSrcAttr: ["'unsafe-inline'"],
            workerSrc: ["'self'", "blob:"],
            styleSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://api.fontshare.com",
                "https://fonts.googleapis.com",
                "https://cdn.jsdelivr.net"
            ],
            fontSrc: ["*", "data:"],
            connectSrc: [
                "'self'",
                "https://api.clerk.dev",
                "https://*.clerk.accounts.dev",
                "https://cdn.jsdelivr.net",
                "https://cdnjs.cloudflare.com",
                "https://ultramora.com",
                "https://clerk.ultramora.com",
                "https://cloudflareinsights.com",
                "https://static.cloudflareinsights.com",
                ...(isDev ? ["http://localhost:3000"] : [])
            ],
            imgSrc: ["*", "data:", "blob:"],
            frameAncestors: ["'self'"],
            frameSrc: ["'self'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: []
        }
    },
    // Allow widget.js to be loaded cross-origin via iframe/script tag
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
    // Disable frameguard - frameAncestors directive handles this better for widgets
    frameguard: false,
    // HSTS only in production to avoid locking out localhost
    hsts: process.env.NODE_ENV === 'production' ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
    // Explicitly enable nosniff
    xContentTypeOptions: true,
    // Set Referrer Policy
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// 1. Mount webhook BEFORE global JSON parsing (required for signature verification)
const webhookRoutes = require('./routes/webhook');
app.use('/api/webhook', webhookRoutes);

// 2. Global JSON parser MUST come after webhook route
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(mongoSanitize()); // Strip MongoDB operator injection attempts

// Anti-Prototype Pollution Middleware - Drop on Sight validation
const sanitizePayload = (req, res, next) => {
  const containsPollution = (obj) => {
    if (!obj || typeof obj !== 'object') return false;

    // Only check direct properties explicitly passed in the request, ignoring inherited DNA
    const keys = Object.keys(obj);
    for (const key of keys) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return true;
      }
      if (typeof obj[key] === 'object' && containsPollution(obj[key])) {
        return true;
      }
    }
    return false;
  };

  if (containsPollution(req.body) || containsPollution(req.query) || containsPollution(req.params)) {
    console.warn('[SECURITY] Prototype pollution attempt blocked.');
    return res.status(400).json({ error: 'Invalid payload structure.' });
  }

  next();
};

app.use(sanitizePayload);

// 1. Global API Limiter - 15 minutes, 100 requests per IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per IP per window
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false
});

// Apply rate limiting
app.use('/api', globalLimiter);

// Strict CORS for dashboard routes only (auth, chatbot management, config)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');
const strictCors = cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
});

app.use('/api/config', strictCors);

// Seed demo chatbot on startup
const seedDemoChatbot = async () => {
  try {
    const demoExists = await Chatbot.findOne({ widgetId: 'demo-widget' });
    if (!demoExists) {
      const demoBot = new Chatbot({
        userId: 'demo',
        websiteUrl: 'chatwidget.com',
        scrapedContent: [
          `I can help answer questions about our platform and its features. For detailed pricing information, please visit our pricing page.`
        ],
        widgetId: 'demo-widget',
        isActive: true,
        conversationCount: 0,
        createdAt: new Date()
      });
      await demoBot.save();
      console.log('✅ Demo chatbot seeded with widgetId: demo-widget');
    } else {
      console.log('✅ Demo chatbot already exists');
    }
  } catch (error) {
    console.error('❌ Error seeding demo chatbot:', error.message);
  }
};

connectDB().then(() => {
  seedDemoChatbot();
});

// Routes
app.use('/api/chatbot', require('./routes/chatbot')); // CORS handled per-route inside router
app.use('/api/admin', require('./routes/admin'));

// Config route - returns Clerk and app URLs to frontend
app.get('/api/config', (req, res) => {
  const referer = req.headers.referer || req.headers.origin || '';

  // Anti-reconnaissance: Only serve config to our own domain
  if (!referer.includes('ultramora.com') && !referer.includes('localhost') && !referer.includes('127.0.0.1')) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.json({
    clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    clerkSignInUrl: process.env.CLERK_SIGN_IN_URL,
    clerkSignUpUrl: process.env.CLERK_SIGN_UP_URL,
    appUrl: process.env.APP_URL
  });
});

// Serve static files with clean URLs (no .html extension required)
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders: (res, path) => {
    // Add basic cache control and sniff protection to static assets
    res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
}));

// Serve admin.html at /admin route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Landing page
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ SERVER STARTED - Port ${PORT}`);
});