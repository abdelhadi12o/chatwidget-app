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
        <span class="ai-widget-icon"><svg width="24" height="24" fill="#ffffff" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg></span>
        <span class="ai-widget-notification-dot"></span>
      </div>
      <div class="ai-widget-chat">
        <div class="ai-widget-header">
          <div class="ai-widget-header-left">
            <div class="ai-widget-avatar-wrapper">
              <span class="ai-widget-header-avatar"><svg width="24" height="24" fill="#ffffff" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg></span>
            </div>
            <div class="ai-widget-status">
              <span class="ai-widget-status-dot"></span>
              <span class="ai-widget-title">AI Assistant</span>
              <span class="ai-widget-online">Online</span>
            </div>
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

    const avatarContent = sender === 'user'
      ? '👤'
      : (this.botLogo ? `<img src="${this.botLogo}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">` : '<svg width="16" height="16" fill="#ffffff" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>');

    let text = content.replace(/\n/g, '<br>');

    // 1. Convert Markdown links [Text](URL) into clickable styled links
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" style="color: #06b6d4; text-decoration: underline; font-weight: 600;">$1</a>');

    // 2. Convert plain raw URLs (that aren't already part of an HTML tag) into clickable styled links
    // We use word-break to ensure long URLs don't break out of the chat bubble
    text = text.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" style="color: #06b6d4; text-decoration: underline; font-weight: 600; word-break: break-all;">$2</a>');

    const purify = window.DOMPurify;
    messageDiv.innerHTML = purify
      ? purify.sanitize(`
      <span class="ai-widget-avatar">${avatarContent}</span>
      <div class="ai-widget-message-content" dir="auto">${text}</div>
    `)
      : `
      <span class="ai-widget-avatar">${avatarContent}</span>
      <div class="ai-widget-message-content" dir="auto">${text}</div>
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

      const response = await fetch(`https://ultramora.com/api/chatbot/chat`, {
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
      await fetch('https://ultramora.com/api/chatbot/lead', {
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

// Dynamically load DOMPurify from CDN for XSS sanitization
async function loadDOMPurify() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.2.4/purify.min.js';
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      if (window.DOMPurify) {
        resolve(window.DOMPurify);
      } else {
        reject(new Error('DOMPurify failed to load'));
      }
    };
    script.onerror = () => reject(new Error('Failed to load DOMPurify CDN'));
    document.head.appendChild(script);
  });
}

async function initWidget() {
  // 0. Load DOMPurify for XSS protection before rendering anything
  const DOMPurify = await loadDOMPurify();
  window.DOMPurify = DOMPurify;

  // 1. Find the script tag that loaded this file
  const scriptTag = document.currentScript || document.querySelector('script[src*="widget.js"]');
  if (!scriptTag) return console.error('ChatWidget: Missing script tag');

  // 2. Extract the ID — prefer data-chatbot-id, fall back to data-widget-id
  const widgetId = scriptTag.getAttribute('data-chatbot-id') || scriptTag.getAttribute('data-widget-id');
  if (!widgetId) return console.error('ChatWidget: Missing widget ID (look for data-chatbot-id in the embed script)');

  console.log('ChatWidget: Initializing for bot:', widgetId);

  let settings = null;

  // 3. Fetch settings BEFORE building the widget to prevent color flashing
  try {
    const response = await fetch(`https://ultramora.com/api/chatbot/settings/${widgetId}`);
    if (response.ok) {
      settings = await response.json();
    }
  } catch (error) {
    console.log('Failed to fetch widget settings:', error.message);
  }

  // 4. Now build the widget and apply styles synchronously so the browser paints it perfectly on the first frame
  const widget = new AIWidget(widgetId);
  widget.leadCaptureTiming = 3; // Default
  addWidgetStyles();

  // 5. Ensure maximum z-index so no website hides the widget
  const container = document.querySelector('.ai-widget-container');
  if (container) {
    container.style.cssText = 'position:fixed; z-index:2147483647; pointer-events:auto;';
  }

  if (settings && settings.customization) {
    if (settings.customization.leadCaptureTiming !== undefined) {
      widget.leadCaptureTiming = settings.customization.leadCaptureTiming;
    }
    applyCustomization(settings.customization, widget);
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

  // Apply theme color via CSS custom property for consistent styling
  if (customization.bubbleColor) {
    const container = document.querySelector('.ai-widget-container');
    if (container) {
      container.style.setProperty('--theme-color', customization.bubbleColor);
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
      const positionStyle = positions[customization.position] || 'bottom: 20px; right: 20px;';
      container.setAttribute('style', (container.getAttribute('style') || '') + '; ' + positionStyle);
    }
  }

  // Apply custom bot logo
  if (customization.botLogo) {
    widget.botLogo = customization.botLogo;
    const icon = document.querySelector('.ai-widget-header-avatar');
    if (icon) {
      const imgHTML = `<img src="${customization.botLogo}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; display: block;">`;
      icon.innerHTML = window.DOMPurify
        ? window.DOMPurify.sanitize(imgHTML, { ALLOWED_TAGS: ['img'], ALLOWED_ATTR: ['src', 'style'] })
        : imgHTML;
    }
  }

  // Add quick replies if configured
  if (customization.quickReplies && customization.quickReplies.length > 0) {
    const chat = document.querySelector('.ai-widget-chat');
    const input = document.querySelector('.ai-widget-input');
    if (chat && input) {
      const quickRepliesDiv = document.createElement('div');
      quickRepliesDiv.className = 'ai-quick-replies';

      customization.quickReplies.forEach(text => {
        const btn = document.createElement('button');
        btn.className = 'ai-quick-reply-btn';
        btn.textContent = text;
        btn.addEventListener('click', () => {
          widget.addMessage(text, 'user');
          widget.sendToServer(text);
          quickRepliesDiv.remove();
        });
        quickRepliesDiv.appendChild(btn);
      });

      chat.insertBefore(quickRepliesDiv, input);
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
      --theme-color: #06b6d4;
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

    .ai-widget-container {
      pointer-events: none !important;
    }
    .ai-widget-bubble,
    .ai-widget-chat {
      pointer-events: auto !important;
    }
    .ai-widget-bubble {
      position: fixed !important;
      bottom: 24px !important;
      right: 24px !important;
      left: auto !important;
      width: 60px !important;
      height: 60px !important;
      border-radius: 50% !important;
      z-index: 2147483647 !important;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15) !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      background: var(--theme-color, #06b6d4) !important;
      color: white !important;
      padding: 18px !important;
      transition: all 0.3s ease !important;
      font-size: 20px !important;
    }

    .ai-widget-bubble:hover {
      transform: scale(1.05);
      box-shadow: 0 15px 35px rgba(6, 182, 212, 0.4);
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
      border-radius: 16px !important;
      background: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      box-shadow: 0 10px 25px rgba(0,0,0,0.1) !important;
      flex-direction: column !important;
      overflow: hidden !important;
      padding: 0 !important;
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
      padding: 16px;
      margin: 0 !important;
      width: 100% !important;
      box-sizing: border-box !important;
      border-radius: 0 !important;
      border: none !important;
      background: var(--theme-color, #06b6d4) !important;
    }

    .ai-widget-close {
      margin-left: auto;
    }

    .ai-widget-avatar-wrapper {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: transparent;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      flex-shrink: 0;
    }

    .ai-widget-header-avatar {
      font-size: 18px;
      line-height: 1;
    }

    .ai-widget-header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .ai-widget-status {
      display: flex;
      align-items: center;
      gap: 8px;
      color: white;
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

    /* Scrollbar styling for light theme */
    .ai-widget-messages::-webkit-scrollbar {
      width: 6px;
    }
    .ai-widget-messages::-webkit-scrollbar-track {
      background: #f8fafc;
    }
    .ai-widget-messages::-webkit-scrollbar-thumb {
      background: #cbd5e1;
      border-radius: 3px;
    }
    .ai-widget-messages::-webkit-scrollbar-thumb:hover {
      background: #94a3b8;
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
      padding: 12px 16px;
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
      background: var(--theme-color, #06b6d4);
      color: white;
    }

    .user-message .ai-widget-message-content {
      background: var(--theme-color, #06b6d4);
      color: white;
      border-radius: 16px 4px 16px 16px;
    }

    /* AI messages - WhatsApp style (left aligned, avatar on left) */
    .ai-message {
      align-self: flex-start !important;
      text-align: left !important;
      flex-direction: row !important;
    }

    .ai-message .ai-widget-avatar {
      background: var(--theme-color, #06b6d4);
      color: white;
    }

    .ai-message .ai-widget-message-content {
      background: #f1f5f9 !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 4px 16px 16px 16px !important;
      color: #1f2937 !important;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05) !important;
    }

    .ai-widget-input {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 8px !important;
      padding: 12px 16px !important;
      border-top: 1px solid #e2e8f0 !important;
      background: #ffffff !important;
      flex-wrap: nowrap !important; /* Prevents button from being pushed down */
    }

    .ai-widget-input-field {
      flex: 1 1 auto !important;
      width: 100% !important;
      border: none !important;
      border-radius: 20px !important;
      padding: 10px 16px !important;
      font-size: 14px !important;
      color: #1f2937 !important;
      outline: none !important;
      margin: 0 !important;
      background: #f8fafc !important;
      box-shadow: none !important;
    }

    .ai-widget-input-field::placeholder {
      color: #94a3b8 !important;
    }

    .ai-widget-input-field:focus {
      outline: none !important;
      border: 2px solid var(--theme-color, #06b6d4) !important;
      box-shadow: none !important;
      background: #ffffff !important;
    }

    .ai-widget-send {
      flex-shrink: 0 !important; /* MAGIC BULLET: Refuses to be squished by the input */
      background: var(--theme-color, #06b6d4) !important;
      color: white !important;
      border: none !important;
      width: 36px !important;
      height: 36px !important;
      min-width: 36px !important; /* Forces it to stay visible */
      border-radius: 50% !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 0 !important;
      margin: 0 !important;
      transition: transform 0.2s !important;
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

      /* MOBILE FLOATING CARD STYLE */
      .ai-widget-container {
        bottom: 16px !important;
        right: 16px !important;
        left: 16px !important;
        margin: 0 !important;
      }

      .ai-widget-chat {
        width: calc(100vw - 32px) !important;
        height: 80vh !important;
        bottom: 16px !important;
        right: 16px !important;
        left: 16px !important;
        border-radius: 16px !important;
        margin: 0 !important;
        max-height: 85vh !important;
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
      border: 1px solid #e2e8f0 !important;
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
      background: #f8fafc !important;
      color: #1f2937 !important;
      box-sizing: border-box !important;
    }

    .ai-lead-input::placeholder {
      color: #94a3b8 !important;
      opacity: 1 !important;
    }

    .ai-lead-input:focus {
      border-color: var(--theme-color, #06b6d4) !important;
      background: #ffffff !important;
      box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.1) !important;
    }

    .ai-lead-buttons {
      display: flex !important;
      gap: 10px !important;
      margin-top: 6px !important;
    }

    .ai-lead-submit {
      flex: 1 !important;
      padding: 10px !important;
      background: linear-gradient(135deg, var(--theme-color, #06b6d4), #3b82f6) !important;
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

    /* 3. Remove orange/brand outline when typing - use our teal brand color */
    .ai-widget-input-field:focus {
      outline: none !important;
      border: 2px solid var(--theme-color, #06b6d4) !important;
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

    /* Force Desktop Positioning Above WhatsApp Widget */
    @media (min-width: 768px) {
      html body .ai-widget-bubble {
        bottom: 85px !important;
      }
      html body .ai-widget-chat {
        bottom: 160px !important;
      }
    }

    /* Quick Replies */
    .ai-quick-replies {
      display: flex !important;
      overflow-x: auto !important;
      padding: 10px 16px !important;
      gap: 8px !important;
      border-bottom: 1px solid #e2e8f0 !important;
      background: #f8fafc !important;
    }

    .ai-quick-reply-btn {
      flex-shrink: 0 !important;
      padding: 8px 12px !important;
      border: 1px solid var(--theme-color, #06b6d4) !important;
      border-radius: 20px !important;
      background: white !important;
      color: var(--theme-color, #06b6d4) !important;
      font-size: 13px !important;
      font-weight: 500 !important;
      cursor: pointer !important;
      transition: all 0.2s ease !important;
      white-space: nowrap !important;
    }

    .ai-quick-reply-btn:hover {
      background: var(--theme-color, #06b6d4) !important;
      color: white !important;
    }
  `;

  document.head.appendChild(style);
}
