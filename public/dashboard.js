// Security helper to prevent XSS attacks
    function escapeHTML(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

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

        const onClerkLoaded = () => { cleanup(); resolve(); };
        const onClerkFailed = () => { cleanup(); resolve(); };

        const cleanup = () => {
          window.removeEventListener('clerk-loaded', onClerkLoaded);
          window.removeEventListener('clerk-failed', onClerkFailed);
          clearInterval(interval);
        };

        window.addEventListener('clerk-loaded', onClerkLoaded);
        window.addEventListener('clerk-failed', onClerkFailed);

        const interval = setInterval(() => {
          if (window.Clerk) { cleanup(); resolve(); }
        }, 100);

        setTimeout(() => { cleanup(); resolve(); }, 10000);
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
      waitForClerkAndInit();
    });

    async function waitForClerkAndInit() {
      // Wait until the Clerk object exists AND is loaded
      if (window.Clerk) {
        try {
          await window.Clerk.load();
          initializeDashboard();
          return;
        } catch(e) {
          console.error('Clerk load failed:', e);
        }
      }
      // If Clerk not ready, check again in 100ms
      setTimeout(waitForClerkAndInit, 100);
    }

    let widgetId = '';
    let chatbotData = null;
    let sessionHistory = [];
    let currentLeadsData = [];

    // --- TAB SWITCHING LOGIC ---
    function switchTab(tabId, element) {
      // NEW: Ensure the main settings view is visible and the grid is hidden
      document.getElementById('botListView').style.display = 'none';
      document.getElementById('botCreationView').style.display = 'none';
      document.getElementById('activeBotSettingsView').style.display = 'block';

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

      document.getElementById('dashboardSidebar').classList.remove('mobile-open');
      document.getElementById('sidebarOverlay').classList.remove('active');
      document.body.style.overflow = '';
      localStorage.setItem('activeTab', tabId);
      if (window.lucide) window.lucide.createIcons();
    }

    // Mobile Sidebar Toggle & Overlay Logic
    const sidebar = document.getElementById('dashboardSidebar');
    const overlay = document.getElementById('sidebarOverlay');

    function openMobileSidebar() {
      sidebar.classList.add('mobile-open');
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden'; // Lock background scroll
    }

    function closeMobileSidebar() {
      sidebar.classList.remove('mobile-open');
      overlay.classList.remove('active');
      document.body.style.overflow = ''; // Restore background scroll
    }

    document.getElementById('hamburgerBtn').addEventListener('click', openMobileSidebar);
    document.getElementById('closeSidebarBtn').addEventListener('click', closeMobileSidebar);
    overlay.addEventListener('click', closeMobileSidebar);

    // --- LOAD ACTIVE BOT DATA (called from view) ---
    async function loadChatbot() {
      try {
        // Switch to settings view and show sidebar
        showView(viewSettings);
        document.getElementById('dashboardSidebar').style.display = 'flex';

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
        document.getElementById('configWebsite').textContent = chatbotData.websiteUrl;
        document.getElementById('metric-conversations').textContent = chatbotData.conversationCount || 0;
        document.getElementById('configDate').textContent = new Date(chatbotData.createdAt).toLocaleDateString();
        
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
        document.getElementById('configChunks').textContent = chunks;

        // Status Toggles
        setupStatusToggle(chatbotData.isActive);

        // Populate Appearance
        if (chatbotData.customization) {
          document.getElementById('customBotName').value = chatbotData.customization.botName || 'AI Assistant';
          document.getElementById('customWelcome').value = chatbotData.customization.welcomeMessage || "Hi! How can I help you?";
          document.getElementById('customColor').value = chatbotData.customization.bubbleColor || '#06b6d4';
          document.getElementById('customBookingLink').value = chatbotData.customization.bookingLink || '';
          document.getElementById('leadTimingSelect').value = chatbotData.customization.leadCaptureTiming ?? 3;
          
          const qrs = chatbotData.customization.quickReplies || [];
          document.getElementById('qr1').value = qrs[0] || '';
          document.getElementById('qr2').value = qrs[1] || '';
          document.getElementById('qr3').value = qrs[2] || '';

          if (chatbotData.customization.botLogo) {
            document.getElementById('logoPreview').src = chatbotData.customization.botLogo;
            document.getElementById('logoPreview').style.display = 'block';
            document.getElementById('botLogoBase64').value = chatbotData.customization.botLogo;
            document.getElementById('lp-avatar-fallback').style.display = 'none';
          }

          // Load launcher image
          if (chatbotData.customization.launcherImage) {
            document.getElementById('launcherImagePreview').src = chatbotData.customization.launcherImage;
            document.getElementById('launcherImagePreview').style.display = 'block';
            document.getElementById('launcherImageBase64').value = chatbotData.customization.launcherImage;
            document.getElementById('launcher-image-fallback').style.display = 'none';
          }
        }
        updateLivePreview();

        // Populate Integrations
        document.getElementById('integrationsApiKey').value = chatbotData.apiKey || 'cw_sk_' + widgetId;

        // Install Codes
        updateInstallCodes(widgetId);

        // Load specific data tabs
        renderKnowledgeList(chatbotData.customKnowledge || '', chatbotData.trainedFiles || []);
        loadLeads();

        // Populate Account Form
        document.getElementById('accountName').value = user.name || '';
        document.getElementById('accountEmail').value = user.email || '';

      } catch (err) {
        console.error('Failed to load dashboard:', err);
      }
    }

    // --- UI HELPERS ---
    function setupStatusToggle(isActive) {
      const toggle = document.getElementById('statusToggle');
      const text = document.getElementById('statusText');
      const dot = document.getElementById('headerStatusDot');
      const bigStatus = document.getElementById('bigSystemStatus');

      if (isActive) {
        toggle.classList.add('active');
        text.textContent = 'Active';
        if (dot) dot.style.background = 'var(--success)';
        if (dot) dot.style.boxShadow = '0 0 8px var(--success)';
        if (bigStatus) { bigStatus.textContent = 'Active'; bigStatus.style.color = 'var(--success)'; }
      } else {
        toggle.classList.remove('active');
        text.textContent = 'Inactive';
        if (dot) dot.style.background = '#64748b';
        if (dot) dot.style.boxShadow = 'none';
        if (bigStatus) { bigStatus.textContent = 'Inactive'; bigStatus.style.color = 'var(--danger)'; }
      }
    }

    document.getElementById('statusToggle').addEventListener('click', async () => {
      const toggle = document.getElementById('statusToggle');
      const isActive = !toggle.classList.contains('active');
      setupStatusToggle(isActive); // Optimistic UI update

      try {
        await fetch('/api/chatbot/update-status', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ isActive, widgetId })
        });
      } catch (err) {
        setupStatusToggle(!isActive); // Revert on failure
      }
    });

    // --- LIVE PREVIEW (APPEARANCE) ---
    function updateLivePreview() {
      const color = document.getElementById('customColor').value || '#06b6d4';
      const name = document.getElementById('customBotName').value || 'AI Assistant';
      const welcome = document.getElementById('customWelcome').value || 'Hi! How can I help you?';
      
      document.getElementById('lp-header').style.background = color;
      document.getElementById('lp-send').style.background = color;
      document.getElementById('lp-send-avatar').style.background = color;
      document.getElementById('lp-name').textContent = name;
      document.getElementById('lp-welcome').textContent = welcome;

      const qrs = [document.getElementById('qr1').value, document.getElementById('qr2').value, document.getElementById('qr3').value].filter(Boolean);
      const qrContainer = document.getElementById('lp-qrs');
      qrContainer.innerHTML = '';
      qrs.forEach(qr => {
        const btn = document.createElement('div');
        btn.textContent = qr;
        btn.style.border = `1px solid ${color}`;
        btn.style.color = color;
        btn.style.padding = '4px 12px';
        btn.style.borderRadius = '20px';
        btn.style.fontSize = '12px';
        btn.style.cursor = 'pointer';
        qrContainer.appendChild(btn);
      });
    }

    ['customColor', 'customBotName', 'customWelcome', 'qr1', 'qr2', 'qr3'].forEach(id => {
      document.getElementById(id).addEventListener('input', updateLivePreview);
    });

    document.getElementById('customLogoInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          document.getElementById('botLogoBase64').value = event.target.result;
          document.getElementById('logoPreview').src = event.target.result;
          document.getElementById('logoPreview').style.display = 'block';
          document.getElementById('lp-avatar-fallback').style.display = 'none';
          document.getElementById('lp-avatar-img').src = event.target.result;
          document.getElementById('lp-avatar-img').style.display = 'block';
          document.getElementById('lp-avatar-fallback-header').style.display = 'none';
        };
        reader.readAsDataURL(file);
      }
    });

    // Launcher Image Upload Handler
    document.getElementById('launcherImageInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          document.getElementById('launcherImageBase64').value = event.target.result;
          document.getElementById('launcherImagePreview').src = event.target.result;
          document.getElementById('launcherImagePreview').style.display = 'block';
          document.getElementById('launcher-image-fallback').style.display = 'none';
        };
        reader.readAsDataURL(file);
      }
    });

    document.getElementById('saveAppearanceBtn').addEventListener('click', async () => {
      const btn = document.getElementById('saveAppearanceBtn');
      btn.innerHTML = '<span class="loading-spinner"></span> Saving...';
      try {
        const freshToken = await window.Clerk.session.getToken();

        // Build payload - only include image fields if they have values (not empty strings)
        const payload = {
          botName: document.getElementById('customBotName').value,
          systemPrompt: document.getElementById('systemPromptInput').value,
          welcomeMessage: document.getElementById('customWelcome').value,
          bubbleColor: document.getElementById('customColor').value,
          bookingLink: document.getElementById('customBookingLink').value,
          quickReplies: [document.getElementById('qr1').value, document.getElementById('qr2').value, document.getElementById('qr3').value].filter(Boolean),
          proactiveMessage: document.getElementById('customProactive').value,
          proactiveDelay: parseInt(document.getElementById('customProactiveDelay').value) || 0,
          proactiveEnabled: document.getElementById('proactiveEnabled').checked
        };

        // Only include botLogo if it has a value (URL or base64 data)
        const botLogoValue = document.getElementById('botLogoBase64').value;
        if (botLogoValue) {
          payload.botLogo = botLogoValue;
        }

        // Only include launcherImage if it has a value (URL or base64 data)
        const launcherImageValue = document.getElementById('launcherImageBase64').value;
        if (launcherImageValue) {
          payload.launcherImage = launcherImageValue;
        }

        const response = await fetch(`/api/chatbot/customization/${currentActiveBotId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${freshToken}` },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to save customization');
        }
        showToast('Appearance settings saved successfully!', 'success');
      } catch (err) {
        showToast(err.message || 'Failed to save appearance settings', 'error');
      } finally {
        btn.textContent = 'Save Appearance';
      }
    });

    // --- LEADS LOGIC ---
    async function loadLeads() {
      try {
        const res = await fetch(`/api/chatbot/leads/${widgetId}`, { headers: { 'Authorization': `Bearer ${token}` }});
        if (res.ok) renderLeads(await res.json());
      } catch (e) {}
    }

    function renderLeads(leads) {
      currentLeadsData = leads;
      document.getElementById('metric-leads').textContent = leads.length || 0;
      const tbody = document.getElementById('leadsList');
      if (!leads || leads.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 40px; color: var(--text-muted);">No leads collected yet.</td></tr>`;
        return;
      }
      tbody.innerHTML = leads.map(l => `
        <tr>
          <td><div style="font-weight: 600;">${escapeHTML(l.name)}</div><div style="font-size: 12px; color: var(--text-muted);">${escapeHTML(l.email) || 'No email'}</div></td>
          <td><span class="badge-text" style="color: var(--success); border-color: var(--success); font-family: monospace;">${escapeHTML(l.whatsapp)}</span></td>
          <td><div style="font-size: 13px; color: var(--text-muted);">${new Date(l.createdAt).toLocaleDateString()}</div></td>
        </tr>
      `).join('');
    }

    document.getElementById('exportCsvBtn').addEventListener('click', () => {
      if (!currentLeadsData.length) return alert('No leads to export!');
      let csv = "data:text/csv;charset=utf-8,Name,WhatsApp,Email,Date\n";
      currentLeadsData.forEach(l => csv += `"${l.name}","${l.whatsapp}","${l.email}","${new Date(l.createdAt).toLocaleString()}"\n`);
      const link = document.createElement("a");
      link.setAttribute("href", encodeURI(csv));
      link.setAttribute("download", "leads.csv");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });

    // --- KNOWLEDGE BASE ---
    function renderKnowledgeList(textData, files) {
      const tbody = document.getElementById('knowledgeListBody');
      tbody.innerHTML = '';
      let hasData = false;

      if (files && files.length) {
        hasData = true;
        files.forEach((f, i) => tbody.innerHTML += `<tr><td>${escapeHTML(f.fileName)}</td><td><span class="badge-pdf">PDF</span></td><td style="color:var(--success);">✓ Trained</td><td style="text-align:right;"><button onclick="deleteKnowledge('file', ${i})" style="background:none; border:none; color:var(--danger); cursor:pointer;"><i data-lucide="trash-2" style="width:16px;"></i></button></td></tr>`);
      }
      if (textData) {
        hasData = true;
        textData.split('\n\n').filter(Boolean).forEach((t, i) => tbody.innerHTML += `<tr><td>${escapeHTML(t.substring(0, 50))}...</td><td><span class="badge-text">Text</span></td><td style="color:var(--success);">✓ Trained</td><td style="text-align:right;"><button onclick="deleteKnowledge('text', ${i})" style="background:none; border:none; color:var(--danger); cursor:pointer;"><i data-lucide="trash-2" style="width:16px;"></i></button></td></tr>`);
      }
      if (!hasData) tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 30px; color: var(--text-muted);">No custom knowledge added.</td></tr>`;
      if (window.lucide) window.lucide.createIcons();
    }

    // UPGRADED: Delete Knowledge
    window.deleteKnowledge = async function(type, index) {
      if (!confirm('Delete this knowledge source?')) return;
      try {
        const freshToken = await window.Clerk.session.getToken(); // FIX: Grab fresh token
        const res = await fetch(`/api/chatbot/knowledge/${type}/${index}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${freshToken}` },
            body: JSON.stringify({ widgetId })
        });
        if (res.ok) {
          const data = await res.json();
          chatbotData.customKnowledge = data.customKnowledge;
          chatbotData.trainedFiles = data.trainedFiles;
          renderKnowledgeList(data.customKnowledge, data.trainedFiles);
          showToast('Knowledge deleted successfully', 'success');
        } else {
            throw new Error('Failed to delete');
        }
      } catch (e) {
          showToast('Error deleting knowledge', 'danger');
      }
    }

    // UPGRADED: Train on Text Button
    document.getElementById('addTextBtn').addEventListener('click', async () => {
      const text = document.getElementById('newKnowledgeText').value.trim();
      if (!text) return showToast('Please enter some text first!', 'warning');

      const btn = document.getElementById('addTextBtn');
      const originalText = '<i data-lucide="plus"></i> Train on Text';

      btn.innerHTML = '<span class="loading-spinner"></span> Training...';
      btn.disabled = true;

      const newKnowledge = chatbotData.customKnowledge ? chatbotData.customKnowledge + '\n\n' + text : text;

      try {
        const freshToken = await window.Clerk.session.getToken(); // FIX: Grab fresh token
        const res = await fetch('/api/chatbot/knowledge', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${freshToken}` },
            body: JSON.stringify({ customKnowledge: newKnowledge, widgetId })
        });

        if (!res.ok) throw new Error('Failed to save knowledge');

        chatbotData.customKnowledge = newKnowledge;
        renderKnowledgeList(newKnowledge, chatbotData.trainedFiles);
        document.getElementById('newKnowledgeText').value = '';

        // Success Animation & Toast
        btn.style.background = 'var(--success)';
        btn.innerHTML = '<i data-lucide="check-circle"></i> Trained!';
        showToast('Text knowledge added successfully.', 'success');

      } catch (e) {
          console.error(e);
          showToast('Failed to save knowledge. Try again.', 'danger');
      } finally {
        setTimeout(() => {
            btn.style.background = '';
            btn.innerHTML = originalText;
            btn.disabled = false;
            if (window.lucide) window.lucide.createIcons();
        }, 2000);
      }
    });

    document.getElementById('pdfFileInput').addEventListener('change', (e) => {
      if(e.target.files[0]) document.getElementById('pdfFileName').textContent = e.target.files[0].name;
    });

    // UPGRADED: Upload PDF Button
    document.getElementById('uploadPdfBtn').addEventListener('click', async () => {
      const fileInput = document.getElementById('pdfFileInput');
      if (!fileInput.files[0]) return showToast('Please select a PDF file first', 'warning');

      const btn = document.getElementById('uploadPdfBtn');
      const originalText = '<i data-lucide="upload"></i> Upload File';

      btn.innerHTML = '<span class="loading-spinner"></span> Uploading...';
      btn.disabled = true;

      const fd = new FormData();
      fd.append('file', fileInput.files[0]);
      fd.append('widgetId', widgetId);

      try {
        const freshToken = await window.Clerk.session.getToken(); // FIX: Grab fresh token
        const res = await fetch('/api/chatbot/upload-pdf', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${freshToken}` },
            body: fd
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to upload PDF');

        if (!chatbotData.trainedFiles) chatbotData.trainedFiles = [];
        chatbotData.trainedFiles.push({ fileName: fileInput.files[0].name });
        renderKnowledgeList(chatbotData.customKnowledge, chatbotData.trainedFiles);

        fileInput.value = '';
        document.getElementById('pdfFileName').textContent = 'Click to upload PDF';

        // Success Animation & Toast
        btn.style.background = 'rgba(16, 185, 129, 0.1)';
        btn.style.color = 'var(--success)';
        btn.style.borderColor = 'var(--success)';
        btn.innerHTML = '<i data-lucide="check-circle"></i> Uploaded!';
        showToast('PDF Document trained successfully.', 'success');

      } catch (e) {
          console.error(e);
          showToast(e.message, 'danger');
      } finally {
        setTimeout(() => {
            btn.style.background = 'var(--bg-sidebar)';
            btn.style.color = 'white';
            btn.style.borderColor = 'var(--border-light)';
            btn.innerHTML = originalText;
            btn.disabled = false;
            if (window.lucide) window.lucide.createIcons();
        }, 2000);
      }
    });

    // --- TEST CHAT ---
    document.getElementById('sendTestBtn').addEventListener('click', async () => {
      const input = document.getElementById('testInput');
      const msg = input.value.trim();
      if (!msg) return;

      const chat = document.getElementById('testMessages');
      chat.innerHTML += `<div style="align-self: flex-end; background: var(--primary); color: white; padding: 10px 16px; border-radius: 16px 4px 16px 16px; font-size: 14px; max-width: 85%; margin-bottom: 12px;">${escapeHTML(msg)}</div>`;
      input.value = '';
      sessionHistory.push({ role: 'user', content: msg });
      chat.scrollTop = chat.scrollHeight;

      try {
        const res = await fetch('/api/chatbot/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ widgetId, message: msg, history: sessionHistory.slice(-6) })
        });

        const data = await res.json();

        // Failsafe: Catch backend blocks (like inactive bots) cleanly
        if (!res.ok) {
            chat.innerHTML += `<div style="align-self: flex-start; background: #fee2e2; border: 1px solid #ef4444; color: #991b1b; padding: 10px 16px; border-radius: 4px 16px 16px 16px; font-size: 14px; max-width: 85%; margin-bottom: 12px;">Error: ${escapeHTML(data.error) || 'Server failed to respond'}</div>`;
            chat.scrollTop = chat.scrollHeight;
            return;
        }

        // Success: Print the AI's response
        let displayAnswer = data.answer;
        if (displayAnswer.includes('[TRIGGER_BOOKING]')) {
            displayAnswer = displayAnswer.replace(/\\[TRIGGER_BOOKING\\]/g, '').trim();
            displayAnswer += '<br><br><span style="color: var(--primary); font-size: 12px; font-weight: 600;">⚡ [Booking Funnel Triggered! The live widget will take over here.]</span>';
        }
        chat.innerHTML += `<div style="align-self: flex-start; background: white; border: 1px solid var(--border); color: var(--bg-sidebar); padding: 10px 16px; border-radius: 4px 16px 16px 16px; font-size: 14px; max-width: 85%; margin-bottom: 12px;">${escapeHTML(displayAnswer)}</div>`;
        sessionHistory.push({ role: 'assistant', content: data.answer });
        chat.scrollTop = chat.scrollHeight;
      } catch (e) {
          // Failsafe: Catch network/internet crashes
          chat.innerHTML += `<div style="align-self: flex-start; background: #fee2e2; border: 1px solid #ef4444; color: #991b1b; padding: 10px 16px; border-radius: 4px 16px 16px 16px; font-size: 14px; max-width: 85%; margin-bottom: 12px;">Network Error: Could not reach the AI.</div>`;
      }
    });
    document.getElementById('testInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') document.getElementById('sendTestBtn').click(); });

    // --- INTEGRATIONS ---
    document.getElementById('toggleApiVisibility').addEventListener('click', () => {
      const input = document.getElementById('integrationsApiKey');
      const icon = document.querySelector('#toggleApiVisibility i');
      if (input.type === 'password') { input.type = 'text'; icon.setAttribute('data-lucide', 'eye-off'); } 
      else { input.type = 'password'; icon.setAttribute('data-lucide', 'eye'); }
      lucide.createIcons();
    });

    // --- CUSTOM KEY MODAL LOGIC ---
    document.getElementById('generateNewKeyBtn').addEventListener('click', () => {
      document.getElementById('confirmKeyModal').style.display = 'flex';
      if (window.lucide) window.lucide.createIcons();
    });

    document.getElementById('cancelKeyBtn').addEventListener('click', () => {
      document.getElementById('confirmKeyModal').style.display = 'none';
    });

    document.getElementById('confirmGenerateKeyBtn').addEventListener('click', () => {
      document.getElementById('integrationsApiKey').value = 'cw_sk_' + Math.random().toString(36).substr(2, 15);
      document.getElementById('confirmKeyModal').style.display = 'none';
      showToast('New key generated. Click "Save Key" to apply changes!', 'warning');
    });

    document.getElementById('saveIntegrationsBtn').addEventListener('click', async () => {
      const key = document.getElementById('integrationsApiKey').value;
      try {
        await fetch('/api/chatbot/api-key', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ apiKey: key, widgetId }) });
        const msg = document.getElementById('integrationMsg');
        msg.textContent = '✅ Key Saved'; msg.style.color = 'var(--success)'; msg.style.display = 'block';
        setTimeout(() => msg.style.display='none', 2000);
      } catch (e) {}
    });

    // Webhooks
    document.getElementById('configureWebhooksBtn').addEventListener('click', () => {
      document.getElementById('webhookInput').value = chatbotData?.webhookUrl || '';
      document.getElementById('webhookModal').style.display = 'flex';
    });
    document.getElementById('cancelWebhookBtn').addEventListener('click', () => document.getElementById('webhookModal').style.display = 'none');
    document.getElementById('saveWebhookModalBtn').addEventListener('click', async () => {
      const url = document.getElementById('webhookInput').value.trim();
      const btn = document.getElementById('saveWebhookModalBtn');
      btn.innerHTML = '<span class="loading-spinner"></span>';
      try {
        await fetch('/api/chatbot/webhook', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ webhookUrl: url, widgetId }) });
        if(chatbotData) chatbotData.webhookUrl = url;
        document.getElementById('webhookModal').style.display = 'none';
      } catch (e) {} finally { btn.textContent = 'Save Webhook'; }
    });

    // --- QUICK ACTIONS ---
    document.getElementById('retrainBtn').addEventListener('click', async () => {
      const btn = document.getElementById('retrainBtn');
      const originalText = '<i data-lucide="refresh-cw"></i> Sync Latest Data';
      btn.disabled = true;
      btn.innerHTML = '<span class="loading-spinner"></span> Syncing...';
      try {
        const freshToken = await window.Clerk.session.getToken();
        const response = await fetch('/api/chatbot/retrain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${freshToken}` },
          body: JSON.stringify({ widgetId })
        });
        // Bulletproof error handling
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch (e) { data = { error: text || 'Unknown server error' }; }
        if (!response.ok) throw new Error(data.error || 'Failed to sync knowledge base');
        showToast('Knowledge base synced!', 'success');
      } catch(err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
        if (window.lucide) window.lucide.createIcons();
      }
    });

    document.getElementById('deleteBtn').addEventListener('click', () => document.getElementById('deleteBotModal').style.display = 'flex');
    document.getElementById('cancelDeleteBtn').addEventListener('click', () => document.getElementById('deleteBotModal').style.display = 'none');
    document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
      try {
        const btn = document.getElementById('confirmDeleteBtn');
        btn.textContent = "Deleting...";

        const freshToken = await window.Clerk.session.getToken();

        // Include the exact bot ID in the URL!
        await fetch(`/api/chatbot/delete/${currentActiveBotId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${freshToken}` }
        });

        document.getElementById('deleteBotModal').style.display = 'none';
        localStorage.removeItem('activeTab');
        window.location.reload();
      } catch(e) {
          console.error("Delete failed:", e);
      }
    });

    // Strategy
    document.getElementById('saveTimingBtn').addEventListener('click', async () => {
      const val = document.getElementById('leadTimingSelect').value;
      try {
        const freshToken = await window.Clerk.session.getToken();
        await fetch(`/api/chatbot/customization/${currentActiveBotId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${freshToken}` },
          body: JSON.stringify({ leadCaptureTiming: parseInt(val) })
        });
        const msg = document.getElementById('timingMsg');
        msg.textContent = '✅ Saved!'; msg.style.color = 'var(--success)'; msg.style.display = 'block';
        setTimeout(() => msg.style.display='none', 2000);
      } catch(e) {}
    });

    // --- UPGRADED AI BRAIN LOGIC ---
    document.getElementById('saveBrainBtn').addEventListener('click', async () => {
      const btn = document.getElementById('saveBrainBtn');
      const originalText = '<i data-lucide="save"></i> Update AI Brain';

      // 1. Loading State
      btn.innerHTML = '<span class="loading-spinner"></span> Updating...';
      btn.disabled = true;

      try {
        const freshToken = await window.Clerk.session.getToken();

        const res = await fetch(`/api/chatbot/customization/${currentActiveBotId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${freshToken}` },
          body: JSON.stringify({
            systemPrompt: document.getElementById('systemPromptInput').value
          })
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({ error: 'Failed to save' }));
          throw new Error(errorData.error || `Error ${res.status}: Failed to save`);
        }

        // 2. The "Cool" Success State! (Turns Green with a Checkmark)
        btn.style.background = 'var(--success)';
        btn.innerHTML = '<i data-lucide="check-circle"></i> Brain Upgraded!';
        if (window.lucide) window.lucide.createIcons();

        // 3. Fire the custom Toast notification
        showToast('AI instructions synced successfully.', 'success');

        // 4. Reset the button back to normal after 2.5 seconds
        setTimeout(() => {
            btn.style.background = ''; // Removes the inline green style
            btn.innerHTML = originalText;
            btn.disabled = false;
            if (window.lucide) window.lucide.createIcons();
        }, 2500);

      } catch (err) {
        console.error("Failed to save AI Brain:", err);
        btn.innerHTML = originalText;
        btn.disabled = false;
        showToast(err.message || 'Error saving AI Brain. Please try again.', 'warning');
        if (window.lucide) window.lucide.createIcons();
      }
    });

    // --- PROMPT LIBRARY ---
    const promptLibrary = [
      {
        id: 'sales-friendly',
        category: 'sales',
        title: 'Friendly Sales Closer',
        description: 'Warm but persuasive. Perfect for e-commerce and product sales.',
        prompt: `You are a friendly sales consultant for our company.

Your job is to help customers find the perfect product for their needs.

HOW TO RESPOND:
- Start with a warm greeting and ask what they're looking for
- Ask 1-2 discovery questions to understand their needs
- Recommend specific products based on their answers
- Highlight 2-3 key benefits (not features)
- Use casual, conversational language
- Keep responses under 4 sentences

GOALS:
- Primary: Get them to book a demo or make a purchase
- Secondary: Collect their contact info for follow-up

NEVER:
- Be pushy or aggressive
- Apologize excessively
- Make up product details you don't know`,
      },
      {
        id: 'support-patient',
        category: 'support',
        title: 'Patient Support Agent',
        description: 'Calm, helpful troubleshooting. Ideal for technical support.',
        prompt: `You are a patient technical support specialist.

Your priority is to solve the customer's problem completely.

HOW TO RESPOND:
- Acknowledge their frustration: "I understand this is frustrating..."
- Ask clarifying questions one at a time
- Provide step-by-step instructions
- Check for understanding: "Does that make sense?"
- Offer to escalate if the issue is complex

TONE:
- Calm and reassuring
- Never rush the customer
- Use simple language, avoid jargon

GOALS:
- Resolve the issue in one conversation if possible
- Ensure the customer feels heard and helped
- Collect feedback if the issue is resolved

ALWAYS:
- Verify the solution worked before ending
- Provide documentation links when helpful`,
      },
      {
        id: 'consultant-discovery',
        category: 'consulting',
        title: 'Discovery Consultant',
        description: 'Professional B2B lead qualification and consultation booking.',
        prompt: `You are a professional business consultant.

Your role is to understand the prospect's needs and qualify them as a potential client.

HOW TO RESPOND:
- Start by understanding their business and goals
- Ask about their current challenges
- Listen more than you talk (ask follow-up questions)
- Summarize what you heard before recommending
- Position your service as the solution to their specific problem

DISCOVERY QUESTIONS:
- "What does your business do?"
- "What's your biggest challenge right now?"
- "What would solving this mean for your business?"
- "Have you tried other solutions?"

GOALS:
- Book a consultation call
- Collect: name, email, company size, best time to call

TONE:
- Professional but approachable
- Expert but not arrogant
- Curious and genuinely interested`
      },
      {
        id: 'saas-onboarding',
        category: 'support',
        title: 'SaaS Onboarding Guide',
        description: 'Friendly product tour guide for software companies.',
        prompt: `You are a friendly onboarding specialist for our SaaS platform.

Your job is to help new users get value from the product quickly.

HOW TO RESPOND:
- Welcome them enthusiastically
- Ask about their use case to tailor recommendations
- Suggest the best starting features for their goals
- Offer to walk them through setup step-by-step
- Share quick tips and best practices

ONBOARDING FLOW:
1. Learn their primary goal
2. Recommend the 3 most relevant features
3. Offer to show them how to use the first one
4. Suggest watching a tutorial or booking a demo

GOALS:
- Get them to their "aha moment" as fast as possible
- Encourage them to start a free trial if they haven't
- Book a demo for complex setups

TONE:
- Enthusiastic but not overbearing
- Helpful teacher vibe
- Celebrate their progress`
      },
      {
        id: 'healthcare-assistant',
        category: 'healthcare',
        title: 'Medical Office Assistant',
        description: 'Cautious healthcare responder with appointment booking.',
        prompt: `You are a helpful assistant for a medical/healthcare practice.

IMPORTANT: You are not a doctor and cannot provide medical advice.

HOW TO RESPOND:
- Be warm and professional
- Answer questions about services, hours, location, insurance
- Help patients understand what to expect
- Direct all medical questions to the provider

BOOKING APPOINTMENTS:
- Ask for preferred date/time
- Collect: name, phone, reason for visit, insurance provider
- Explain what to bring (ID, insurance card, medical records)
- Send confirmation details

DISCLAIMERS:
- Always include: "I'm not a medical professional. Please consult your doctor for medical advice."
- Never diagnose symptoms
- Never recommend treatments

GOALS:
- Book appointments efficiently
- Reduce anxiety about the visit
- Collect necessary information upfront`
      },
      {
        id: 'realestate-agent',
        category: 'realestate',
        title: 'Real Estate Agent',
        description: 'Enthusiastic property consultant with qualifying questions.',
        prompt: `You are a knowledgeable real estate agent.

Your job is to understand what the client is looking for and guide them to the right properties.

HOW TO RESPOND:
- Ask about their must-haves vs nice-to-haves
- Understand their timeline (urgent vs browsing)
- Ask about budget range
- Learn about their lifestyle needs (commute, schools, etc.)

QUALIFYING QUESTIONS:
- "Are you buying, selling, or renting?"
- "What's your ideal timeline?"
- "What neighborhoods are you considering?"
- "What's your budget range?"
- "Any must-have features?"

GOALS:
- Schedule a property showing
- Get them pre-approved with a lender
- Collect contact info for new listings

TONE:
- Enthusiastic about properties
- Professional but friendly
- Never pushy - buying a home is a big decision

ALWAYS:
- Be honest about market conditions
- Suggest properties that actually match their criteria`
      },
      {
        id: 'restaurant-host',
        category: 'sales',
        title: 'Restaurant Host',
        description: 'Warm hospitality with reservation booking and menu guidance.',
        prompt: `You are the hospitable host for our restaurant.

Your job is to welcome guests, answer questions, and book reservations.

HOW TO RESPOND:
- Greet warmly: "Welcome! We'd love to host you!"
- Answer menu questions (describe dishes, allergens, specials)
- Help with party size and seating preferences
- Suggest popular dishes when asked
- Handle dietary restrictions with care

RESERVATIONS:
- Ask: date, time, party size, special occasion
- Mention reservation policies (cancellation, large groups)
- Offer to save their preferences

GOALS:
- Book the reservation
- Get them excited about dining with you
- Collect special requests (anniversary, birthday, dietary needs)

TONE:
- Warm and inviting
- Knowledgeable about the menu
- Accommodating but clear about policies`
      },
      {
        id: 'fitness-coach',
        category: 'consulting',
        title: 'Fitness & Wellness Coach',
        description: 'Motivating health advisor with consultation booking.',
        prompt: `You are a motivating fitness and wellness consultant.

Your job is to understand the person's fitness goals and guide them to the right program.

HOW TO RESPOND:
- Ask about their current fitness level
- Understand their specific goals (weight loss, muscle gain, endurance)
- Learn about any injuries or limitations
- Ask about their schedule and commitment level
- Recommend the best program or membership

COACHING APPROACH:
- Be encouraging, never judgmental
- Celebrate small wins
- Set realistic expectations
- Emphasize that consistency beats intensity

GOALS:
- Book a free consultation or trial session
- Get them to sign up for a membership
- Collect fitness goals for personalization

TONE:
- Energetic but not overwhelming
- Supportive and understanding
- Professional but relatable`
      }
    ];

    // Render prompt library
    function renderPromptLibrary(category = 'all') {
      const grid = document.getElementById('promptLibraryGrid');
      if (!grid) return;

      const filtered = category === 'all'
        ? promptLibrary
        : promptLibrary.filter(p => p.category === category);

      grid.innerHTML = filtered.map(prompt => `
        <div class="prompt-card" data-prompt-id="${prompt.id}" style="background: var(--bg-sidebar); border: 1px solid var(--border); border-radius: 12px; padding: 20px; cursor: pointer; transition: all 0.2s; hover: border-color: var(--primary);"
          onmouseover="this.style.borderColor='var(--primary)'"
          onmouseout="this.style.borderColor='var(--border)'"
          onclick="applyPromptTemplate('${prompt.id}')">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;"
            onmouseover="event.stopPropagation()" onclick="event.stopPropagation()">
            <span class="prompt-category" style="background: var(--primary); color: white; font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 4px 8px; border-radius: 4px;">${prompt.category}</span>
          </div>
          <h4 style="color: white; font-size: 16px; font-weight: 600; margin: 0 0 8px 0;">${prompt.title}</h4>
          <p style="color: var(--text-muted); font-size: 13px; margin: 0; line-height: 1.5;">${prompt.description}</p>
          <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border);"
            onmouseover="event.stopPropagation()" onclick="event.stopPropagation()">
            <button style="background: var(--primary); color: white; border: none; padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; width: 100%;"
              onmouseover="event.stopPropagation()" onclick="event.stopPropagation(); applyPromptTemplate('${prompt.id}')">
              Use This Template
            </button>
          </div>
        </div>
      `).join('');
    }

    // Apply prompt template
    window.applyPromptTemplate = function(promptId) {
      const template = promptLibrary.find(p => p.id === promptId);
      if (!template) return;

      const textarea = document.getElementById('systemPromptInput');
      if (textarea) {
        textarea.value = template.prompt;
        closePromptLibrary();
        showToast(`Template "${template.title}" applied! You can edit it before saving.`, 'success');
      }
    };

    // Open/Close Prompt Library
    function openPromptLibrary() {
      const modal = document.getElementById('promptLibraryModal');
      if (modal) {
        modal.style.display = 'flex';
        renderPromptLibrary('all');
      }
    }

    function closePromptLibrary() {
      const modal = document.getElementById('promptLibraryModal');
      if (modal) {
        modal.style.display = 'none';
      }
    }

    // Event Listeners for Prompt Library
    document.getElementById('openPromptLibraryBtn')?.addEventListener('click', openPromptLibrary);
    document.getElementById('closePromptLibraryBtn')?.addEventListener('click', closePromptLibrary);

    // Category tabs
    document.querySelectorAll('.prompt-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        // Update active state
        document.querySelectorAll('.prompt-tab').forEach(t => {
          t.classList.remove('active');
          t.style.background = 'var(--bg-sidebar)';
          t.style.color = 'var(--text-muted)';
        });
        e.target.classList.add('active');
        e.target.style.background = 'var(--primary)';
        e.target.style.color = 'white';

        // Filter prompts
        const category = e.target.dataset.category;
        renderPromptLibrary(category);
      });
    });

    // Close on backdrop click
    document.getElementById('promptLibraryModal')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        closePromptLibrary();
      }
    });

    // --- INSTALL CODES ---
    function updateInstallCodes(id) {
      const origin = window.location.origin;
      const s = `&lt;script src="${origin}/widget.js" data-chatbot-id="${id}"&gt;&lt;/script&gt;`;
      const d = `&lt;script&gt;\n  const s = document.createElement("script");\n  s.src = "${origin}/widget.js";\n  s.setAttribute("data-chatbot-id", "${id}");\n  document.body.appendChild(s);\n&lt;/script&gt;`;
      if(document.getElementById('standardCode')) document.getElementById('standardCode').innerHTML = s;
      if(document.getElementById('dynamicCode')) document.getElementById('dynamicCode').innerHTML = d;
    }

    window.copyEmbedCode = function(elementId, btn) {
      const text = document.getElementById(elementId).innerText;
      navigator.clipboard.writeText(text).then(() => {
        btn.innerHTML = '<i data-lucide="check" style="color: var(--success); width: 14px;"></i> <span style="color: var(--success);">Copied!</span>';
        lucide.createIcons();
        setTimeout(() => { btn.innerHTML = '<i data-lucide="copy" style="width: 14px;"></i> <span>Copy</span>'; lucide.createIcons(); }, 2000);
      });
    }

    // --- ACCOUNT LOGIC ---
    async function signOut() {
      try {
        const res = await fetch('/api/config');
        const config = await res.json();
        if (window.Clerk) {
          await window.Clerk.load();
          await window.Clerk.signOut();
        }
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = config.clerkSignInUrl + '?redirect_url=' + encodeURIComponent(config.appUrl + '/dashboard');
      } catch(e) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/';
      }
    }

    document.getElementById('signOutBtn').addEventListener('click', signOut);

    // --- REAL CLERK NAME UPDATE ---
    document.getElementById('updateProfileForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('saveProfileBtn');
      const msg = document.getElementById('profileMsg');

      btn.textContent = 'Saving...';
      btn.disabled = true;
      msg.style.display = 'none';

      try {
        const fullName = document.getElementById('accountName').value.trim();

        // Clerk expects first and last name separately, so we split the input
        const nameParts = fullName.split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ');

        // 1. Tell Clerk to update the user's database record
        await window.Clerk.user.update({
            firstName: firstName,
            lastName: lastName
        });

        // 2. Update local storage so the name stays updated if they refresh
        user.name = fullName;
        localStorage.setItem('user', JSON.stringify(user));

        // Show Success
        msg.textContent = '✅ Profile updated successfully!';
        msg.style.color = 'var(--success)';
        msg.style.display = 'block';
        setTimeout(() => msg.style.display='none', 3000);

      } catch (error) {
        console.error("Clerk Update Error:", error);
        // Show the exact error Clerk throws (e.g., "Invalid name")
        msg.textContent = '❌ ' + (error.errors?.[0]?.message || 'Failed to update profile');
        msg.style.color = 'var(--danger)';
        msg.style.display = 'block';
      } finally {
        btn.textContent = 'Update Details';
        btn.disabled = false;
      }
    });

    // --- REAL CLERK PASSWORD UPDATE ---
    document.getElementById('updatePasswordForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('savePasswordBtn');
      const msg = document.getElementById('passwordMsg');

      btn.textContent = 'Updating...';
      btn.disabled = true;
      msg.style.display = 'none';

      try {
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;

        // Securely pass the passwords to Clerk
        await window.Clerk.user.updatePassword({
            currentPassword: currentPassword,
            newPassword: newPassword
        });

        // Show Success
        msg.textContent = '✅ Password updated securely!';
        msg.style.color = 'var(--success)';
        msg.style.display = 'block';
        document.getElementById('updatePasswordForm').reset();
        setTimeout(() => msg.style.display='none', 3000);

      } catch (error) {
        console.error("Clerk Password Error:", error);
        // Clerk automatically checks if the old password is wrong or the new one is too weak!
        msg.textContent = '❌ ' + (error.errors?.[0]?.message || 'Check your current password and try again.');
        msg.style.color = 'var(--danger)';
        msg.style.display = 'block';
      } finally {
        btn.textContent = 'Update Password';
        btn.disabled = false;
      }
    });

    // ========== MULTI-VIEW DASHBOARD LOGIC ==========
    const viewList = document.getElementById('botListView');
    const viewCreate = document.getElementById('botCreationView');
    const viewSettings = document.getElementById('activeBotSettingsView');
    const btnCancel = document.getElementById('btnCancelCreate');
    const botGrid = document.getElementById('botGrid');

    // Helper to hide everything and show one view
    function showView(viewToShow) {
      viewList.style.display = 'none';
      viewCreate.style.display = 'none';
      viewSettings.style.display = 'none';
      viewToShow.style.display = 'block';
    }

    let currentActiveBotId = null; // Remembers which bot we are editing

    // Upgraded Smart Toast Notification
    function showToast(message, type = 'warning') {
      const existingToast = document.getElementById('ultramora-toast');
      if (existingToast) existingToast.remove();

      const toast = document.createElement('div');
      toast.id = 'ultramora-toast';
      toast.className = 'custom-toast';

      // Default to Warning (Orange)
      let iconName = 'alert-circle';
      let iconColor = '#f59e0b';

      // Change to Success (Green) if requested
      if (type === 'success') {
          iconName = 'check-circle';
          iconColor = '#10b981';
          toast.style.borderLeftColor = iconColor; // Change the side border to green
      }

      toast.innerHTML = `
        <i data-lucide="${iconName}" style="color: ${iconColor}; width: 20px;"></i>
        <span>${message}</span>
      `;

      document.body.appendChild(toast);
      if (window.lucide) window.lucide.createIcons();

      setTimeout(() => toast.classList.add('show'), 10);
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
      }, 3000);
    }

    // 1. RUN THIS WHEN THE USER LOGS IN
    async function initializeDashboard() {
        console.log('[initializeDashboard] Starting...');
        try {
            const token = await window.Clerk.session.getToken();
            console.log('[initializeDashboard] Got token:', token ? 'yes' : 'no');

            // Load user subscription status
            loadUserStatus();

            // Fetch bot list
            const response = await fetch('/api/chatbot/list', {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            // Catch Trial Expired
            if (!response.ok) {
                const errData = await response.json();
                if (errData.error === 'TRIAL_EXPIRED') {
                    document.getElementById('dashboardSidebar').style.display = 'none';
                    document.getElementById('mobileHeader').style.display = 'none';
                    showView(document.getElementById('trialExpiredView'));
                    document.getElementById('trialExpiredView').style.display = 'flex';
                    if (window.lucide) window.lucide.createIcons();
                    return;
                }
                throw new Error('Failed to load');
            }

            const bots = await response.json();
            const viewListEl = document.getElementById('botListView');
            const viewCreateEl = document.getElementById('botCreationView');
            const sidebarEl = document.getElementById('dashboardSidebar');

            if (bots.length === 0) {
                sidebarEl.style.display = 'none';
                showView(viewCreateEl);
                document.getElementById('btnCancelCreate').style.display = 'none';
            } else {
                sidebarEl.style.display = 'flex';
                renderBotGrid(bots);
                showView(viewListEl);
                document.getElementById('btnCancelCreate').style.display = 'inline-block';
            }
        } catch (error) {
            console.error("[initializeDashboard] Failed");
            // Show error message to user
            const mainContent = document.querySelector('.main-content');
            if (mainContent) {
                mainContent.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                        <i data-lucide="alert-circle" style="width: 48px; height: 48px; color: var(--danger); margin-bottom: 16px;"></i>
                        <h2>Failed to load dashboard</h2>
                        <p>Please refresh the page or sign in again.</p>
                        <button onclick="window.location.href='/'" style="margin-top: 20px; padding: 12px 24px; background: var(--primary); color: white; border: none; border-radius: 8px; cursor: pointer;">Go to Home</button>
                    </div>
                `;
                if (window.lucide) window.lucide.createIcons();
            }
        }
    }

    // --- USER SUBSCRIPTION STATUS ---
    async function loadUserStatus() {
      try {
        const token = await window.Clerk.session.getToken();
        const response = await fetch('/api/chatbot/user/status', {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
          console.error('Failed to load user status:', response.status);
          return;
        }

        const userData = await response.json();

        // Format dates nicely (e.g., 'April 14, 2026')
        const formatDate = (dateString) => {
          if (!dateString) return 'N/A';
          const date = new Date(dateString);
          return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });
        };

        const createdAtFormatted = formatDate(userData.createdAt);
        const trialEndsFormatted = formatDate(userData.trialEndsAt);

        // Populate Account section
        document.getElementById('sub-created-at').textContent = createdAtFormatted;
        document.getElementById('sub-trial-ends').textContent = trialEndsFormatted;
        document.getElementById('sub-plan').textContent = userData.plan || 'free';

        const trialBanner = document.getElementById('trial-banner');
        const trialBannerDate = document.getElementById('trial-banner-date');
        const trialEndsRow = document.getElementById('trial-ends-row');
        const manageSubBtn = document.getElementById('manage-sub-btn');
        const upgradeSubBtn = document.getElementById('upgrade-sub-btn');

        if (userData.plan === 'free') {
          // Show trial banner with end date
          trialBanner.style.display = 'block';
          trialBannerDate.textContent = trialEndsFormatted;

          // Show trial end date in Account section
          trialEndsRow.style.display = 'flex';

          // Hide manage/cancel button (user is on free plan)
          manageSubBtn.style.display = 'none';

          // Show upgrade button
          upgradeSubBtn.style.display = 'block';
        } else {
          // Hide trial banner (user is paid)
          trialBanner.style.display = 'none';

          // Hide trial end date in Account section
          trialEndsRow.style.display = 'none';

          // Show manage/cancel button
          manageSubBtn.style.display = 'flex';

          // Hide upgrade button (user already has paid plan)
          upgradeSubBtn.style.display = 'none';
        }
      } catch (error) {
        console.error('Error loading user status:', error);
      }
    }

    // 2. DRAW THE BOT CARDS
    function renderBotGrid(bots) {
      botGrid.innerHTML = '';
      bots.forEach(bot => {
        const card = document.createElement('div');
        card.style.cssText = 'background: #1f2937; padding: 20px; border-radius: 8px; cursor: pointer; border: 1px solid #374151;';
        card.innerHTML = `
            <h3 style="margin: 0 0 10px 0;">${bot.name}</h3>
            <span style="color: #9ca3af; font-size: 12px;">Click to manage</span>
        `;
        // Click a bot to open its dashboard
        card.onclick = () => {
          currentActiveBotId = bot._id;

          // Show the settings view
          showView(viewSettings);

          // Fetch and populate this specific bot's data
          loadActiveBotData(bot._id);
        };
        botGrid.appendChild(card);
      });
    }

    // Fetch and display data for the clicked bot
    async function loadActiveBotData(botId) {
      const overlay = document.getElementById('botLoadingOverlay');
      if (overlay) overlay.style.display = 'flex';

      try {
        // 1. ALWAYS grab a fresh token right before making a secure request
        const freshToken = await window.Clerk.session.getToken();

        // 2. Fetch the specific bot from backend
        const response = await fetch(`/api/chatbot/${botId}`, {
          headers: { 'Authorization': `Bearer ${freshToken}` }
        });

        // 3. Catch the 401 error BEFORE it tries to parse JSON and crashes
        if (!response.ok) {
            throw new Error(`Server blocked request: ${response.status} ${response.statusText}`);
        }

        const botData = await response.json();

        // Update website display
        const websiteDisplay = document.getElementById('configWebsite');
        if (websiteDisplay) websiteDisplay.textContent = botData.websiteUrl || 'No URL Provided';

        // Update deployment date
        const dateDisplay = document.getElementById('configDate');
        if (dateDisplay) {
          dateDisplay.textContent = new Date(botData.createdAt).toLocaleDateString();
        }

        // Update conversation count
        const convDisplay = document.getElementById('metric-conversations');
        if (convDisplay) convDisplay.textContent = botData.conversationCount || 0;

        // Update status toggle
        setupStatusToggle(botData.isActive);

        // Store widgetId and load remaining dashboard data
        widgetId = botData.widgetId;
        chatbotData = botData;

        // Show sidebar with tabs
        document.getElementById('dashboardSidebar').style.display = 'flex';

        // Restore active tab
        const savedTab = localStorage.getItem('activeTab') || 'tab-overview';
        switchTab(savedTab, null);

        // Populate the rest of the dashboard
        populateDashboardData(botData);

        // Fetch the leads for this specific bot
        loadLeads();

      } catch (error) {
        console.error("Failed to load bot data:", error);
        const websiteDisplay = document.getElementById('configWebsite');
        if (websiteDisplay) websiteDisplay.textContent = 'Error loading';
        const dateDisplay = document.getElementById('configDate');
        if (dateDisplay) dateDisplay.textContent = 'Error loading';
      } finally {
        // Hide loading overlay
        if (overlay) overlay.style.display = 'none';
      }
    }

    // --- DASHBOARD CHARTS & LISTS ---
    let dashboardChartInstance = null;

    function renderOverviewData(chartDataArray, recentMessagesArray) {
        // 1. Render the 7-Day Line Chart
        const ctx = document.getElementById('activityChart');
        if (!ctx) return;

        // Destroy old chart if switching bots
        if (dashboardChartInstance) {
            dashboardChartInstance.destroy();
        }

        // Get the last 7 days for the labels
        const labels = [...Array(7)].map((_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - (6 - i));
            return d.toLocaleDateString('en-US', { weekday: 'short' });
        });

        dashboardChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Messages',
                    data: chartDataArray,
                    borderColor: '#06b6d4',
                    backgroundColor: 'rgba(6, 182, 212, 0.1)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true,
                    pointBackgroundColor: '#111827',
                    pointBorderColor: '#06b6d4',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#1f2937',
                        titleColor: '#f8fafc',
                        bodyColor: '#94a3b8',
                        borderColor: '#334155',
                        borderWidth: 1,
                        padding: 10,
                        displayColors: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: '#1e293b', drawBorder: false },
                        ticks: { color: '#94a3b8', stepSize: 10 }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#94a3b8' }
                    }
                }
            }
        });

        // 2. Render the Recent Questions List
        const listContainer = document.getElementById('recentQuestionsList');
        if (!listContainer) return;

        if (!recentMessagesArray || recentMessagesArray.length === 0) {
            listContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px 0; font-size: 13px;">No messages yet.</div>`;
            return;
        }

        listContainer.innerHTML = recentMessagesArray.map(msg => `
            <div style="background: var(--bg-sidebar); border: 1px solid var(--border-light); border-radius: 8px; padding: 12px;">
                <div style="color: white; font-size: 13px; font-weight: 500; margin-bottom: 4px; line-height: 1.4;">"${msg.text}"</div>
                <div style="color: var(--text-muted); font-size: 11px;">${msg.time}</div>
            </div>
        `).join('');
    }

    // Populate remaining dashboard sections (appearance, knowledge, etc.)
    function populateDashboardData(data) {
      // Knowledge chunks count
      let chunks = 0;
      if (data.chunkCount) {
        chunks = data.chunkCount;
      } else if (data.scrapedContent) {
        if (data.scrapedContent.totalChunks) {
          chunks = data.scrapedContent.totalChunks;
        } else if (Array.isArray(data.scrapedContent)) {
          chunks = data.scrapedContent.length;
        } else if (typeof data.scrapedContent === 'string') {
          chunks = data.scrapedContent.split('\n').filter(line => line.trim().length > 20).length;
          if (chunks === 0) chunks = 1;
        }
      }
      if (data.customKnowledge && typeof data.customKnowledge === 'string') {
        chunks += data.customKnowledge.split('\n\n').filter(Boolean).length;
      }
      const chunksDisplay = document.getElementById('configChunks');
      if (chunksDisplay) chunksDisplay.textContent = chunks;

      // Appearance
      if (data.customization) {
        document.getElementById('customBotName').value = data.customization.botName || 'AI Assistant';
        document.getElementById('systemPromptInput').value = data.customization.systemPrompt || '';
        document.getElementById('customWelcome').value = data.customization.welcomeMessage || "Hi! How can I help you?";
        document.getElementById('customProactive').value = data.proactiveMessage || "👋 Hi there! Have any questions?";
        document.getElementById('customProactiveDelay').value = data.proactiveDelay !== undefined ? data.proactiveDelay : 3;
        document.getElementById('proactiveEnabled').checked = data.proactiveEnabled !== undefined ? data.proactiveEnabled : true;
        document.getElementById('customColor').value = data.customization.bubbleColor || '#06b6d4';
        document.getElementById('customBookingLink').value = data.customization.bookingLink || '';
        document.getElementById('leadTimingSelect').value = data.customization.leadCaptureTiming ?? 3;

        const qrs = data.customization.quickReplies || [];
        document.getElementById('qr1').value = qrs[0] || '';
        document.getElementById('qr2').value = qrs[1] || '';
        document.getElementById('qr3').value = qrs[2] || '';

        if (data.customization.botLogo) {
          document.getElementById('logoPreview').src = data.customization.botLogo;
          document.getElementById('logoPreview').style.display = 'block';
          document.getElementById('botLogoBase64').value = data.customization.botLogo;
          document.getElementById('lp-avatar-fallback').style.display = 'none';
          // Also set live preview avatar
          document.getElementById('lp-avatar-img').src = data.customization.botLogo;
          document.getElementById('lp-avatar-img').style.display = 'block';
          document.getElementById('lp-avatar-fallback-header').style.display = 'none';
        } else {
          document.getElementById('logoPreview').style.display = 'none';
          document.getElementById('botLogoBase64').value = '';
          document.getElementById('customLogoInput').value = ''; // Clear file input
          document.getElementById('lp-avatar-fallback').style.display = 'block';
          // Also clear live preview avatar
          document.getElementById('lp-avatar-img').style.display = 'none';
          document.getElementById('lp-avatar-fallback-header').style.display = 'block';
        }

        // Load launcher image
        if (data.customization.launcherImage) {
          document.getElementById('launcherImagePreview').src = data.customization.launcherImage;
          document.getElementById('launcherImagePreview').style.display = 'block';
          document.getElementById('launcherImageBase64').value = data.customization.launcherImage;
          document.getElementById('launcher-image-fallback').style.display = 'none';
        } else {
          document.getElementById('launcherImagePreview').style.display = 'none';
          document.getElementById('launcherImageBase64').value = '';
          document.getElementById('launcherImageInput').value = '';
          document.getElementById('launcher-image-fallback').style.display = 'block';
        }
      }
      updateLivePreview();

      // Integrations API Key
      document.getElementById('integrationsApiKey').value = data.apiKey || 'cw_sk_' + data.widgetId;

      // Install codes
      updateInstallCodes(data.widgetId);

      // Knowledge list
      renderKnowledgeList(data.customKnowledge || '', data.trainedFiles || []);

      // Account form
      document.getElementById('accountName').value = user.name || '';
      document.getElementById('accountEmail').value = user.email || '';

      // Render chart and recent questions with real data (or zeros if empty)
      const chartData = data.activityChart || [0, 0, 0, 0, 0, 0, 0];
      const recentMessages = data.recentMessages || [];
      if (typeof renderOverviewData === 'function') {
        renderOverviewData(chartData, recentMessages);
      }

      // Load Booking Flow Data
      if (data) {
        document.getElementById('whatsappNumberInput').value = data.whatsappNumber || '';
        const toggle = document.getElementById('enableBookingToggle');
        if (data.enableBookingFlow === true) toggle.classList.add('active');
        else toggle.classList.remove('active');

        if (typeof currentQuestions !== 'undefined') {
          currentQuestions = data.bookingQuestions || [];
          if (typeof renderBookingQuestions === 'function') renderBookingQuestions();
        }
      }
    }

    // --- BUTTON CLICKS ---

    // "+ Create New Chatbot" button clicked
    document.getElementById('btnShowCreateForm').addEventListener('click', () => {
      showView(viewCreate);
      document.getElementById('newBotName').value = ''; // Clear old input
    });

    // "Cancel" button clicked
    btnCancel.addEventListener('click', () => {
      showView(viewList);
    });

    // "Back to My Bots" - will be safely attached in DOMContentLoaded below

    // Form submission (create new bot)
    document.getElementById('createForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('createBtn');
      const errorDiv = document.getElementById('createError');
      errorDiv.style.display = 'none';
      btn.disabled = true;
      btn.innerHTML = '<span class="loading-spinner"></span> Training...';
      try {
        const botName = document.getElementById('newBotName').value || 'My AI Assistant';
        const websiteUrl = document.getElementById('websiteUrl').value;
        // Get fresh token before creating
        const freshToken = await window.Clerk.session.getToken();
        const response = await fetch('/api/chatbot/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${freshToken}` },
          body: JSON.stringify({ botName, websiteUrl })
        });
        // Bulletproof error handling - don't assume JSON response
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch (e) { data = { error: text || 'Unknown server error' }; }
        if (!response.ok) throw new Error(data.error || 'Failed to create chatbot');
        // Success — go back to bot list
        initializeDashboard();
      } catch (err) {
        errorDiv.textContent = err.message;
        errorDiv.style.display = 'block';
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="rocket"></i> Train AI Agent';
        if (window.lucide) window.lucide.createIcons();
      }
    });

    document.addEventListener('DOMContentLoaded', () => {

        // NOTE: We do NOT call initializeDashboard() here anymore.
        // The Clerk script at the top of the file already calls it at the perfect time!

        // 1. Safely attach the Back Button
        const btnBack = document.getElementById('btnBackToBots');
        if (btnBack) {
            btnBack.addEventListener('click', () => {
                currentActiveBotId = null; // Forget the bot
                document.getElementById('activeBotSettingsView').style.display = 'none';
                document.getElementById('botListView').style.display = 'block';

                // NEW: Force the mobile sidebar to slide away!
                document.getElementById('dashboardSidebar').classList.remove('mobile-open');
                document.getElementById('sidebarOverlay').classList.remove('active');
                document.body.style.overflow = '';
            });
        }

        // 2. Safely attach the Sidebar Bouncer
        const sidebarTabs = document.querySelectorAll('.sidebar li, .sidebar .nav-item');
        sidebarTabs.forEach(tab => {
            tab.addEventListener('click', (event) => {
                if (tab.innerText.includes('Account')) return; // Always allow My Account

                // NEW: Tell the bouncer to completely ignore the Back button
                if (tab.id === 'btnBackToBots') return;

                if (!currentActiveBotId) {
                    event.preventDefault();
                    event.stopPropagation();
                    showToast("Please select a chatbot from your list first!");

                    // Force the bot list to show
                    document.getElementById('botListView').style.display = 'block';
                    document.getElementById('activeBotSettingsView').style.display = 'none';
                    document.getElementById('botCreationView').style.display = 'none';
                }
            });
        });
    });

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
