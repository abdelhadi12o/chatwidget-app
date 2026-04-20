let currentQuestions = [];
function toggleBookingSwitch() {
  const toggle = document.getElementById('enableBookingToggle');
  toggle.classList.toggle('active');
  if (typeof saveBookingConfig === 'function') saveBookingConfig();
}
function renderBookingQuestions() {
  const container = document.getElementById('bookingQuestionsList');
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
const response = await fetch(`/api/chatbot/customization/${currentActiveBotId}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({
    bookingQuestions: currentQuestions,
    enableBookingFlow: document.getElementById('enableBookingToggle').classList.contains('active')
  })
});
if (response.ok) showToast('Questions saved successfully!', 'success');
  } catch (error) { showToast('Error saving questions', 'warning'); }
  finally { btnElement.innerHTML = originalHTML; btnElement.disabled = false; if (window.lucide) lucide.createIcons(); }
}
document.getElementById('addQuestionBtn')?.addEventListener('click', () => {
  if (currentQuestions.length < 10) {
currentQuestions.push('New question');
renderBookingQuestions();
  } else showToast('Maximum 10 questions allowed', 'warning');
});
document.getElementById('resetQuestionsBtn')?.addEventListener('click', () => {
  if (confirm('Clear all booking questions?')) {
currentQuestions = [];
renderBookingQuestions();
if (typeof saveBookingConfig === 'function') saveBookingConfig();
showToast('Questions cleared', 'success');
  }
});
document.getElementById('saveWhatsAppBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('saveWhatsAppBtn');
  const msg = document.getElementById('whatsappMsg');
  const whatsappNumber = document.getElementById('whatsappNumberInput').value.trim();
  btn.innerHTML = '<span class="loading-spinner"></span> Saving...';
  btn.disabled = true;
  msg.style.display = 'none';
  try {
const token = await window.Clerk.session.getToken();
const response = await fetch(`/api/chatbot/customization/${currentActiveBotId}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({ whatsappNumber })
});
if (response.ok) {
  msg.textContent = '✅ WhatsApp number saved!'; msg.style.color = 'var(--success)'; msg.style.display = 'block'; showToast('WhatsApp number updated', 'success');
}
  } catch (error) { msg.textContent = '❌ Failed to save'; msg.style.color = 'var(--danger)'; msg.style.display = 'block'; }
  finally { btn.innerHTML = '<i data-lucide="save"></i> Save WhatsApp Number'; btn.disabled = false; if (window.lucide) lucide.createIcons(); }
});
async function saveBookingConfig() {
  const token = await window.Clerk.session.getToken();
  const enableBooking = document.getElementById('enableBookingToggle').classList.contains('active');
  const response = await fetch(`/api/chatbot/customization/${currentActiveBotId}`, {
method: 'PATCH',
headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
body: JSON.stringify({ enableBookingFlow: enableBooking, bookingQuestions: currentQuestions })
  });
  return response.ok;
}
</script>