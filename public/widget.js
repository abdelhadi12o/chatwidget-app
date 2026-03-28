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

    // Force launcher bubble to right side (bypass RTL conflicts)
    this.bubble.style.setProperty('left', 'auto', 'important');
    this.bubble.style.setProperty('right', '20px', 'important');
    this.bubble.style.setProperty('bottom', '24px', 'important');

    // Enforce hidden on creation
    this.chat.style.setProperty('display', 'none', 'important');
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
    this.container.classList.add('open');
    this.bubble.style.setProperty('display', 'none', 'important');
    this.chat.style.setProperty('display', 'flex', 'important');
    this.chat.style.animation = 'slideUp 0.3s ease-out';
    this.inputField.focus();

    // Show welcome message
    if (this.messages.length === 0) {
      const welcome = this.customWelcome || "👋 Hi! I'm your AI assistant. How can I help you today?";
      this.addMessage(welcome, 'ai');
    }
  }

  closeChat() {
    this.isOpen = false;
    this.container.classList.remove('open');
    this.chat.style.animation = 'slideDown 0.3s ease-out';
    this.chat.style.setProperty('display', 'none', 'important');
    this.bubble.style.setProperty('display', 'flex', 'important');
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
    let text = content.replace(/\n/g, '<br>');

    // 1. Convert Markdown links [Text](URL) into clickable styled links
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" style="color: #6366f1; text-decoration: underline; font-weight: 600;">$1</a>');

    // 2. Convert plain raw URLs (that aren't already part of an HTML tag) into clickable styled links
    // We use word-break to ensure long URLs don't break out of the chat bubble
    text = text.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" style="color: #6366f1; text-decoration: underline; font-weight: 600; word-break: break-all;">$2</a>');

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
      // Convert message history to the format expected by backend
      const history = this.messages.slice(-6).map(msg => ({
        role: msg.sender === 'user' ? 'user' : 'assistant',
        content: msg.content
      }));

      const response = await fetch(`https://chatwidget-app-production.up.railway.app/api/chatbot/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          widgetId: this.widgetId,
          message: message,
          history: history
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
      if (this.leadCaptureTiming > 0 && this.messageCount === this.leadCaptureTiming && !this.leadCaptured && !this.leadFormShown) {
        setTimeout(() => this.showLeadForm(), 1000);
        this.leadFormShown = true;
      }

    } catch (error) {
      console.error('Error:', error);
      if (this.isTyping) {
        this.removeTypingIndicator();
      }
      // Remove the user message from history on error
      if (this.messages.length > 0 && this.messages[this.messages.length - 1].sender === 'user') {
        this.messages.pop();
        // Also remove from UI if it was added
        const lastMessage = this.messagesContainer.lastChild;
        if (lastMessage) {
          lastMessage.remove();
        }
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
      await fetch('https://chatwidget-app-production.up.railway.app/api/chatbot/lead', {
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
  const scriptTag = document.currentScript || document.querySelector('script[data-widget-id]');
  if (!scriptTag) return console.error('ChatWidget: Missing script tag');

  const widgetId = scriptTag.getAttribute('data-widget-id');
  if (!widgetId) return console.error('ChatWidget: Missing widget ID');

  // 1. Initialize the widget FIRST so the DOM elements actually exist
  const widget = new AIWidget(widgetId);
  widget.leadCaptureTiming = 3; // Default
  addWidgetStyles();

  // 2. Fetch the customization settings from the server
  try {
    const response = await fetch(`https://chatwidget-app-production.up.railway.app/api/chatbot/settings/${widgetId}`);
    if (response.ok) {
      const settings = await response.json();
      if (settings.customization) {
        // Apply lead capture timing
        if (settings.customization.leadCaptureTiming !== undefined) {
          widget.leadCaptureTiming = settings.customization.leadCaptureTiming;
        }
        // Apply colors and text to the existing widget DOM
        applyCustomization(settings.customization, widget);
      }
    }
  } catch (error) {
    console.log('Failed to fetch widget settings:', error.message);
  }
}

function applyCustomization(customization, widget) {
  // Apply bot name
  if (customization.botName) {
    const titleEl = document.querySelector('.ai-widget-title');
    if (titleEl) titleEl.textContent = customization.botName;
  }

  // Store welcome message on widget instance for use in openChat
  if (customization.welcomeMessage) {
    widget.customWelcome = customization.welcomeMessage;
  }

  // Apply theme color via dynamic CSS for consistent styling
  if (customization.bubbleColor) {
    // Create a dynamic style block to override the CSS gradient classes safely
    const dynamicStyle = document.createElement('style');
    dynamicStyle.textContent = `
      .ai-widget-bubble, .ai-widget-header, .ai-widget-send, .user-message .ai-widget-avatar, .user-message .ai-widget-message-content, .ai-lead-submit {
        background: ${customization.bubbleColor} !important;
      }
      .ai-widget-input-field:focus {
        border-color: ${customization.bubbleColor} !important;
      }
      .ai-message .ai-widget-avatar {
        background: ${customization.bubbleColor} !important;
      }
    `;
    document.head.appendChild(dynamicStyle);
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
      z-index: 2147483647;
    }

    /* Mobile container positioning - bottom sheet */
    @media (max-width: 768px) {
      .ai-widget-container {
        bottom: 0 !important;
        right: 0 !important;
        left: 0 !important;
        margin: 0 !important;
      }
    }

    .ai-widget-bubble {
      position: fixed !important;
      bottom: 24px !important;
      right: 24px !important;
      left: auto !important;
      width: 60px !important;
      height: 60px !important;
      border-radius: 50% !important;
      z-index: 2147483646 !important;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15) !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;
      color: white !important;
      padding: 18px !important;
      transition: all 0.3s ease !important;
      font-size: 20px !important;
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
      position: fixed !important;
      bottom: 20px !important;
      right: 20px !important;
      width: 350px !important;
      height: 540px !important;
      max-height: 80vh !important;
      border-radius: 10px !important;
      background: white !important;
      box-shadow: 0 12px 40px rgba(0,0,0,0.15) !important;
      flex-direction: column !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      animation: slideUp 0.3s ease-out;
    }

    /* Open state - applied via inline style from JS */
    .ai-widget-chat.open {
      display: flex !important;
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
      flex: 1 1 auto !important;
      overflow-y: auto !important;
      display: flex !important;
      flex-direction: column !important;
      padding: 16px !important;
      background: #f8fafc !important;
      width: 100% !important;
      box-sizing: border-box !important;
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
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.5;
      max-width: 70%;
      white-space: pre-wrap !important;
      word-break: normal !important;
    }

    /* User messages - WhatsApp style (right aligned, avatar on right) */
    .user-message {
      align-self: flex-end !important;
      text-align: right !important;
      flex-direction: row-reverse !important;
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

    /* AI messages - WhatsApp style (left aligned, avatar on left) */
    .ai-message {
      align-self: flex-start !important;
      text-align: left !important;
      flex-direction: row !important;
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
    @media (max-width: 768px) {
      /* Closed bubble positioning on mobile */
      .ai-widget-bubble {
        bottom: 20px !important;
        right: 20px !important;
        left: auto !important;
        width: 54px !important;
        height: 54px !important;
        padding: 14px !important;
      }

      /* MOBILE BOTTOM SHEET STYLE */
      .ai-widget-container {
        bottom: 0 !important;
        right: 0 !important;
        left: 0 !important;
        margin: 0 !important;
      }

      .ai-widget-chat {
        width: 100vw !important;
        height: 85vh !important;
        bottom: 0 !important;
        right: 0 !important;
        left: 0 !important;
        border-radius: 20px 20px 0 0 !important;
        margin: 0 !important;
        max-height: none !important;
      }

      /* Messages area must expand and scroll */
      .ai-widget-messages {
        padding: 16px !important;
        background: #f8fafc !important;
      }

      /* Input area stays docked at bottom */
      .ai-widget-container.open .ai-widget-input {
        flex-shrink: 0 !important;
      }

      /* Ensure header and input have proper z-index */
      .ai-widget-container.open .ai-widget-header {
        position: relative !important;
        z-index: 10 !important;
      }
    }

    .ai-widget-lead-form {
      background: #ffffff !important;
      border: 1px solid #e5e7eb !important;
      border-radius: 12px !important;
      padding: 16px !important;
      margin: 12px 0 !important;
      box-shadow: 0 4px 12px rgba(0,0,0,0.06) !important;
      width: 100% !important;
      box-sizing: border-box !important;
      direction: ltr !important;
      text-align: left !important;
    }

    .ai-lead-text {
      font-size: 14px !important;
      color: #374151 !important;
      margin-bottom: 12px !important;
      line-height: 1.5 !important;
      font-weight: 500 !important;
    }

    .ai-lead-input {
      width: 100% !important;
      padding: 10px 12px !important;
      border: 1px solid #d1d5db !important;
      border-radius: 8px !important;
      font-size: 14px !important;
      margin-bottom: 10px !important;
      outline: none !important;
      font-family: inherit !important;
      background: #f9fafb !important;
      color: #1f2937 !important;
      box-sizing: border-box !important;
    }

    .ai-lead-input::placeholder {
      color: #9ca3af !important;
      opacity: 1 !important;
    }

    .ai-lead-input:focus {
      border-color: #6366f1 !important;
      background: #ffffff !important;
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.1) !important;
    }

    .ai-lead-buttons {
      display: flex !important;
      gap: 10px !important;
      margin-top: 6px !important;
    }

    .ai-lead-submit {
      flex: 1 !important;
      padding: 10px !important;
      background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;
      color: #ffffff !important;
      border: none !important;
      border-radius: 8px !important;
      font-size: 14px !important;
      font-weight: 600 !important;
      cursor: pointer !important;
      display: flex !important;
      justify-content: center !important;
      align-items: center !important;
      -webkit-text-fill-color: #ffffff !important;
    }

    .ai-lead-skip {
      padding: 10px 16px !important;
      background: transparent !important;
      color: #6b7280 !important;
      border: 1px solid #d1d5db !important;
      border-radius: 8px !important;
      font-size: 14px !important;
      font-weight: 500 !important;
      cursor: pointer !important;
    }

    .ai-lead-msg {
      font-size: 12px !important;
      margin-top: 6px !important;
    }

    /* ===== ISOLATION RULES ===== */
    /* 1. Force the widget to ignore Arabic Right-to-Left layout */
    .ai-widget-container {
      direction: ltr !important;
      text-align: left !important;
    }

    /* 2. Protect all elements inside the widget from host website sizing rules */
    .ai-widget-container * {
      box-sizing: border-box !important;
      line-height: normal !important;
    }

    /* 3. Remove orange/brand outline when typing - use our purple brand color */
    .ai-widget-input-field:focus {
      outline: none !important;
      border: 2px solid #6366f1 !important;
      box-shadow: none !important;
    }

    /* 4. Fix user/bot message bubble alignment */
    .ai-widget-message.user-message {
      margin-left: auto !important;
      text-align: right !important;
    }

    .ai-widget-message.ai-message {
      margin-right: auto !important;
      text-align: left !important;
    }
  `;

  document.head.appendChild(style);
}
