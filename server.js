require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const connectDB = require('./database');
const Chatbot = require('./models/Chatbot');
const path = require('path');

const app = express();

// Middleware
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(mongoSanitize()); // Strip MongoDB operator injection attempts

// Global rate limiter for all API routes
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: "Too many requests from this IP, please try again later." }
});

// Stricter rate limiter for authentication endpoints (prevents brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per 15 minutes
  message: { error: "Too many authentication attempts, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting
app.use('/api', globalLimiter);
app.use('/api/auth', authLimiter);

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

app.use('/api/auth', strictCors);
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
          `ChatWidget is an AI chatbot builder for businesses. Paste your website URL and we train an AI on your content instantly. Customers get instant answers 24/7. Free plan: 1 chatbot, 50 messages/month, no credit card. Setup takes 3 minutes. No coding required. Works on any website with one line of code. Supports Arabic, French, English, Spanish, German. Go to /register.html to get started for free.`
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
app.use('/api/auth', strictCors, require('./routes/auth'));
app.use('/api/chatbot', require('./routes/chatbot')); // CORS handled per-route inside router
app.use('/api/admin', require('./routes/admin'));

// Config route - returns Clerk and app URLs to frontend
app.get('/api/config', (req, res) => {
  res.json({
    clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    clerkSignInUrl: process.env.CLERK_SIGN_IN_URL,
    clerkSignUpUrl: process.env.CLERK_SIGN_UP_URL,
    appUrl: process.env.APP_URL
  });
});

// Serve static files
app.use(express.static('public'));

// Serve admin.html at /admin route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Landing page
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});