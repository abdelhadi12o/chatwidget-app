class AIWidget {
  constructor(widgetId) {
    this.widgetId = widgetId;
    this.isOpen = false;
    this.messages = [];
    this.isTyping = false;
    this.messageCount = 0;
    this.leadCaptured = false;
    this.leadFormShown = false;

    this.init();
  }

  init() {
    this.createElements();
    this.bindEvents();
    this.animateBounce();
  }

  createElements() {
    this.container = document.createElement('div');
    this.container.className = 'ai-widget-container';
    this.container.innerHTML = `
      <div class="ai-widget-bubble">
        <span class="ai-widget-icon">💬</span>
        <span class="ai-widget-badge">
          <span class="ai-widget-notification-dot"></span>
          Chat
        </span>
      </div>
      <div class="ai-widget-chat">
        <div class="ai-widget-header">
          <div class="ai-widget-status">
            <span class="ai-widget-status-dot"></span>
            <span class="ai-widget-title">AI Assistant</span>
            <span class="ai-widget-online">Online</span>
          </div>
          <button class="ai-widget-close">×</button>
        </div>
        <div class="ai-widget-messages"></div>
        <div class="ai-widget-input">
          <input type="text" class="ai-widget-input-field" placeholder="Type a message..." />
          <button class="ai-widget-send">
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);

    this.bubble = this.container.querySelector('.ai-widget-bubble');
    this.chat = this.container.querySelector('.ai-widget-chat');
    this.messagesContainer = this.container.querySelector('.ai-widget-messages');
    this.inputField = this.container.querySelector('.ai-widget-input-field');
    this.sendBtn = this.container.querySelector('.ai-widget-send');
    this.closeBtn = this.container.querySelector('.ai-widget-close');
    this.notificationDot = this.container.querySelector('.ai-widget-notification-dot');

    this.chat.style.display = 'none';
  }

  bindEvents() {
    this.bubble.addEventListener('click', () => this.toggleChat());
    this.closeBtn.addEventListener('click', () => this.closeChat());
    this.sendBtn.addEventListener('click', () => this.sendMessage());
    this.inputField.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.sendMessage();
      }
    });

    // Close chat when clicking outside
    document.addEventListener('click', (e) => {
      if (this.isOpen && !this.container.contains(e.target)) {
        this.closeChat();
      }
    });
  }

  toggleChat() {
    if (this.isOpen) {
      this.closeChat();
    } else {
      this.openChat();
    }
  }

  openChat() {
    this.isOpen = true;
    this.bubble.style.display = 'none';
    this.chat.style.display = 'block';
    this.chat.style.animation = 'slideUp 0.3s ease-out';
    this.inputField.focus();

    // Show welcome message
    if (this.messages.length === 0) {
      let welcomeMessage;
      if (this.widgetId === 'demo-widget') {
        welcomeMessage = "👋 Hi! I'm the ChatWidget AI. Ask me anything about our product — pricing, how it works, or getting started!";
      } else {
        welcomeMessage = "Hi! I'm your AI assistant. How can I help you today?";
      }
      this.addMessage(welcomeMessage, 'ai');
    }
  }

  closeChat() {
    this.isOpen = false;
    this.chat.style.animation = 'slideDown 0.3s ease-out';
    this.chat.style.display = 'none';
    this.bubble.style.display = 'block';
    this.inputField.value = '';
  }

  sendMessage() {
    const message = this.inputField.value.trim();

    if (!message) return;

    this.addMessage(message, 'user');
    this.inputField.value = '';
    this.showTypingIndicator();

    this.sendToServer(message);
  }

  addMessage(content, sender) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `ai-widget-message ${sender}-message`;

    const avatar = sender === 'user' ? '👤' : '🤖';
    const text = content.replace(/\n/g, '<br>');

    messageDiv.innerHTML = `
      <span class="ai-widget-avatar">${avatar}</span>
      <div class="ai-widget-message-content">${text}</div>
    `;

    this.messagesContainer.appendChild(messageDiv);
    this.scrollToBottom();

    this.messages.push({ content, sender });

    // Remove old messages if too many
    if (this.messages.length > 50) {
      const firstMessage = this.messagesContainer.firstChild;
      if (firstMessage) {
        firstMessage.remove();
      }
    }
  }

  showTypingIndicator() {
    this.addMessage('...', 'ai');
    this.isTyping = true;
    this.typingMessage = this.messagesContainer.lastChild;
  }

  removeTypingIndicator() {
    if (this.typingMessage && this.typingMessage.parentNode) {
      this.typingMessage.remove();
    }
    this.isTyping = false;
  }

  scrollToBottom() {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  async sendToServer(message) {
    try {
      const response = await fetch(`/api/chatbot/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          widgetId: this.widgetId,
          message: message
        })
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      const data = await response.json();

      if (this.isTyping) {
        this.removeTypingIndicator();
      }

      this.addMessage(data.answer, 'ai');

      this.messageCount++;
      if (this.messageCount === 2 && !this.leadCaptured && !this.leadFormShown) {
        setTimeout(() => this.showLeadForm(), 1000);
        this.leadFormShown = true;
      }

    } catch (error) {
      console.error('Error:', error);
      if (this.isTyping) {
        this.removeTypingIndicator();
      }
      this.addMessage('Sorry, I couldn\'t process your message.', 'ai');
    }
  }

  animateBounce() {
    this.bubble.style.animation = 'bounce 2s infinite';
    setTimeout(() => {
      this.bubble.style.animation = '';
    }, 6000);
  }

  showLeadForm() {
    const formDiv = document.createElement('div');
    formDiv.className = 'ai-widget-lead-form';
    formDiv.innerHTML = `
      <p class="ai-lead-text">👋 Want us to follow up with you? Leave your details — no pressure!</p>
      <input type="text" id="ai-lead-name" placeholder="Your name" class="ai-lead-input" />
      <input type="email" id="ai-lead-email" placeholder="Email address (optional)" class="ai-lead-input" />
      <input type="text" id="ai-lead-whatsapp" placeholder="WhatsApp number" class="ai-lead-input" />
      <div class="ai-lead-buttons">
        <button class="ai-lead-submit">Send 📲</button>
        <button class="ai-lead-skip">Skip →</button>
      </div>
      <p class="ai-lead-msg" style="display:none"></p>
    `;
    this.messagesContainer.appendChild(formDiv);
    this.scrollToBottom();

    formDiv.querySelector('.ai-lead-submit').addEventListener('click', () => this.submitLead(formDiv));
    formDiv.querySelector('.ai-lead-skip').addEventListener('click', () => {
      formDiv.remove();
      this.leadCaptured = true;
    });
  }

  async submitLead(formDiv) {
    const name = formDiv.querySelector('#ai-lead-name').value.trim();
    const email = formDiv.querySelector('#ai-lead-email').value.trim();
    const whatsapp = formDiv.querySelector('#ai-lead-whatsapp').value.trim();
    const msg = formDiv.querySelector('.ai-lead-msg');

    if (!name || !whatsapp) {
      msg.textContent = 'Please fill in both fields.';
      msg.style.display = 'block';
      msg.style.color = '#ef4444';
      return;
    }

    try {
      await fetch('/api/chatbot/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          widgetId: this.widgetId,
          name,
          whatsapp,
          email,
          question: this.messages.length > 0 ? this.messages[0].content : ''
        })
      });

      formDiv.innerHTML = '<p style="text-align:center; padding: 16px; color: #10b981; font-weight: 600;">✅ Thank you! We will contact you soon.</p>';
      this.leadCaptured = true;
    } catch (err) {
      msg.textContent = 'Something went wrong. Try again.';
      msg.style.display = 'block';
      msg.style.color = '#ef4444';
    }
  }
}

// Load widget when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWidget);
} else {
  initWidget();
}

async function initWidget() {
  const widgetId = document.currentScript.getAttribute('data-widget-id') || 'default_widget';

  // Fetch widget settings
  try {
    const response = await fetch(`/api/chatbot/settings/${widgetId}`);
    if (response.ok) {
      const settings = await response.json();
      applyCustomization(settings.customization);
    }
  } catch (error) {
    console.log('Failed to fetch widget settings:', error.message);
  }

  new AIWidget(widgetId);
  addWidgetStyles();
}

function applyCustomization(customization) {
  // Apply customization settings to existing elements
  const bubble = document.querySelector('.ai-widget-bubble');
  const header = document.querySelector('.ai-widget-header');
  const input = document.querySelector('.ai-widget-input');
  const sendBtn = document.querySelector('.ai-widget-send');

  if (bubble && customization.bubbleColor) {
    bubble.style.background = customization.bubbleColor;
  }

  if (header && customization.bubbleColor) {
    header.style.background = customization.bubbleColor;
  }

  if (input && customization.bubbleColor) {
    input.style.borderTopColor = customization.bubbleColor;
    input.style.background = `linear-gradient(135deg, ${customization.bubbleColor}, ${adjustColor(customization.bubbleColor, 20)})`;
  }

  if (sendBtn && customization.bubbleColor) {
    sendBtn.style.background = customization.bubbleColor;
  }

  // Update welcome message if available
  if (customization.welcomeMessage) {
    const existingWidget = document.querySelector('.ai-widget-container');
    if (existingWidget) {
      const inputField = existingWidget.querySelector('.ai-widget-input-field');
      if (inputField) {
        inputField.setAttribute('placeholder', customization.welcomeMessage);
      }
    }
  }

  // Update position if specified
  if (customization.position) {
    const container = document.querySelector('.ai-widget-container');
    if (container) {
      const positions = {
        'bottom-right': 'bottom: 20px; right: 20px;',
        'bottom-left': 'bottom: 20px; left: 20px;',
        'top-right': 'top: 20px; right: 20px;',
        'top-left': 'top: 20px; left: 20px;'
      };
      container.setAttribute('style', positions[customization.position] || 'bottom: 20px; right: 20px;');
    }
  }
}

function adjustColor(color, percent) {
  // Simple color adjustment function
  if (!color.startsWith('#')) return color;

  const num = parseInt(color.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = (num >> 8 & 0x00FF) + amt;
  const B = (num & 0x0000FF) + amt;

  return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
    (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
    (B < 255 ? B < 1 ? 0 : B : 255))
    .toString(16)
    .slice(1);
}

function addWidgetStyles() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes bounce {
      0%, 20%, 50%, 80%, 100% {
        transform: translateY(0);
      }
      40% {
        transform: translateY(-10px);
      }
      60% {
        transform: translateY(-5px);
      }
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes slideDown {
      from {
        opacity: 1;
        transform: translateY(0);
      }
      to {
        opacity: 0;
        transform: translateY(20px);
      }
    }

    .ai-widget-container {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 999999;
    }

    .ai-widget-bubble {
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: white;
      padding: 18px;
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 10px 25px rgba(99, 102, 241, 0.3);
      transition: all 0.3s ease;
      width: 60px;
      height: 60px;
      font-size: 20px;
      position: relative;
    }

    .ai-widget-bubble:hover {
      transform: scale(1.05);
      box-shadow: 0 15px 35px rgba(99, 102, 241, 0.4);
    }

    .ai-widget-notification-dot {
      position: absolute;
      top: 3px;
      right: 3px;
      width: 8px;
      height: 8px;
      background: #ef4444;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0% {
        opacity: 1;
      }
      50% {
        opacity: 0.5;
      }
      100% {
        opacity: 1;
      }
    }

    .ai-widget-chat {
      display: none;
      width: 370px;
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      animation: slideUp 0.3s ease-out;
    }

    .ai-widget-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 16px;
      border-bottom: 1px solid #e5e7eb;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      border-radius: 16px 16px 0 0;
    }

    .ai-widget-status {
      display: flex;
      align-items: center;
      gap: 8px;
      color: white;
    }

    .ai-widget-status-dot {
      width: 8px;
      height: 8px;
      background: #10b981;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }

    .ai-widget-title {
      font-weight: 600;
      font-size: 16px;
      color: white;
    }

    .ai-widget-online {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.8);
      font-weight: 500;
    }

    .ai-widget-close {
      background: none;
      border: none;
      font-size: 24px;
      color: white;
      cursor: pointer;
      padding: 4px;
      opacity: 0.8;
      transition: opacity 0.2s;
    }

    .ai-widget-close:hover {
      opacity: 1;
    }

    .ai-widget-messages {
      height: 300px;
      overflow-y: auto;
      padding: 16px;
      background: white;
    }

    .ai-widget-message {
      margin-bottom: 12px;
      display: flex;
      gap: 8px;
    }

    .ai-widget-avatar {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      flex-shrink: 0;
    }

    .ai-widget-message-content {
      flex: 1;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.5;
      max-width: 70%;
      word-wrap: break-word;
    }

    .user-message .ai-widget-avatar {
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: white;
    }

    .user-message .ai-widget-message-content {
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: white;
      border-radius: 12px 4px 12px 12px;
    }

    .ai-message .ai-widget-avatar {
      background: #6366f1;
      color: white;
    }

    .ai-message .ai-widget-message-content {
      background: #f3f4f6;
      color: #1e1b4b;
      border-radius: 4px 12px 12px 12px;
    }

    .ai-widget-input {
      display: flex;
      padding: 16px;
      border-top: 1px solid #e5e7eb;
      background: #f8f7ff;
    }

    .ai-widget-input-field {
      flex: 1;
      border: 1px solid #d1d5db;
      border-radius: 24px;
      padding: 10px 16px;
      font-size: 14px;
      outline: none;
      margin-right: 12px;
      background: white;
      max-width: calc(100% - 60px);
    }

    .ai-widget-input-field:focus {
      border-color: #6366f1;
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.1);
    }

    .ai-widget-send {
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: white;
      border: none;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s;
    }

    .ai-widget-send:hover {
      transform: scale(1.05);
    }

    .ai-widget-send:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }

    /* Mobile responsive */
    @media (max-width: 480px) {
      .ai-widget-container {
        bottom: 0;
        right: 0;
        left: 0;
        z-index: 1000;
      }

      .ai-widget-chat {
        width: 100%;
        height: 100vh;
        border-radius: 0;
      }

      .ai-widget-bubble {
        display: none;
      }

      .ai-widget-messages {
        height: calc(100vh - 200px);
      }
    }

    .ai-widget-lead-form {
      background: #f5f3ff;
      border: 1.5px solid #6366f1;
      border-radius: 12px;
      padding: 16px;
      margin: 8px 0;
    }

    .ai-lead-text {
      font-size: 13px;
      color: #4b5563;
      margin-bottom: 10px;
      line-height: 1.5;
    }

    .ai-lead-input {
      width: 100%;
      padding: 10px 14px;
      border: 1.5px solid #d1d5db;
      border-radius: 8px;
      font-size: 13px;
      margin-bottom: 8px;
      outline: none;
      font-family: inherit;
    }

    .ai-lead-input:focus {
      border-color: #6366f1;
    }

    .ai-lead-buttons {
      display: flex;
      gap: 8px;
      margin-top: 4px;
    }

    .ai-lead-submit {
      flex: 1;
      padding: 10px;
      background: #6366f1;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }

    .ai-lead-skip {
      padding: 10px 16px;
      background: transparent;
      color: #6b7280;
      border: 1.5px solid #d1d5db;
      border-radius: 8px;
      font-size: 13px;
      cursor: pointer;
    }

    .ai-lead-msg {
      font-size: 12px;
      margin-top: 6px;
    }
  `;

  document.head.appendChild(style);
}