require('dotenv').config();
const mongoose = require('mongoose');
const Chatbot = require('./models/Chatbot'); 

// Added family: 4 to force standard IPv4 routing
mongoose.connect(process.env.MONGO_URI, { 
  serverSelectionTimeoutMS: 10000,
  family: 4 
})
  .then(async () => {
    console.log('✅ Connected to MongoDB...');
    const result = await Chatbot.deleteMany({ userId: { $not: /^user_/ } });
    console.log(`🚀 Successfully deleted ${result.deletedCount} demo bots!`);
    process.exit(0);
  })
  .catch(err => {
    console.error('Database connection error:', err);
    process.exit(1);
  });
