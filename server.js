require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./database');
const Chatbot = require('./models/Chatbot');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

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
app.use('/api/auth', require('./routes/auth'));
app.use('/api/chatbot', require('./routes/chatbot'));

// Serve static files
app.use(express.static('public'));

// Landing page
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});