const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function testDeleteChatbot() {
  console.log('=== Chatbot Delete Test ===\n');

  try {
    // Step 1: Register a test user
    console.log('1. Registering test user...');
    const registerRes = await axios.post(`${BASE_URL}/api/auth/register`, {
      name: 'Test User',
      email: `test${Date.now()}@example.com`,
      password: 'password123'
    });
    const token = registerRes.data.token;
    console.log('   Registered successfully. Token:', token.substring(0, 20) + '...');

    // Step 2: Create a chatbot
    console.log('\n2. Creating chatbot...');
    const createRes = await axios.post(`${BASE_URL}/api/chatbot/create`, {
      websiteUrl: 'https://example.com'
    }, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const widgetId = createRes.data.widgetId;
    console.log('   Chatbot created. Widget ID:', widgetId);

    // Step 3: Verify chatbot exists
    console.log('\n3. Verifying chatbot exists...');
    const myBotRes = await axios.get(`${BASE_URL}/api/chatbot/my-bot`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('   Chatbot found:', {
      id: myBotRes.data.widgetId,
      website: myBotRes.data.websiteUrl,
      isActive: myBotRes.data.isActive
    });

    // Step 4: Delete the chatbot
    console.log('\n4. Deleting chatbot...');
    const deleteRes = await axios.delete(`${BASE_URL}/api/chatbot/delete`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('   Delete response:', deleteRes.data);

    // Step 5: Verify deletion (should return 404)
    console.log('\n5. Verifying deletion...');
    try {
      await axios.get(`${BASE_URL}/api/chatbot/my-bot`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      console.log('   ❌ FAIL: Chatbot still exists after deletion');
      process.exit(1);
    } catch (err) {
      if (err.response && err.response.status === 404) {
        console.log('   ✅ PASS: Chatbot not found (404) - successfully deleted');
      } else {
        console.log('   ❌ FAIL: Unexpected error:', err.message);
        process.exit(1);
      }
    }

    // Step 6: Verify database state
    console.log('\n6. Checking database directly...');
    const db = require('./database');
    const chatbots = db.get('chatbots').value();
    const stillExists = chatbots.find(b => b.widgetId === widgetId);
    if (stillExists) {
      console.log('   ❌ FAIL: Chatbot still in database:', stillExists);
      process.exit(1);
    } else {
      console.log('   ✅ PASS: Chatbot removed from database');
    }

    console.log('\n✅ All tests passed!');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Test failed with error:');
    if (err.response) {
      console.error('   Status:', err.response.status);
      console.error('   Data:', err.response.data);
    } else {
      console.error('   Message:', err.message);
    }
    process.exit(1);
  }
}

testDeleteChatbot();
