require('dotenv').config(); // This loads your .env file
const mongoose = require('mongoose');

// Grab the exact variable you just checked
const uri = process.env.MONGO_URI; 

async function fix() {
  if (!uri) {
    console.error('❌ Error: Could not find MONGO_URI in your .env file!');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log('Connected to MongoDB...');
    
    // Nuke the users collection to clear the ghost index
    await mongoose.connection.collection('users').drop();
    
    console.log('✅ Users collection dropped successfully! The ghost index is DEAD.');
    process.exit(0);
  } catch (err) {
    if (err.code === 26) {
      console.log('✅ Collection already does not exist or was dropped. You are good to go!');
      process.exit(0);
    }
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}
fix();
