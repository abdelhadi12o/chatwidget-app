const API_BASE_URL = 'https://ultramora.com';

const ultramoraEscapeHTML = (str) => {
  if (!str) return '';
  return str.replace(/[&<>'"]/g,
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag])
  );
};

const sanitizeImageUrl = (url) => {
  if (!url) return '';
  try {
    const parsed = new URL(url, window.location.origin);
    if (['http:', 'https:'].includes(parsed.protocol)) {
      // Escape the URL before returning it to prevent attribute breakout
      return ultramoraEscapeHTML(parsed.href);
    }
    if (parsed.protocol === 'data:' && parsed.pathname.startsWith('image/')) {
      return ultramoraEscapeHTML(url);
    }
    return '';
  } catch (e) {
    if (url.startsWith('/')) {
      return ultramoraEscapeHTML(url);
    }
    return '';
  }
};

const formatMessage = (text) => {
  if (!text) return '';
  // Use the uniquely named function here!
  let safeText = ultramoraEscapeHTML(text);

  safeText = safeText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  safeText = safeText.replace(/(^|\n)[\*\-]\s+(.*)/g, '$1• $2');

  return safeText;
};

class AIWidget {
  constructor(widgetId) {
    this.widgetId = widgetId;
    this.isOpen = false;
    this.messages = [];
    this.isTyping = false;
    this.messageCount = 0;
    this.leadCaptured = false;
    this.leadFormShown = false;
    this.isBookingMode = false;
    this.currentBookingStep = 0;
    this.bookingAnswers = [];
    this.bookingCompleted = false; // Track if booking was already done this session
    this.botConfig = {
      enableBookingFlow: false,
      bookingQuestions: [],
      whatsappNumber: ''
    };

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
      <div id="ultramora-master-dock">
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

    // Close chat when clicking outside (strict target check)
    document.addEventListener('click', (e) => {
      if (this.isOpen && !this.container.contains(e.target)) {
        // Only close if the click was actually on the document body/background
        // not on any interactive element inside the widget
        this.closeChat();
      }
    });

    // Prevent clicks inside the chat from closing it
    this.chat.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  toggleChat() {
    // Hide proactive bubble when user manually toggles chat
    this.hideProactiveBubble();
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

  initProactiveBubble() {
    if (!this.botConfig.proactiveMessage) return;
    if (this.botConfig.proactiveEnabled === false) return; // Skip if disabled

    // Create the bubble
    this.proactiveBubble = document.createElement('div');
    this.proactiveBubble.className = 'ultramora-proactive-wrapper';
    this.proactiveBubble.innerHTML = `
      <button class="ultramora-proactive-close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
      <p class="ultramora-proactive-text">${ultramoraEscapeHTML(this.botConfig.proactiveMessage)}</p>
    `;

    // Append to master dock (before the launcher bubble)
    const masterDock = this.container.querySelector('#ultramora-master-dock');
    if (masterDock) {
      const bubble = masterDock.querySelector('.ai-widget-bubble');
      if (bubble) {
        masterDock.insertBefore(this.proactiveBubble, bubble);
      } else {
        masterDock.appendChild(this.proactiveBubble);
      }
    }

    // Timing Logic
    const delayMs = (this.botConfig.proactiveDelay !== undefined ? this.botConfig.proactiveDelay : 3) * 1000;

    this.proactiveTimer = setTimeout(() => {
      // Only pop up if the chat window is closed
      if (!this.isOpen) {
        this.proactiveBubble.classList.add('visible');
      }
    }, delayMs);

    // Click Logic
    this.proactiveBubble.addEventListener('click', (e) => {
      // Stop propagation to prevent document click handler from closing the chat
      e.stopPropagation();

      // 1. If they clicked the 'X', just hide and stop here (do not open chat)
      if (e.target.closest('.ultramora-proactive-close')) {
        this.proactiveBubble.classList.remove('visible');
        return;
      }

      // 2. Hide the bubble when clicked
      this.proactiveBubble.classList.remove('visible');

      // 3. Otherwise, open the chat window!
      if (!this.isOpen) {
        // Call the class method that opens the chat (usually toggle() or toggleChat())
        if (typeof this.toggleChat === 'function') {
          this.toggleChat();
        } else if (typeof this.toggle === 'function') {
          this.toggle();
        }
      }
    });
  }

  hideProactiveBubble() {
    // Clear the timeout if still pending
    if (this.proactiveTimer) {
      clearTimeout(this.proactiveTimer);
      this.proactiveTimer = null;
    }

    // Hide the bubble if it exists
    if (this.proactiveBubble) {
      this.proactiveBubble.classList.remove('visible');
    }
  }

  sendMessage() {
    const message = this.inputField.value.trim();

    if (!message) return;

    // Booking Mode Intercept: Handle user's answers during booking funnel
    if (this.isBookingMode) {
        const lowerMsg = message.toLowerCase();

        // Check for cancel commands
        if (['cancel', 'stop', 'exit', 'quit', 'no', 'nevermind', 'never mind'].includes(lowerMsg)) {
            this.addMessage(message, 'user');
            this.inputField.value = '';
            this.isBookingMode = false;
            this.bookingAnswers = [];
            this.currentBookingStep = 0;
            setTimeout(() => {
                this.addMessage('No problem! Booking cancelled. How else can I help you today?', 'ai');
            }, 500);
            return;
        }

        this.addMessage(message, 'user');
        this.inputField.value = '';
        this.bookingAnswers.push({
            question: this.botConfig.bookingQuestions[this.currentBookingStep],
            answer: message
        });

        this.currentBookingStep++;

        if (this.currentBookingStep < this.botConfig.bookingQuestions.length) {
            // Ask the next question
            if (this.inputField) this.inputField.disabled = true;
            setTimeout(() => {
                this.addMessage(this.botConfig.bookingQuestions[this.currentBookingStep], 'ai');
                if (this.inputField) {
                    this.inputField.disabled = false;
                    this.inputField.focus();
                }
            }, 800);
        } else {
            // Funnel Complete! Generate WhatsApp Link
            this.isBookingMode = false;

            setTimeout(() => {
                let waMessage = "New Booking Request:\n\n";
                this.bookingAnswers.forEach(qa => {
                    waMessage += `*Q: ${qa.question}*\nA: ${qa.answer}\n\n`;
                });

                // Sanitize WhatsApp number - strictly allow only digits and plus sign
                const safeWhatsapp = (this.botConfig.whatsappNumber || '').replace(/[^0-9+]/g, '');

                // Validate phone number - must be at least 7 digits (basic sanity check for international numbers)
                if (!safeWhatsapp || safeWhatsapp.replace(/[^0-9]/g, '').length < 7) {
                    console.error('ChatWidget: Invalid WhatsApp configuration');
                    this.addMessage('Sorry, there was an error preparing your booking. Please contact support.', 'bot');
                    return;
                }

                const waUrl = `https://wa.me/${safeWhatsapp}?text=${encodeURIComponent(waMessage)}`;

            const completeHtml = `
                <div style="background: linear-gradient(145deg, #ffffff, #f8fafc); border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; margin-top: 8px; box-shadow: 0 10px 40px -10px rgba(0,0,0,0.1); width: 100%; box-sizing: border-box; text-align: center; font-family: system-ui, -apple-system, sans-serif;">
                    <div style="width: 48px; height: 48px; background: linear-gradient(135deg, #22c55e, #16a34a); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; box-shadow: 0 4px 12px rgba(34,197,94,0.3);">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
                    </div>
                    <h4 style="margin: 0 0 8px 0; color: #0f172a; font-size: 17px; font-weight: 700;">Booking Ready!</h4>
                    <p style="margin: 0 0 16px 0; color: #64748b; font-size: 13px; line-height: 1.5;">Your request is prepared. Click to send it via WhatsApp.</p>
                    <a href="${waUrl}" target="_blank" style="display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; background: linear-gradient(135deg, #25D366, #128C7E); color: #ffffff; padding: 14px 0; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 14px; box-sizing: border-box; box-shadow: 0 4px 15px rgba(37,211,102,0.4); transition: transform 0.2s, box-shadow 0.2s;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
                        Open WhatsApp
                    </a>
                </div>
            `;
                this.addMessage(completeHtml, 'bot', true); // true allows HTML rendering

                // Mark booking as completed for this session
                this.bookingCompleted = true;
            }, 1000);
        }
        return; // Stop here, do not fetch from backend
    }

    // Check if user already completed booking and is acknowledging it
    if (this.bookingCompleted) {
        const lowerMsg = message.toLowerCase();
        if (['done', 'ok', 'okay', 'great', 'thanks', 'thank you', 'perfect', 'awesome', 'got it'].some(word => lowerMsg.includes(word))) {
            setTimeout(() => {
                this.addMessage("Perfect! You're all set. If you haven't sent your booking via WhatsApp yet, tap the button above. Otherwise, is there anything else I can help you with?", 'ai');
            }, 500);
            return;
        }
    }

    this.addMessage(message, 'user');
    this.inputField.value = '';
    this.showTypingIndicator();

    this.sendToServer(message);
  }

  addMessage(content, sender, allowHtml = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `ai-widget-message ${sender}-message`;

    const avatarContent = sender === 'user'
      ? '👤'
      : (this.botLogo ? `<img src="${sanitizeImageUrl(this.botLogo)}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">` : '<svg width="16" height="16" fill="#ffffff" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>');

    let text;
    if (allowHtml) {
      // If HTML is allowed, use content as-is (for booking funnel completion)
      text = content;
    } else if (sender === 'ai') {
      // AI messages: use formatMessage for Markdown support (bold, bullets)
      // white-space: pre-wrap in CSS handles line breaks naturally
      text = formatMessage(content);

      // Convert Markdown links [Text](URL) into clickable styled links
      text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" style="color: #06b6d4; text-decoration: underline; font-weight: 600;">$1</a>');

      // Convert plain raw URLs (that aren't already part of an HTML tag) into clickable styled links
      text = text.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" style="color: #06b6d4; text-decoration: underline; font-weight: 600; word-break: break-all;">$2</a>');
    } else {
      // User messages: standard text processing
      text = content.replace(/\n/g, '<br>');

      // 1. Convert Markdown links [Text](URL) into clickable styled links
      text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" style="color: #06b6d4; text-decoration: underline; font-weight: 600;">$1</a>');

      // 2. Convert plain raw URLs (that aren't already part of an HTML tag) into clickable styled links
      text = text.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" style="color: #06b6d4; text-decoration: underline; font-weight: 600; word-break: break-all;">$2</a>');
    }

    const purify = window.DOMPurify;
    // When allowing HTML, still sanitize but allow safe tags like div, a, etc.
    const sanitizeConfig = allowHtml ? { ALLOWED_TAGS: ['div', 'a', 'span', 'br'], ALLOWED_ATTR: ['href', 'target', 'style', 'class'] } : {};
    messageDiv.innerHTML = purify
      ? purify.sanitize(`
      <span class="ai-widget-avatar">${avatarContent}</span>
      <div class="ai-widget-message-content" dir="auto">${text}</div>
    `, sanitizeConfig)
      : `
      <span class="ai-widget-avatar">${avatarContent}</span>
      <div class="ai-widget-message-content" dir="auto">${ultramoraEscapeHTML(content)}</div>
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

      const response = await fetch(`${API_BASE_URL}/api/chatbot/chat`, {
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
        if (response.status === 403) {
          const errorData = await response.json().catch(() => ({ message: 'This chatbot is currently unavailable.' }));
          // Show friendly message to website visitors instead of technical error
          throw new Error(errorData.message || 'This chatbot is currently unavailable.');
        }
        throw new Error('Failed to send message');
      }

      const data = await response.json();

      if (this.isTyping) {
        this.removeTypingIndicator();
      }

      // Check if user mentioned they already booked (from message history)
      const lastUserMsg = this.messages.filter(m => m.sender === 'user').pop()?.content?.toLowerCase() || '';
      const alreadyBookedPatterns = ['already booked', 'we just booked', 'we just book', 'already done', 'just finished', 'completed booking', 'done booking'];
      const userSaysAlreadyBooked = alreadyBookedPatterns.some(pattern => lastUserMsg.includes(pattern));

      // Intercept booking trigger from AI response
      let displayAnswer = data.answer;
      const hasBookingTrigger = displayAnswer.includes('[TRIGGER_BOOKING]');

      // Booking funnel check logic

      if (hasBookingTrigger) {
          displayAnswer = displayAnswer.replace(/\[TRIGGER_BOOKING\]/g, '').trim();
      }

      // 1. Show the normal AI message first
      if (displayAnswer) {
          this.addMessage(displayAnswer, 'ai');
      }

      // 2. If the trigger is there, AND the funnel is ON, AND there are questions -> Start Funnel
      // BUT skip if booking was already completed this session OR user says they already booked
      if (hasBookingTrigger && this.botConfig.enableBookingFlow === true && this.botConfig.bookingQuestions.length > 0) {

          if (this.bookingCompleted) {
              setTimeout(() => {
                  this.addMessage("You've already completed a booking request in this chat! ✓ Check the WhatsApp button above to send your booking, or let me know if you need help with something else.", 'ai');
              }, 800);
              return;
          }

          if (userSaysAlreadyBooked) {
              setTimeout(() => {
                  this.addMessage("It sounds like you've already submitted a booking request! Check above for the WhatsApp button to complete it, or let me know if you need help with something else.", 'ai');
              }, 800);
              return;
          }

          this.isBookingMode = true;
          this.currentBookingStep = 0;
          this.bookingAnswers = [];

          // Disable the input field briefly while typing
          if (this.inputField) this.inputField.disabled = true;

          setTimeout(() => {
              this.addMessage(this.botConfig.bookingQuestions[0], 'ai');
              if (this.inputField) this.inputField.disabled = false;
          }, 1000);

          return; // Stop normal execution
      }

      this.messageCount++;
      if (this.leadCaptureTiming > 0 && this.messageCount === this.leadCaptureTiming && !this.leadCaptured && !this.leadFormShown) {
        setTimeout(() => this.showLeadForm(), 1000);
        this.leadFormShown = true;
      }

    } catch (error) {
      console.error('ChatWidget: Message processing failed');
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
      // Show friendly message for limit errors vs generic errors
      const errorMessage = error.message?.includes('unavailable')
        ? 'This chatbot is currently unavailable. Please contact support or upgrade your plan to continue.'
        : 'Sorry, I couldn\'t process your message.';
      this.addMessage(errorMessage, 'ai');
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

    formDiv.querySelector('.ai-lead-submit').addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.submitLead(formDiv);
    });
    formDiv.querySelector('.ai-lead-skip').addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
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
      await fetch(`${API_BASE_URL}/api/chatbot/lead`, {
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

  let settings = null;

  // 3. Fetch settings BEFORE building the widget to prevent color flashing
  try {
    // Add timestamp to prevent caching
    const response = await fetch(`${API_BASE_URL}/api/chatbot/settings/${widgetId}?_t=${Date.now()}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    if (response.ok) {
      settings = await response.json();
    } else {
      console.error('ChatWidget: Failed to load settings');
    }
  } catch (error) {
    console.error('ChatWidget: Failed to load settings');
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
    // Load booking funnel config from settings
    widget.botConfig.enableBookingFlow = Boolean(settings.enableBookingFlow);
    widget.botConfig.bookingQuestions = settings.bookingQuestions || [];
    widget.botConfig.whatsappNumber = settings.whatsappNumber || '';
    widget.botConfig.proactiveMessage = settings.proactiveMessage || '👋 Hi there! Have any questions?';
    widget.botConfig.proactiveDelay = settings.proactiveDelay !== undefined ? settings.proactiveDelay : 3;
    widget.botConfig.proactiveEnabled = settings.proactiveEnabled !== undefined ? settings.proactiveEnabled : true;

    // Initialize proactive welcome bubble
    widget.initProactiveBubble();
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
      const imgHTML = `<img src="${sanitizeImageUrl(customization.botLogo)}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; display: block;">`;
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
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          widget.addMessage(text, 'user');
          widget.sendToServer(text);
          quickRepliesDiv.remove();
        });
        quickRepliesDiv.appendChild(btn);
      });

      chat.insertBefore(quickRepliesDiv, input);
    }
  }

  // Apply launcher image to replace bubble background/icon
  if (customization.launcherImage) {
    const bubble = document.querySelector('.ai-widget-bubble');
    if (bubble) {
      // Set background to transparent and remove padding
      bubble.style.setProperty('background', 'transparent', 'important');
      bubble.style.setProperty('padding', '0', 'important');
      bubble.style.setProperty('position', 'relative', 'important');

      // Hide the default icon
      const icon = bubble.querySelector('.ai-widget-icon');
      if (icon) icon.style.display = 'none';

      // Remove any existing launcher image
      const existingImg = bubble.querySelector('.ai-widget-launcher-img');
      if (existingImg) existingImg.remove();

      // Insert the launcher image
      const imgHTML = `<img src="${customization.launcherImage}" class="ai-widget-launcher-img" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; position: absolute; top: 0; left: 0; z-index: 1;">`;
      const imgElement = document.createElement('div');
      imgElement.innerHTML = window.DOMPurify
        ? window.DOMPurify.sanitize(imgHTML, { ALLOWED_TAGS: ['img'], ALLOWED_ATTR: ['src', 'style', 'class'] })
        : imgHTML;

      // Ensure notification dot stays on top
      const notificationDot = bubble.querySelector('.ai-widget-notification-dot');
      if (notificationDot) {
        notificationDot.style.setProperty('z-index', '2', 'important');
        notificationDot.style.setProperty('position', 'absolute', 'important');
        // Insert before the notification dot so dot stays on top
        bubble.insertBefore(imgElement.firstChild, notificationDot);
      } else {
        bubble.appendChild(imgElement.firstChild);
      }
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
      #ultramora-master-dock {
        bottom: 20px !important;
        right: 20px !important;
      }
    }

    .ai-widget-container {
      pointer-events: none !important;
    }
    #ultramora-master-dock {
      position: fixed !important;
      bottom: 20px !important;
      right: 20px !important;
      z-index: 2147483647 !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: flex-end !important;
      pointer-events: none !important;
      padding-bottom: 10px !important;
    }
    #ultramora-master-dock > * {
      pointer-events: auto !important;
    }

    .ai-widget-bubble {
      position: relative !important;
      margin: 0 !important;
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

    .ai-widget-bubble:has(.ai-widget-launcher-img) {
      position: relative !important;
      padding: 0 !important;
      background: transparent !important;
    }

    .ai-widget-launcher-img {
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      width: 100% !important;
      height: 100% !important;
      border-radius: 50% !important;
      object-fit: cover !important;
      z-index: 1 !important;
    }

    .ai-widget-bubble:hover {
      transform: scale(1.05);
      box-shadow: 0 15px 35px rgba(6, 182, 212, 0.4);
    }

    .ai-widget-notification-dot {
      position: absolute !important;
      top: 2px !important;
      right: 2px !important;
      width: 14px !important;
      height: 14px !important;
      background: #ef4444 !important;
      border-radius: 50% !important;
      z-index: 99 !important;
      animation: pulse 2s infinite !important;
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
        left: auto !important;
        width: 54px !important;
        height: 54px !important;
        padding: 14px !important;
      }

      .ai-widget-bubble:has(.ai-widget-launcher-img) {
        padding: 0 !important;
      }

      /* Master dock stays fixed in corner on mobile */
      #ultramora-master-dock {
        bottom: 20px !important;
        right: 20px !important;
        left: auto !important;
        width: auto !important;
        padding-bottom: 10px !important;
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
        bottom: 50px !important;
      }
      html body .ai-widget-bubble:has(.ai-widget-launcher-img) {
        position: relative !important;
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
      scrollbar-width: none !important; /* Firefox */
      -ms-overflow-style: none !important; /* IE and Edge */
    }

    .ai-quick-replies::-webkit-scrollbar {
      display: none !important; /* Chrome, Safari, Opera */
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

    /* Proactive Welcome Bubble */
    .ultramora-proactive-wrapper {
      position: relative !important;
      margin-bottom: 80px !important;
      right: 0 !important;
      bottom: 0 !important;
      background: white !important;
      border-radius: 12px !important;
      padding: 14px 40px 14px 16px !important;
      box-shadow: 0 10px 25px rgba(0,0,0,0.1) !important;
      border: 1px solid #e2e8f0 !important;
      max-width: 280px !important;
      width: max-content !important;
      z-index: 2147483647 !important;
      opacity: 0 !important;
      visibility: hidden !important;
      transform: translateY(10px) !important;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
      cursor: pointer !important;
      pointer-events: auto !important;
    }
    .ultramora-proactive-wrapper.visible {
      opacity: 1 !important;
      visibility: visible !important;
      transform: translateY(0) !important;
    }
    .ultramora-proactive-wrapper::after {
      content: '' !important;
      position: absolute !important;
      bottom: -6px !important;
      right: 22px !important;
      width: 12px !important;
      height: 12px !important;
      background: white !important;
      border-right: 1px solid #e2e8f0 !important;
      border-bottom: 1px solid #e2e8f0 !important;
      transform: rotate(45deg) !important;
    }
    .ultramora-proactive-text {
      font-family: sans-serif !important;
      font-size: 14px !important;
      color: #0f172a !important;
      margin: 0 !important;
      line-height: 1.4 !important;
      font-weight: 500 !important;
    }
    .ultramora-proactive-close {
      position: absolute !important;
      top: 10px !important;
      right: 8px !important;
      background: none !important;
      border: none !important;
      color: #94a3b8 !important;
      cursor: pointer !important;
      padding: 4px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      border-radius: 50% !important;
      transition: background 0.2s !important;
      pointer-events: auto !important;
    }
    .ultramora-proactive-close:hover {
      background: #f1f5f9 !important;
      color: #0f172a !important;
    }

    /* Mobile: proactive bubble stays pinned above launcher */
    @media (max-width: 767px) {
      .ultramora-proactive-wrapper {
        position: relative !important;
        margin-bottom: 28px !important;
        right: 0 !important;
        bottom: 0 !important;
      }
      .ultramora-proactive-wrapper::after {
        right: 22px !important;
      }
    }
  `;

  document.head.appendChild(style);
}
