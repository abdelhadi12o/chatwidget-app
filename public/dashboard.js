// Initialize standard icons
if (window.lucide) { lucide.createIcons(); }

// --- AUTHENTICATION & GLOBAL VARS ---
let token = localStorage.getItem('token');
let user = {};
try { user = JSON.parse(localStorage.getItem('user') || '{}'); } catch(e) {}

async function getToken() {
  try {
    if (window.Clerk && window.Clerk.session) {
      const fresh = await window.Clerk.session.getToken();
      if (fresh) { token = fresh; localStorage.setItem('token', fresh); }
    }
  } catch(e) {}
  return token;
}

/**
 * FEATURE FLAG SYSTEM
 * Check if current user has access to a specific feature.
 * Features are stored in Clerk user publicMetadata.features array.
 *
 * TO ENABLE FEATURES FOR YOURSELF (Admin Setup):
 * 1. Go to https://dashboard.clerk.com/
 * 2. Select your application
 * 3. Go to "Users" in the left sidebar
 * 4. Find and click on your user profile
 * 5. Scroll to "Public Metadata" section
 * 6. Click "Edit" and add: {"features": ["beta_tester", "ai_brain"]}
 * 7. Save changes - the feature will immediately be available on next page load
 *
 * @param {string} featureName - The feature to check for (e.g., 'beta_tester', 'ai_brain')
 * @returns {boolean} - True if user has the feature, false otherwise
 */
function hasFeature(featureName) {
  try {
    if (window.Clerk?.user?.publicMetadata?.features) {
      return window.Clerk.user.publicMetadata.features.includes(featureName);
    }
  } catch (e) {
    console.error('Error checking feature flag:', e);
  }
  return false;
}

async function initClerk() {
  return new Promise((resolve) => {
    if (window.Clerk) { resolve(); return; }
    const interval = setInterval(() => {
      if (window.Clerk) { clearInterval(interval); resolve(); }
    }, 100);
    setTimeout(() => { clearInterval(interval); resolve(); }, 5000);
  });
}

window.addEventListener('load', async function() {
  try {
    await initClerk();
    if (window.Clerk) {
      await window.Clerk.load();
      if (!window.Clerk.user) {
        window.location.href = '/';
        return;
      }
      const freshToken = await window.Clerk.session.getToken();
      token = freshToken;
      localStorage.setItem('token', freshToken);
      localStorage.setItem('user', JSON.stringify({
        name: window.Clerk.user.fullName || window.Clerk.user.primaryEmailAddress?.emailAddress,
        email: window.Clerk.user.primaryEmailAddress?.emailAddress
      }));
      user = JSON.parse(localStorage.getItem('user') || '{}');

      // Populate account inputs immediately on login
      if (document.getElementById('accountName')) document.getElementById('accountName').value = user.name || '';
      if (document.getElementById('accountEmail')) document.getElementById('accountEmail').value = user.email || '';

    } else {
      if (!token) { window.location.href = '/'; return; }
    }
  } catch(e) {
    console.error('Clerk load failed:', e);
    if (!token) { window.location.href = '/'; return; }
  }
  initializeDashboard();
});

let widgetId = '';
let chatbotData = null;
let sessionHistory = [];
let currentLeadsData = [];

// --- TAB SWITCHING LOGIC ---
function switchTab(tabId, element) {
  // NEW: Ensure the main settings view is visible and the grid is hidden
  const botListView = document.getElementById('botListView');
  const botCreationView = document.getElementById('botCreationView');
  const activeBotSettingsView = document.getElementById('activeBotSettingsView');

  if (botListView) botListView.style.display = 'none';
  if (botCreationView) botCreationView.style.display = 'none';
  if (activeBotSettingsView) activeBotSettingsView.style.display = 'block';

  document.querySelectorAll('div[id^="tab-"]').forEach(tab => tab.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));

  const targetTab = document.getElementById(tabId);
  if (targetTab) targetTab.classList.remove('hidden');

  if (element) {
    element.classList.add('active');
  } else {
    const navLink = Array.from(document.querySelectorAll('.nav-item')).find(el => el.getAttribute('onclick')?.includes(tabId));
    if (navLink) navLink.classList.add('active');
  }

  const sidebar = document.getElementById('dashboardSidebar');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  if (sidebar) sidebar.classList.remove('mobile-open');
  if (sidebarOverlay) sidebarOverlay.classList.remove('active');
  document.body.style.overflow = '';
  localStorage.setItem('activeTab', tabId);
  if (window.lucide) window.lucide.createIcons();
}

// Mobile Sidebar Toggle & Overlay Logic
function openMobileSidebar() {
  const sidebar = document.getElementById('dashboardSidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (sidebar) sidebar.classList.add('mobile-open');
  if (overlay) overlay.classList.add('active');
  document.body.style.overflow = 'hidden'; // Lock background scroll
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('dashboardSidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (sidebar) sidebar.classList.remove('mobile-open');
  if (overlay) overlay.classList.remove('active');
  document.body.style.overflow = ''; // Restore background scroll
}

// --- LOAD ACTIVE BOT DATA (called from view) ---
async function loadChatbot() {
  try {
    // Switch to settings view and show sidebar
    showView(viewSettings);
    const sidebar = document.getElementById('dashboardSidebar');
    if (sidebar) sidebar.style.display = 'flex';

    const response = await fetch('/api/chatbot/my-bot', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    // 1. IF NO CHATBOT (404) -> go back to list
    if (response.status === 404) {
      initializeDashboard(); // Reset to list/create depending on bots
      return;
    }

    chatbotData = await response.json();
    widgetId = chatbotData.widgetId;

    // Restore tab (overview by default)
    const savedTab = localStorage.getItem('activeTab') || 'tab-overview';
    switchTab(savedTab, null);

    // Populate Dashboard Overview
    const configWebsite = document.getElementById('configWebsite');
    const metricConversations = document.getElementById('metric-conversations');
    const configDate = document.getElementById('configDate');

    if (configWebsite) configWebsite.textContent = chatbotData.websiteUrl;
    if (metricConversations) metricConversations.textContent = chatbotData.conversationCount || 0;
    if (configDate) configDate.textContent = new Date(chatbotData.createdAt).toLocaleDateString();

    // Calculate Knowledge Chunks robustly
    let chunks = 0;

    if (chatbotData.chunkCount) {
      chunks = chatbotData.chunkCount;
    } else if (chatbotData.scrapedContent) {
      // Check for totalChunks from your backend!
      if (chatbotData.scrapedContent.totalChunks) {
        chunks = chatbotData.scrapedContent.totalChunks;
      } else if (Array.isArray(chatbotData.scrapedContent)) {
        chunks = chatbotData.scrapedContent.length;
      } else if (typeof chatbotData.scrapedContent === 'string') {
        chunks = chatbotData.scrapedContent.split('\n').filter(line => line.trim().length > 20).length;
        if (chunks === 0) chunks = 1;
      }
    }

    // Add manual text chunks to the total
    if (chatbotData.customKnowledge && typeof chatbotData.customKnowledge === 'string') {
       chunks += chatbotData.customKnowledge.split('\n\n').filter(Boolean).length;
    }

    // Show the final calculated number
    const configChunks = document.getElementById('configChunks');
    if (configChunks) configChunks.textContent = chunks;

    // Status Toggles
    setupStatusToggle(chatbotData.isActive);

    // Populate Appearance
    if (chatbotData.customization) {
      const brandColor = document.getElementById('brandColor');
      const botName = document.getElementById('botName');
      const welcomeMessage = document.getElementById('welcomeMessage');
      const suggestedQuestions = document.getElementById('suggestedQuestions');

      if (brandColor) brandColor.value = chatbotData.customization.brandColor || '#06b6d4';
      if (botName) botName.value = chatbotData.customization.botName || '';
      if (welcomeMessage) welcomeMessage.value = chatbotData.customization.welcomeMessage || '';
      if (suggestedQuestions) suggestedQuestions.value = (chatbotData.customization.suggestedQuestions || []).join('\n');
    }

    // Populate Leads (limit to most recent 50)
    if (chatbotData.leads) {
      currentLeadsData = chatbotData.leads.slice(-50).reverse();
      renderLeads(currentLeadsData);
    }

    // Populate Conversation History
    if (chatbotData.conversations) {
      sessionHistory = chatbotData.conversations;
      renderSessionHistory(sessionHistory);
    }

    // Setup Delete Button
    const deleteBotBtn = document.getElementById('deleteBotBtn');
    const deleteConfirmModal = document.getElementById('deleteConfirmModal');
    if (deleteBotBtn && deleteConfirmModal) {
      deleteBotBtn.onclick = () => { deleteConfirmModal.style.display = 'flex'; };
    }

    // Setup API Key Generation Button
    const generateApiKeyBtn = document.getElementById('generateApiKeyBtn');
    const apiKeyGenerateModal = document.getElementById('apiKeyGenerateModal');
    if (generateApiKeyBtn && apiKeyGenerateModal) {
      generateApiKeyBtn.onclick = () => { apiKeyGenerateModal.style.display = 'flex'; };
    }

    // Setup WhatsApp Configuration
    const whatsappNumberInput = document.getElementById('whatsappNumberInput');
    if (whatsappNumberInput && chatbotData.whatsappNumber) {
      whatsappNumberInput.value = chatbotData.whatsappNumber;
    }

    // Setup Booking Configuration
    if (chatbotData.enableBookingFlow !== undefined) {
      const toggle = document.getElementById('enableBookingToggle');
      if (toggle) {
        if (chatbotData.enableBookingFlow) {
          toggle.classList.add('active');
        } else {
          toggle.classList.remove('active');
        }
      }
    }

    if (chatbotData.bookingQuestions) {
      currentQuestions = chatbotData.bookingQuestions;
      renderBookingQuestions();
    }

  } catch (error) {
    console.error('Error loading chatbot:', error);
    showToast('Failed to load chatbot data', 'warning');
  }
}

function setupStatusToggle(isActive) {
  const toggle = document.getElementById('statusToggle');
  const statusText = document.getElementById('statusText');

  if (!toggle || !statusText) return;

  if (isActive) {
    toggle.classList.add('active');
    statusText.textContent = 'Active';
    statusText.style.color = 'var(--success)';
  } else {
    toggle.classList.remove('active');
    statusText.textContent = 'Paused';
    statusText.style.color = 'var(--text-muted)';
  }

  toggle.onclick = async () => {
    const newStatus = !toggle.classList.contains('active');
    try {
      const response = await fetch(`/api/chatbot/status/${widgetId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: newStatus })
      });

      if (response.ok) {
        toggle.classList.toggle('active');
        statusText.textContent = newStatus ? 'Active' : 'Paused';
        statusText.style.color = newStatus ? 'var(--success)' : 'var(--text-muted)';
        showToast(`Bot is now ${newStatus ? 'active' : 'paused'}`, 'success');
      }
    } catch (error) {
      showToast('Failed to update status', 'warning');
    }
  };
}

function renderLeads(leads) {
  const tbody = document.getElementById('leadsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (leads.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No leads captured yet</td></tr>';
    return;
  }

  leads.forEach(lead => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${lead.name || 'N/A'}</td>
      <td>${lead.email || 'N/A'}</td>
      <td>${lead.phone || 'N/A'}</td>
      <td>${new Date(lead.createdAt).toLocaleDateString()}</td>
    `;
    tbody.appendChild(row);
  });
}

function renderSessionHistory(sessions) {
  const container = document.getElementById('sessionsList');
  if (!container) return;
  container.innerHTML = '';

  if (sessions.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">No conversations yet</div>';
    return;
  }

  sessions.forEach((session, index) => {
    const sessionEl = document.createElement('div');
    sessionEl.className = 'session-item';
    sessionEl.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span style="font-weight: 500;">Session #${sessions.length - index}</span>
        <span style="font-size: 12px; color: var(--text-muted);">${new Date(session.createdAt).toLocaleString()}</span>
      </div>
      <div style="font-size: 13px; color: var(--text-muted);">
        ${session.messages.length} messages · ${session.leadCaptured ? 'Lead captured' : 'No lead'}
      </div>
    `;
    sessionEl.onclick = () => showSessionDetail(session);
    container.appendChild(sessionEl);
  });
}

function showSessionDetail(session) {
  const modal = document.getElementById('sessionDetailModal');
  const content = document.getElementById('sessionDetailContent');

  if (!modal || !content) return;

  content.innerHTML = session.messages.map(m => `
    <div style="margin-bottom: 12px; ${m.role === 'user' ? 'text-align: right;' : ''}">
      <span style="display: inline-block; padding: 10px 14px; border-radius: 12px; max-width: 80%; font-size: 14px; ${m.role === 'user' ? 'background: var(--primary); color: white;' : 'background: var(--bg-panel); border: 1px solid var(--border-light);'}">
        ${m.content}
      </span>
    </div>
  `).join('');

  modal.style.display = 'flex';
}

// --- TOAST NOTIFICATION ---
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    padding: 12px 20px;
    background: ${type === 'success' ? 'var(--success)' : type === 'warning' ? 'var(--danger)' : 'var(--primary)'};
    color: white;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    z-index: 10000;
    animation: slideIn 0.3s ease;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// --- VIEW MANAGEMENT ---
const viewList = document.getElementById('botListView');
const viewCreate = document.getElementById('botCreationView');
const viewSettings = document.getElementById('activeBotSettingsView');

function showView(view) {
  if (viewList) viewList.style.display = 'none';
  if (viewCreate) viewCreate.style.display = 'none';
  if (viewSettings) viewSettings.style.display = 'none';
  if (view) view.style.display = 'block';
}

// --- INITIALIZATION ---
async function initializeDashboard() {
  try {
    const response = await fetch('/api/chatbot/my-bots', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const bots = await response.json();

    if (bots.length === 0) {
      // No bots - show creation flow
      showView(viewCreate);
      const sidebar = document.getElementById('dashboardSidebar');
      if (sidebar) sidebar.style.display = 'none';
      showStep(1);
    } else if (bots.length === 1) {
      // Single bot - go straight to settings
      currentActiveBotId = bots[0]._id;
      loadChatbot();
    } else {
      // Multiple bots - show list (simplified for now, goes to first)
      currentActiveBotId = bots[0]._id;
      loadChatbot();
    }
  } catch (error) {
    console.error('Failed to initialize dashboard:', error);
    showToast('Failed to load dashboard', 'warning');
  }
}

// --- CREATE BOT FLOW ---
let currentStep = 1;
let botWebsite = '';
let currentActiveBotId = null;

function showStep(step) {
  document.querySelectorAll('.creation-step').forEach(s => s.classList.remove('active'));
  const stepEl = document.getElementById(`step-${step}`);
  if (stepEl) stepEl.classList.add('active');
  currentStep = step;
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
  }
`;
document.head.appendChild(style);

// Setup all event listeners when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Mobile Sidebar Toggle
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const closeSidebarBtn = document.getElementById('closeSidebarBtn');
  const overlay = document.getElementById('sidebarOverlay');

  if (hamburgerBtn) hamburgerBtn?.addEventListener('click', openMobileSidebar);
  if (closeSidebarBtn) closeSidebarBtn?.addEventListener('click', closeMobileSidebar);
  if (overlay) overlay?.addEventListener('click', closeMobileSidebar);

  // Save Configuration
  const saveAppearanceBtn = document.getElementById('saveAppearanceBtn');
  if (saveAppearanceBtn) saveAppearanceBtn?.addEventListener('click', async () => {
    const btn = document.getElementById('saveAppearanceBtn');
    if (!btn) return;
    btn.innerHTML = '<span class="loading-spinner"></span> Saving...';
    btn.disabled = true;

    try {
      const brandColorEl = document.getElementById('brandColor');
      const botNameEl = document.getElementById('botName');
      const welcomeMessageEl = document.getElementById('welcomeMessage');
      const suggestedQuestionsEl = document.getElementById('suggestedQuestions');

      const customization = {
        brandColor: brandColorEl ? brandColorEl.value : '#06b6d4',
        botName: botNameEl ? botNameEl.value : '',
        welcomeMessage: welcomeMessageEl ? welcomeMessageEl.value : '',
        suggestedQuestions: suggestedQuestionsEl ? suggestedQuestionsEl.value.split('\n').filter(q => q.trim()) : []
      };

      const response = await fetch(`/api/chatbot/customization/${widgetId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(customization)
      });

      if (response.ok) {
        showToast('Appearance saved successfully!', 'success');
      } else {
        throw new Error('Failed to save');
      }
    } catch (error) {
      showToast('Failed to save appearance', 'warning');
    } finally {
      btn.innerHTML = '<i data-lucide="save"></i> Save Appearance';
      btn.disabled = false;
      if (window.lucide) lucide.createIcons();
    }
  });

  // Delete Bot
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  if (confirmDeleteBtn) confirmDeleteBtn?.addEventListener('click', async () => {
    try {
      const response = await fetch(`/api/chatbot/${widgetId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const deleteConfirmModal = document.getElementById('deleteConfirmModal');
        if (deleteConfirmModal) deleteConfirmModal.style.display = 'none';
        showToast('Bot deleted successfully', 'success');
        initializeDashboard();
      } else {
        throw new Error('Failed to delete');
      }
    } catch (error) {
      showToast('Failed to delete bot', 'warning');
    }
  });

  // Generate API Key
  const confirmGenerateKeyBtn = document.getElementById('confirmGenerateKeyBtn');
  if (confirmGenerateKeyBtn) confirmGenerateKeyBtn?.addEventListener('click', async () => {
    try {
      const response = await fetch(`/api/chatbot/api-key/${widgetId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const data = await response.json();

      if (response.ok) {
        const apiKeyGenerateModal = document.getElementById('apiKeyGenerateModal');
        const generatedApiKeyDisplay = document.getElementById('generatedApiKeyDisplay');
        const apiKeyDisplayModal = document.getElementById('apiKeyDisplayModal');

        if (apiKeyGenerateModal) apiKeyGenerateModal.style.display = 'none';
        if (generatedApiKeyDisplay) generatedApiKeyDisplay.textContent = data.apiKey;
        if (apiKeyDisplayModal) apiKeyDisplayModal.style.display = 'flex';
        showToast('API key generated successfully', 'success');
      } else {
        throw new Error(data.error || 'Failed to generate key');
      }
    } catch (error) {
      showToast(error.message, 'warning');
    }
  });

  // Close modals
  document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
    if (btn) btn?.addEventListener('click', (e) => {
      const modal = e.target.closest('.modal');
      if (modal) modal.style.display = 'none';
    });
  });

  // Create Bot Flow
  const nextToStep2 = document.getElementById('nextToStep2');
  if (nextToStep2) nextToStep2?.addEventListener('click', () => {
    const websiteUrlEl = document.getElementById('websiteUrl');
    botWebsite = websiteUrlEl ? websiteUrlEl.value.trim() : '';
    if (!botWebsite) {
      showToast('Please enter a website URL', 'warning');
      return;
    }
    showStep(2);
  });

  const backToStep1 = document.getElementById('backToStep1');
  if (backToStep1) backToStep1?.addEventListener('click', () => showStep(1));

  const createBotBtn = document.getElementById('createBotBtn');
  if (createBotBtn) createBotBtn?.addEventListener('click', async () => {
    const btn = document.getElementById('createBotBtn');
    if (!btn) return;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="loading-spinner"></span> Creating...';
    btn.disabled = true;

    try {
      const response = await fetch('/api/chatbot/create', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteUrl: botWebsite })
      });

      const data = await response.json();

      if (response.ok) {
        widgetId = data.widgetId;
        currentActiveBotId = data.id;
        showToast('Bot created successfully!', 'success');
        loadChatbot();
      } else {
        throw new Error(data.error || 'Failed to create bot');
      }
    } catch (error) {
      showToast(error.message, 'warning');
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  });

  // Custom Knowledge
  const addKnowledgeBtn = document.getElementById('addKnowledgeBtn');
  if (addKnowledgeBtn) addKnowledgeBtn?.addEventListener('click', async () => {
    const customKnowledgeInput = document.getElementById('customKnowledgeInput');
    const content = customKnowledgeInput ? customKnowledgeInput.value.trim() : '';
    if (!content) {
      showToast('Please enter some content', 'warning');
      return;
    }

    const btn = document.getElementById('addKnowledgeBtn');
    if (!btn) return;
    btn.innerHTML = '<span class="loading-spinner" style="width: 14px; height: 14px;"></span> Adding...';
    btn.disabled = true;

    try {
      const response = await fetch(`/api/chatbot/knowledge/${currentActiveBotId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });

      if (response.ok) {
        if (customKnowledgeInput) customKnowledgeInput.value = '';
        showToast('Knowledge added successfully!', 'success');
        loadChatbot();
      } else {
        throw new Error('Failed to add knowledge');
      }
    } catch (error) {
      showToast(error.message, 'warning');
    } finally {
      btn.innerHTML = '<i data-lucide="plus"></i> Add Knowledge';
      btn.disabled = false;
      if (window.lucide) lucide.createIcons();
    }
  });
});
