// Booking configuration functions
let currentQuestions = [];

function toggleBookingSwitch() {
  const toggle = document.getElementById('enableBookingToggle');
  if (toggle) toggle.classList.toggle('active');
  if (typeof saveBookingConfig === 'function') saveBookingConfig();
}

function renderBookingQuestions() {
  const container = document.getElementById('bookingQuestionsList');
  if (!container) return;
  container.innerHTML = '';
  if (currentQuestions.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px; font-size: 13px; border: 1px dashed var(--border-light); border-radius: 8px;">No booking questions set. Click "Add Question" below to create your funnel.</div>';
    return;
  }
  currentQuestions.forEach((question, index) => {
    const questionDiv = document.createElement('div');
    questionDiv.style.cssText = 'display: flex; align-items: center; gap: 12px; margin-bottom: 12px; padding: 12px; background: var(--bg-main); border-radius: 8px; border: 1px solid var(--border-light);';
    questionDiv.innerHTML = `
      <span style="color: var(--text-muted); font-size: 14px; min-width: 30px;">${index + 1}.</span>
      <input type="text" value="${question}" class="dark-input" style="flex: 1;" onchange="updateQuestion(${index}, this.value)">
      <button onclick="saveBookingQuestionsToDB(this)" style="background: none; border: none; color: var(--success); cursor: pointer; padding: 8px; margin-right: 8px;">
        <i data-lucide="check-circle" style="width: 16px;"></i>
      </button>
      <button onclick="deleteQuestion(${index})" style="background: none; border: none; color: var(--danger); cursor: pointer; padding: 8px;">
        <i data-lucide="trash-2" style="width: 16px;"></i>
      </button>
    `;
    container.appendChild(questionDiv);
  });
  if (window.lucide) lucide.createIcons();
}

function updateQuestion(index, value) {
  if (value.trim()) {
    currentQuestions[index] = value.trim();
  }
}

function deleteQuestion(index) {
  currentQuestions.splice(index, 1);
  renderBookingQuestions();
  if (typeof saveBookingConfig === 'function') saveBookingConfig();
}

async function saveBookingQuestionsToDB(btnElement) {
  const originalHTML = btnElement.innerHTML;
  btnElement.innerHTML = '<span class="loading-spinner" style="width: 14px; height: 14px; border-color: var(--success); border-top-color: transparent;"></span>';
  btnElement.disabled = true;
  try {
    const token = await window.Clerk.session.getToken();
    const enableBookingToggle = document.getElementById('enableBookingToggle');
    const response = await fetch(`/api/chatbot/customization/${currentActiveBotId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        bookingQuestions: currentQuestions,
        enableBookingFlow: enableBookingToggle ? enableBookingToggle.classList.contains('active') : false
      })
    });
    if (response.ok && typeof showToast === 'function') showToast('Questions saved successfully!', 'success');
  } catch (error) { if (typeof showToast === 'function') showToast('Error saving questions', 'warning'); }
  finally { btnElement.innerHTML = originalHTML; btnElement.disabled = false; if (window.lucide) lucide.createIcons(); }
}

async function saveBookingConfig() {
  const token = await window.Clerk.session.getToken();
  const enableBookingToggle = document.getElementById('enableBookingToggle');
  const response = await fetch(`/api/chatbot/customization/${currentActiveBotId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ enableBookingFlow: enableBookingToggle ? enableBookingToggle.classList.contains('active') : false, bookingQuestions: currentQuestions })
  });
  return response.ok;
}

// Setup event listeners when DOM is ready
function initBookingEventListeners() {
  const addQuestionBtn = document.getElementById('addQuestionBtn');
  if (addQuestionBtn) addQuestionBtn?.addEventListener('click', () => {
    if (currentQuestions.length < 10) {
      currentQuestions.push('New question');
      renderBookingQuestions();
    } else if (typeof showToast === 'function') showToast('Maximum 10 questions allowed', 'warning');
  });

  const resetQuestionsBtn = document.getElementById('resetQuestionsBtn');
  if (resetQuestionsBtn) resetQuestionsBtn?.addEventListener('click', () => {
    if (confirm('Clear all booking questions?')) {
      currentQuestions = [];
      renderBookingQuestions();
      if (typeof saveBookingConfig === 'function') saveBookingConfig();
      if (typeof showToast === 'function') showToast('Questions cleared', 'success');
    }
  });

  const saveWhatsAppBtn = document.getElementById('saveWhatsAppBtn');
  if (saveWhatsAppBtn) saveWhatsAppBtn?.addEventListener('click', async () => {
    const btn = document.getElementById('saveWhatsAppBtn');
    const msg = document.getElementById('whatsappMsg');
    const whatsappNumberInput = document.getElementById('whatsappNumberInput');
    const whatsappNumber = whatsappNumberInput ? whatsappNumberInput.value.trim() : '';

    if (btn) {
      btn.innerHTML = '<span class="loading-spinner"></span> Saving...';
      btn.disabled = true;
    }
    if (msg) msg.style.display = 'none';

    try {
      const token = await window.Clerk.session.getToken();
      const response = await fetch(`/api/chatbot/customization/${currentActiveBotId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ whatsappNumber })
      });
      if (response.ok) {
        if (msg) {
          msg.textContent = 'WhatsApp number saved!';
          msg.style.color = 'var(--success)';
          msg.style.display = 'block';
        }
        if (typeof showToast === 'function') showToast('WhatsApp number updated', 'success');
      }
    } catch (error) {
      if (msg) {
        msg.textContent = 'Failed to save';
        msg.style.color = 'var(--danger)';
        msg.style.display = 'block';
      }
    } finally {
      if (btn) {
        btn.innerHTML = '<i data-lucide="save"></i> Save WhatsApp Number';
        btn.disabled = false;
      }
      if (window.lucide) lucide.createIcons();
    }
  });
}

// Run on load
document.addEventListener('DOMContentLoaded', initBookingEventListeners);
