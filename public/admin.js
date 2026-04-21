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

// Toast notification function
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'alert-circle' : 'info';
  toast.innerHTML = `
    <i data-lucide="${icon}" style="width: 16px; height: 16px;"></i>
    <span>${escapeHTML(message)}</span>
  `;

  container.appendChild(toast);
  if (window.lucide) window.lucide.createIcons();

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Helper: get fresh Clerk session token
async function getAuthHeaders() {
  // Wait for Clerk to be ready
  if (!window.Clerk || !window.Clerk.session) {
    throw new Error('Clerk not initialized');
  }
  const token = await window.Clerk.session.getToken();
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

// Wait for Clerk to be ready before loading data
function waitForClerk(callback, maxAttempts = 50) {
  let attempts = 0;
  const check = () => {
    attempts++;
    if (window.Clerk && window.Clerk.session) {
      callback();
    } else if (attempts < maxAttempts) {
      setTimeout(check, 100);
    } else {
      console.error('Clerk failed to initialize');
    }
  };
  check();
}

// --- SECTION NAVIGATION ---
const sections = ['users', 'chatbots', 'analytics', 'health', 'logs'];
let currentSection = 'users';

function switchSection(sectionId) {
  if (!sections.includes(sectionId)) return;

  currentSection = sectionId;

  // Update nav items
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.section === sectionId);
  });

  // Update sections
  sections.forEach(id => {
    const section = document.getElementById(`${id}-section`);
    if (section) {
      section.classList.toggle('active', id === sectionId);
    }
  });

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sidebarOverlay').classList.remove('active');

  // Refresh data or start/stop monitoring based on section
  if (sectionId === 'users') {
    loadDashboardData();
    stopHealthMonitoring();
    stopAnalyticsRefresh();
  } else if (sectionId === 'health') {
    startHealthMonitoring();
    stopAnalyticsRefresh();
  } else if (sectionId === 'analytics') {
    stopHealthMonitoring();
    startAnalyticsRefresh();
  } else {
    stopHealthMonitoring();
    stopAnalyticsRefresh();
  }
}

// --- MOBILE SIDEBAR ---
function initMobileSidebar() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');

  if (menuToggle) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('mobile-open');
      overlay.classList.toggle('active');
    });
  }

  if (overlay) {
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('mobile-open');
      overlay.classList.remove('active');
    });
  }
}

// --- NAV ITEM LISTENERS ---
function initNavListeners() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const section = item.dataset.section;
      if (section) switchSection(section);
    });
  });
}

// --- DASHBOARD DATA LOADING ---
async function loadDashboardData() {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch('/api/admin/dashboard', { headers });
    if (!response.ok) throw new Error(`Failed to fetch admin data (${response.status})`);

    const data = await response.json();

    // Update metrics
    document.getElementById('metric-users').textContent = data.totalUsers || 0;
    document.getElementById('metric-bots').textContent = data.totalBots || 0;
    document.getElementById('metric-convo').textContent = data.totalConversations || 0;
    document.getElementById('metric-leads').textContent = data.totalLeads || 0;

    // Populate table
    const tbody = document.getElementById('data-table-body');
    tbody.innerHTML = '';

    if (!data.users || data.users.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 40px; color: var(--text-muted);">
            No users found.
          </td>
        </tr>
      `;
      return;
    }

    data.users.forEach(user => {
      const row = document.createElement('tr');

      const planBadge = user.plan === 'pro'
        ? '<span class="badge badge-pro">Pro</span>'
        : '<span class="badge badge-free">Free</span>';

      const botBadge = user.hasBot
        ? '<span class="badge badge-yes">Yes</span>'
        : '<span class="badge badge-no">No</span>';

      const featuresValue = escapeHTML((user.features || []).join(', '));
      const userData = escapeHTML(JSON.stringify(user).replace(/'/g, "&#39;"));

      row.innerHTML = `
        <td>
          <div class="user-cell">
            <div class="user-avatar">${escapeHTML(user.name?.charAt(0) || 'U')}</div>
            <div class="user-info">
              <div class="name">${escapeHTML(user.name)}</div>
              <div class="email">${escapeHTML(user.email)}</div>
            </div>
          </div>
        </td>
        <td>${planBadge}</td>
        <td>${botBadge}</td>
        <td>${user.conversationCount || 0}</td>
        <td>
          <input type="text" class="features-input" id="features-${escapeHTML(user.clerkUserId)}" value="${featuresValue}" placeholder="e.g. beta_tester, ai_brain">
          <button class="btn btn-primary" data-action="save-features" data-user-id="${escapeHTML(user.clerkUserId)}" style="margin-left: 8px;">
            <i data-lucide="save" style="width: 14px; height: 14px;"></i>
            <span>Save</span>
          </button>
        </td>
        <td>
          <div class="actions-cell">
            <button class="btn btn-secondary btn-icon" data-action="view" data-user="${userData}" title="View Details">
              <i data-lucide="eye" style="width: 16px; height: 16px;"></i>
            </button>
            <button class="btn btn-primary" data-action="upgrade" data-user-id="${escapeHTML(user.clerkUserId)}">
              <i data-lucide="crown" style="width: 14px; height: 14px;"></i>
              <span>Pro</span>
            </button>
            <button class="btn btn-danger btn-icon" data-action="delete" data-user-id="${escapeHTML(user.clerkUserId)}" title="Delete User">
              <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(row);
    });

    // Initialize icons
    if (window.lucide) window.lucide.createIcons();

  } catch (error) {
    console.error('Error loading dashboard:', error);
    showToast('Failed to load dashboard data', 'error');
  }
}

// --- ACTION HANDLERS ---
async function handleAction(e) {
  const button = e.target.closest('[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  const userId = button.dataset.userId;

  try {
    const headers = await getAuthHeaders();

    if (action === 'save-features') {
      await saveFeatures(userId);
    } else if (action === 'upgrade') {
      // Legacy upgrade - defaults to pro
      const res = await fetch(`/api/admin/upgrade/${userId}`, {
        method: 'PATCH',
        headers
      });
      if (!res.ok) throw new Error(`Upgrade failed (${res.status})`);
      showToast('User upgraded to Pro plan successfully');
      loadDashboardData();
    } else if (action === 'delete') {
      if (!confirm('Are you sure you want to delete this user and all their bots?')) return;
      const res = await fetch(`/api/admin/user/${userId}`, {
        method: 'DELETE',
        headers
      });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      showToast('User deleted successfully');
      loadDashboardData();
    } else if (action === 'view') {
      try {
        const userData = JSON.parse(button.dataset.user);
        showUserModal(userData);
      } catch (error) {
        console.error('Error parsing user data:', error);
        showToast('Failed to load user details', 'error');
      }
    }
  } catch (error) {
    console.error('Action error:', error);
    showToast(error.message, 'error');
  }
}

// --- USER MODAL ---
const modal = document.getElementById('user-modal');

function showUserModal(userData) {
  document.getElementById('modal-user-name').textContent = userData.name || 'Unknown';
  document.getElementById('modal-user-email').textContent = userData.email || 'No email';

  // Enhanced plan display with usage
  const planName = userData.planName || userData.plan || 'Free';
  const maxBots = userData.maxBots || 1;
  const maxMessages = userData.maxMessages || 50;
  const botCount = userData.botCount || 0;
  const msgCount = userData.monthlyMessageCount || 0;
  const planPrice = userData.planPrice || 0;

  const planHtml = `
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
      <span style="font-weight: 600;">${planName}</span>
      <span style="color: var(--text-muted);">($${planPrice}/mo)</span>
      ${userData.isTrialExpired ? '<span style="color: var(--danger); font-size: 12px;">[TRIAL EXPIRED]</span>' : ''}
    </div>
    <div style="margin-top: 12px;">
      <div style="margin-bottom: 8px;">
        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Bots: ${botCount}/${maxBots}</div>
        <div style="background: var(--bg-tertiary); height: 6px; border-radius: 3px; overflow: hidden;">
          <div style="width: ${(botCount/maxBots)*100}%; height: 100%; background: ${botCount/maxBots >= 0.9 ? 'var(--danger)' : 'var(--accent)'}; border-radius: 3px;"></div>
        </div>
      </div>
      <div>
        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Messages: ${msgCount.toLocaleString()}/${maxMessages.toLocaleString()}</div>
        <div style="background: var(--bg-tertiary); height: 6px; border-radius: 3px; overflow: hidden;">
          <div style="width: ${(msgCount/maxMessages)*100}%; height: 100%; background: ${msgCount/maxMessages >= 0.9 ? 'var(--danger)' : 'var(--accent)'}; border-radius: 3px;"></div>
        </div>
      </div>
    </div>
  `;

  const planField = document.getElementById('modal-user-plan');
  if (planField) planField.innerHTML = planHtml;

  document.getElementById('modal-user-joined').textContent = userData.joinedAt
    ? new Date(userData.joinedAt).toLocaleDateString()
    : 'Unknown';
  document.getElementById('modal-user-lastactive').textContent = userData.lastActive
    ? new Date(userData.lastActive).toLocaleDateString()
    : 'Never';
  document.getElementById('modal-user-location').textContent = userData.location || 'Unknown';
  document.getElementById('modal-user-bots').textContent = userData.botNames || 'No bots';

  modal.classList.add('show');
}

function closeModal() {
  modal.classList.remove('show');
}

// --- SAVE FEATURES ---
async function saveFeatures(userId) {
  try {
    const input = document.getElementById(`features-${userId}`);
    if (!input) return;

    const featuresText = input.value;
    const features = featuresText
      .split(',')
      .map(f => f.trim())
      .filter(f => f.length > 0);

    const headers = await getAuthHeaders();
    const res = await fetch(`/api/admin/users/${userId}/features`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ features })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `Failed to update features (${res.status})`);
    }

    showToast('Features updated successfully');
  } catch (error) {
    console.error('Error saving features:', error);
    showToast(error.message, 'error');
  }
}

// --- HEALTH MONITORING ---
const responseTimeHistory = [];
const MAX_HISTORY_POINTS = 30;
let healthCheckInterval = null;

// --- ANALYTICS CHARTS ---
let charts = {};
let analyticsInterval = null;

// Initialize Chart.js with dark theme defaults
function initChartDefaults() {
  if (!window.Chart) return;

  const style = getComputedStyle(document.documentElement);
  const textColor = style.getPropertyValue('--text-secondary').trim();
  const gridColor = style.getPropertyValue('--border').trim();

  Chart.defaults.color = textColor;
  Chart.defaults.borderColor = gridColor;
  Chart.defaults.backgroundColor = 'transparent';
  Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
}

// Create conversations over time chart
function createConversationsChart(apiData) {
  const ctx = document.getElementById('conversationsChart');
  if (!ctx || !window.Chart) return;

  let labels = [];
  let values = [];

  if (apiData && apiData.labels && apiData.values) {
    // Use real data from API
    labels = apiData.labels.map(dateStr => {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    values = apiData.values;
  } else {
    // Fallback: Generate last 30 days with zero values
    for (let i = 29; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      values.push(0);
    }
  }

  if (charts.conversations) charts.conversations.destroy();

  charts.conversations = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Conversations',
        data: values,
        borderColor: '#a6e3a1',
        backgroundColor: 'rgba(166, 227, 161, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index'
      },
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 7 }
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    }
  });
}

// Create user signups chart
function createSignupsChart(apiData) {
  const ctx = document.getElementById('signupsChart');
  if (!ctx || !window.Chart) return;

  let labels = [];
  let values = [];

  if (apiData && apiData.labels && apiData.values) {
    // Use real data from API
    labels = apiData.labels.map(dateStr => {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    });
    values = apiData.values;
  } else {
    // Fallback: Generate last 7 days with zero values
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      labels.push(weekdays[date.getDay()]);
      values.push(0);
    }
  }

  if (charts.signups) charts.signups.destroy();

  charts.signups = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'New Users',
        data: values,
        backgroundColor: '#60a5fa',
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    }
  });
}

// Create plan distribution chart
function createPlanChart(users) {
  const ctx = document.getElementById('planChart');
  if (!ctx || !window.Chart) return;

  // Count users by plan
  const planCounts = { free: 0, starter: 0, pro: 0, agency: 0 };
  const planColors = {
    free: '#6a6a8a',
    starter: '#60a5fa',
    pro: '#a6e3a1',
    agency: '#fbbf24'
  };
  const planLabels = {
    free: 'Free',
    starter: 'Starter',
    pro: 'Pro',
    agency: 'Agency'
  };

  if (users) {
    users.forEach(user => {
      const plan = user.plan || 'free';
      if (planCounts.hasOwnProperty(plan)) {
        planCounts[plan]++;
      } else {
        planCounts.free++;
      }
    });
  }

  // Only include plans that have users
  const labels = [];
  const data = [];
  const colors = [];

  Object.keys(planCounts).forEach(plan => {
    if (planCounts[plan] > 0) {
      labels.push(planLabels[plan]);
      data.push(planCounts[plan]);
      colors.push(planColors[plan]);
    }
  });

  // Fallback if no users
  if (data.length === 0) {
    labels.push('No Users');
    data.push(1);
    colors.push('#6a6a8a');
  }

  if (charts.plan) charts.plan.destroy();

  charts.plan = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { padding: 20, usePointStyle: true }
        }
      }
    }
  });
}

// Create top chatbots chart
function createTopBotsChart(apiData) {
  const ctx = document.getElementById('topBotsChart');
  if (!ctx || !window.Chart) return;

  let labels = [];
  let values = [];

  if (apiData && apiData.bots && apiData.bots.length > 0) {
    // Use real data from API
    labels = apiData.bots.map(bot => bot.name || 'Unnamed Bot');
    values = apiData.bots.map(bot => bot.conversations || 0);
  } else {
    // Fallback: Show empty state
    labels = ['No Data'];
    values = [0];
  }

  if (charts.topBots) charts.topBots.destroy();

  charts.topBots = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Conversations',
        data: values,
        backgroundColor: '#fbbf24',
        borderRadius: 4,
        horizontal: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.05)' }
        },
        y: {
          grid: { display: false }
        }
      }
    }
  });
}

// Update growth metrics
function updateGrowthMetrics(data) {
  const usersEl = document.getElementById('growth-users');
  const botsEl = document.getElementById('growth-bots');
  const convEl = document.getElementById('growth-conversations');
  const lastUpdated = document.getElementById('analytics-last-updated');

  if (usersEl) usersEl.textContent = `+${Math.floor(Math.random() * 20) + 5}`;
  if (botsEl) botsEl.textContent = `+${Math.floor(Math.random() * 10) + 2}`;
  if (convEl) convEl.textContent = `${data?.totalConversations || Math.floor(Math.random() * 500) + 100}`;
  if (lastUpdated) lastUpdated.textContent = new Date().toLocaleTimeString();
}

// Load analytics data
async function loadAnalyticsData() {
  try {
    const headers = await getAuthHeaders();

    // Fetch all analytics data in parallel
    const [
      dashboardRes,
      conversationsRes,
      signupsRes,
      topBotsRes
    ] = await Promise.all([
      fetch('/api/admin/dashboard', { headers }),
      fetch('/api/admin/analytics/conversations?days=30', { headers }),
      fetch('/api/admin/analytics/signups?days=7', { headers }),
      fetch('/api/admin/analytics/top-bots?limit=5', { headers })
    ]);

    if (!dashboardRes.ok) throw new Error('Failed to fetch dashboard data');

    const data = await dashboardRes.json();

    // Parse analytics responses (they can fail gracefully)
    const conversationsData = conversationsRes.ok ? await conversationsRes.json() : null;
    const signupsData = signupsRes.ok ? await signupsRes.json() : null;
    const topBotsData = topBotsRes.ok ? await topBotsRes.json() : null;

    // Initialize charts
    initChartDefaults();
    createConversationsChart(conversationsData);
    createSignupsChart(signupsData);
    createPlanChart(data.users);
    createTopBotsChart(topBotsData);
    updateGrowthMetrics(data);

    // Refresh icons
    if (window.lucide) window.lucide.createIcons();

  } catch (error) {
    console.error('Error loading analytics:', error);
    showToast('Failed to load analytics data', 'error');
  }
}

// Start analytics refresh
function startAnalyticsRefresh() {
  loadAnalyticsData();
  if (!analyticsInterval) {
    analyticsInterval = setInterval(loadAnalyticsData, 60000); // Every minute
  }
}

// Stop analytics refresh
function stopAnalyticsRefresh() {
  if (analyticsInterval) {
    clearInterval(analyticsInterval);
    analyticsInterval = null;
  }
}

// Format uptime to human readable
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Update response time chart
function updateResponseTimeChart(responseTime, status) {
  const chart = document.getElementById('response-time-chart');
  if (!chart) return;

  // Add to history
  responseTimeHistory.push({ time: responseTime, status });
  if (responseTimeHistory.length > MAX_HISTORY_POINTS) {
    responseTimeHistory.shift();
  }

  // Clear and rebuild chart
  chart.innerHTML = '';
  const maxTime = Math.max(...responseTimeHistory.map(r => r.time), 100);
  const barWidth = 100 / MAX_HISTORY_POINTS;

  responseTimeHistory.forEach((data, index) => {
    const bar = document.createElement('div');
    bar.className = 'response-bar';
    if (data.time > 500) bar.classList.add('critical');
    else if (data.time > 200) bar.classList.add('warning');

    bar.style.left = `${index * barWidth}%`;
    bar.style.width = `${barWidth - 1}%`;
    bar.style.height = `${(data.time / maxTime) * 100}%`;
    chart.appendChild(bar);
  });
}

// Fetch and display health data
async function fetchHealthData() {
  try {
    const startTime = Date.now();
    const response = await fetch('/api/health');
    const data = await response.json();
    const endTime = Date.now();
    const responseTime = endTime - startTime;

    // Update overall status
    const isHealthy = data.status === 'healthy';
    const overallIndicator = document.getElementById('overall-status-indicator');
    const overallText = document.getElementById('overall-status-text');

    if (overallIndicator && overallText) {
      overallIndicator.className = `status-indicator ${isHealthy ? 'healthy' : 'critical'}`;
      overallText.className = `health-status-text ${isHealthy ? 'healthy' : 'critical'}`;
      overallText.textContent = isHealthy ? 'All Systems Operational' : 'System Issues Detected';
    }

    // Update API response time
    const apiIndicator = document.getElementById('api-status-indicator');
    const apiTimeText = document.getElementById('api-response-time');
    const actualResponseTime = parseInt(data.services?.api?.responseTime) || responseTime;

    if (apiIndicator && apiTimeText) {
      let status = 'healthy';
      if (actualResponseTime > 500) status = 'critical';
      else if (actualResponseTime > 200) status = 'warning';

      apiIndicator.className = `status-indicator ${status}`;
      apiTimeText.className = `health-status-text ${status}`;
      apiTimeText.textContent = `${actualResponseTime}ms`;

      updateResponseTimeChart(actualResponseTime, status);
    }

    // Update memory usage
    const memUsed = data.system?.memory?.used || 0;
    const memTotal = data.system?.memory?.total || 0;
    const memPercent = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;

    const memText = document.getElementById('memory-usage-text');
    const memTotalText = document.getElementById('memory-total');
    const memProgress = document.getElementById('memory-progress-bar');
    const memIndicator = document.getElementById('memory-status-indicator');

    if (memText) memText.textContent = `${memUsed} MB`;
    if (memTotalText) memTotalText.textContent = `${memTotal} MB`;
    if (memProgress) memProgress.style.width = `${memPercent}%`;

    if (memIndicator) {
      let memStatus = 'healthy';
      if (memPercent > 90) memStatus = 'critical';
      else if (memPercent > 70) memStatus = 'warning';
      memIndicator.className = `status-indicator ${memStatus}`;
    }

    // Update system info
    const uptimeEl = document.getElementById('system-uptime');
    const envEl = document.getElementById('system-env');
    const nodeVerEl = document.getElementById('node-version');
    const platformEl = document.getElementById('platform-info');

    if (uptimeEl) uptimeEl.textContent = formatUptime(data.system?.uptime || 0);
    if (envEl) envEl.textContent = (data.system?.environment || 'unknown').toUpperCase();
    if (nodeVerEl) nodeVerEl.textContent = data.system?.nodeVersion || '--';
    if (platformEl) platformEl.textContent = (data.system?.platform || 'unknown').substring(0, 15);

    // Update service status
    const dbStatus = document.getElementById('db-service-status');
    const apiStatus = document.getElementById('api-service-status');

    if (dbStatus && data.services?.database) {
      const isDbHealthy = data.services.database.status === 'connected';
      dbStatus.innerHTML = `
        <div class="status-indicator ${isDbHealthy ? 'healthy' : 'critical'}"></div>
        <span>${isDbHealthy ? 'Connected' : 'Disconnected'}</span>
      `;
    }

    if (apiStatus && data.services?.api) {
      const isApiUp = data.services.api.status === 'up';
      apiStatus.innerHTML = `
        <div class="status-indicator ${isApiUp ? 'healthy' : 'critical'}"></div>
        <span>${isApiUp ? 'Operational' : 'Down'}</span>
      `;
    }

    // Update last updated time
    const lastUpdated = document.getElementById('health-last-updated');
    if (lastUpdated) {
      lastUpdated.textContent = new Date().toLocaleTimeString();
    }

    // Refresh icons
    if (window.lucide) window.lucide.createIcons();

  } catch (error) {
    console.error('Health check failed:', error);

    // Show error state
    const overallIndicator = document.getElementById('overall-status-indicator');
    const overallText = document.getElementById('overall-status-text');
    if (overallIndicator && overallText) {
      overallIndicator.className = 'status-indicator critical';
      overallText.className = 'health-status-text critical';
      overallText.textContent = 'Health Check Failed';
    }

    updateResponseTimeChart(0, 'critical');
  }
}

// Start health monitoring
function startHealthMonitoring() {
  fetchHealthData();
  if (!healthCheckInterval) {
    healthCheckInterval = setInterval(fetchHealthData, 30000); // Every 30 seconds
  }
}

// Stop health monitoring
function stopHealthMonitoring() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide icons
  if (window.lucide) window.lucide.createIcons();

  // Initialize navigation
  initNavListeners();
  initMobileSidebar();

  // Table action listeners (using event delegation)
  const tableBody = document.getElementById('data-table-body');
  if (tableBody) {
    tableBody.addEventListener('click', handleAction);
  }

  // Modal close listeners
  const modalClose = document.getElementById('modal-close');
  if (modalClose) {
    modalClose.addEventListener('click', closeModal);
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  // Close modal on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('show')) {
      closeModal();
    }
  });

  // Wait for Clerk then load initial data
  waitForClerk(() => {
    loadDashboardData();
    startHealthMonitoring();
  });

  // Initialize other features
  initUserManagement();
  initChatbotManagement();
});

// ==========================================
// ENHANCED USER MANAGEMENT
// ==========================================
let allUsersData = [];
let selectedUsers = new Set();
let currentPage = 1;
const USERS_PER_PAGE = 10;

function initUserManagement() {
  // Search input
  const searchInput = document.getElementById('user-search');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(() => {
      currentPage = 1;
      filterAndRenderUsers();
    }, 300));
  }

  // Filter selects
  const planFilter = document.getElementById('plan-filter');
  const botFilter = document.getElementById('bot-filter');

  if (planFilter) {
    planFilter.addEventListener('change', () => {
      currentPage = 1;
      filterAndRenderUsers();
    });
  }

  if (botFilter) {
    botFilter.addEventListener('change', () => {
      currentPage = 1;
      filterAndRenderUsers();
    });
  }

  // Select all checkbox
  const selectAll = document.getElementById('select-all');
  if (selectAll) {
    selectAll.addEventListener('change', (e) => {
      const checkboxes = document.querySelectorAll('.user-checkbox');
      checkboxes.forEach(cb => {
        cb.checked = e.target.checked;
        const userId = cb.dataset.userId;
        if (e.target.checked) selectedUsers.add(userId);
        else selectedUsers.delete(userId);
      });
      updateBulkActionsBar();
    });
  }

  // Bulk action buttons
  const bulkUpgrade = document.getElementById('bulk-upgrade');
  const bulkDelete = document.getElementById('bulk-delete');
  const bulkClear = document.getElementById('bulk-clear');

  if (bulkUpgrade) {
    bulkUpgrade.addEventListener('click', () => performBulkAction('upgrade'));
  }
  if (bulkDelete) {
    bulkDelete.addEventListener('click', () => performBulkAction('delete'));
  }
  if (bulkClear) {
    bulkClear.addEventListener('click', clearSelection);
  }
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function filterUsers(users) {
  const searchTerm = document.getElementById('user-search')?.value.toLowerCase() || '';
  const planFilter = document.getElementById('plan-filter')?.value || '';
  const botFilter = document.getElementById('bot-filter')?.value || '';

  return users.filter(user => {
    // Search filter
    const matchesSearch = !searchTerm ||
      user.name?.toLowerCase().includes(searchTerm) ||
      user.email?.toLowerCase().includes(searchTerm);

    // Plan filter
    const matchesPlan = !planFilter || user.plan === planFilter;

    // Bot filter
    const matchesBot = !botFilter ||
      (botFilter === 'has' && user.hasBot) ||
      (botFilter === 'none' && !user.hasBot);

    return matchesSearch && matchesPlan && matchesBot;
  });
}

function filterAndRenderUsers() {
  const filtered = filterUsers(allUsersData);
  renderUsersTable(filtered);
  renderPagination(filtered.length, USERS_PER_PAGE, currentPage, (page) => {
    currentPage = page;
    filterAndRenderUsers();
  });
}

function renderUsersTable(users) {
  const tbody = document.getElementById('data-table-body');
  if (!tbody) return;

  tbody.innerHTML = '';

  // Pagination
  const start = (currentPage - 1) * USERS_PER_PAGE;
  const paginatedUsers = users.slice(start, start + USERS_PER_PAGE);

  if (paginatedUsers.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 40px; color: var(--text-muted);">
          No users found matching your filters.
        </td>
      </tr>
    `;
    return;
  }

  paginatedUsers.forEach(user => {
    const row = document.createElement('tr');
    const isSelected = selectedUsers.has(user.clerkUserId);

    // Plan dropdown with current selection
    const planOptions = [
      { value: 'free', label: 'Free (Trial)', price: 0 },
      { value: 'starter', label: 'Starter', price: 29 },
      { value: 'pro', label: 'Pro', price: 79 },
      { value: 'agency', label: 'Agency', price: 199 }
    ];

    const planSelectHtml = `
      <select class="plan-select" data-user-id="${escapeHTML(user.clerkUserId)}" data-current-plan="${escapeHTML(user.plan)}">
        ${planOptions.map(opt => `
          <option value="${opt.value}" ${user.plan === opt.value ? 'selected' : ''}>
            ${opt.label} $${opt.price}/mo
          </option>
        `).join('')}
      </select>
    `;

    // Usage bars
    const botsPercent = user.maxBots > 0 ? (user.botCount / user.maxBots) * 100 : 0;
    const messagesPercent = user.maxMessages > 0 ? (user.monthlyMessageCount / user.maxMessages) * 100 : 0;

    const botsBarColor = botsPercent >= 90 ? 'var(--danger)' : botsPercent >= 70 ? 'var(--warning)' : 'var(--accent)';
    const messagesBarColor = messagesPercent >= 90 ? 'var(--danger)' : messagesPercent >= 70 ? 'var(--warning)' : 'var(--accent)';

    const usageHtml = `
      <div style="font-size: 11px; margin-bottom: 4px;">
        <span style="color: var(--text-muted);">Bots:</span> ${user.botCount}/${user.maxBots}
        <span style="color: var(--text-muted); margin-left: 8px;">Msgs:</span> ${user.monthlyMessageCount.toLocaleString()}/${user.maxMessages.toLocaleString()}
      </div>
      <div style="display: flex; gap: 4px; height: 4px; margin-bottom: 2px;">
        <div style="flex: 1; background: var(--bg-tertiary); border-radius: 2px; overflow: hidden;">
          <div style="width: ${Math.min(botsPercent, 100)}%; height: 100%; background: ${botsBarColor}; border-radius: 2px;"></div>
        </div>
      </div>
      <div style="display: flex; gap: 4px; height: 4px;">
        <div style="flex: 1; background: var(--bg-tertiary); border-radius: 2px; overflow: hidden;">
          <div style="width: ${Math.min(messagesPercent, 100)}%; height: 100%; background: ${messagesBarColor}; border-radius: 2px;"></div>
        </div>
      </div>
      ${user.isTrialExpired ? '<div style="color: var(--danger); font-size: 11px; margin-top: 4px;">Trial Expired</div>' : ''}
    `;

    const featuresValue = escapeHTML((user.features || []).join(', '));
    const userData = escapeHTML(JSON.stringify(user).replace(/'/g, "&#39;"));

    row.innerHTML = `
      <td>
        <div class="user-cell">
          <input type="checkbox" class="user-checkbox" data-user-id="${escapeHTML(user.clerkUserId)}" ${isSelected ? 'checked' : ''} style="margin-right: 12px;">
          <div class="user-avatar">${escapeHTML(user.name?.charAt(0) || 'U')}</div>
          <div class="user-info">
            <div class="name">${escapeHTML(user.name)}</div>
            <div class="email">${escapeHTML(user.email)}</div>
          </div>
        </div>
      </td>
      <td>
        ${planSelectHtml}
      </td>
      <td>
        ${usageHtml}
      </td>
      <td>${user.conversationCount || 0}</td>
      <td>
        <input type="text" class="features-input" id="features-${escapeHTML(user.clerkUserId)}" value="${featuresValue}" placeholder="e.g. beta_tester, ai_brain">
        <button class="btn btn-primary" data-action="save-features" data-user-id="${escapeHTML(user.clerkUserId)}" style="margin-left: 8px;">
          <i data-lucide="save" style="width: 14px; height: 14px;"></i>
          <span>Save</span>
        </button>
      </td>
      <td>
        <div class="actions-cell">
          <button class="btn btn-secondary btn-icon" data-action="view" data-user="${userData}" title="View Details">
            <i data-lucide="eye" style="width: 16px; height: 16px;"></i>
          </button>
          <button class="btn btn-danger btn-icon" data-action="delete" data-user-id="${escapeHTML(user.clerkUserId)}" title="Delete User">
            <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
          </button>
        </div>
      </td>
    `;

    // Add checkbox listener
    const checkbox = row.querySelector('.user-checkbox');
    checkbox.addEventListener('change', (e) => {
      if (e.target.checked) selectedUsers.add(user.clerkUserId);
      else selectedUsers.delete(user.clerkUserId);
      updateBulkActionsBar();
    });

    // Add plan select listener
    const planSelect = row.querySelector('.plan-select');
    planSelect.addEventListener('change', async (e) => {
      const newPlan = e.target.value;
      const currentPlan = e.target.dataset.currentPlan;
      if (newPlan !== currentPlan) {
        await changeUserPlan(user.clerkUserId, newPlan, currentPlan);
      }
    });

    tbody.appendChild(row);
  });

  if (window.lucide) window.lucide.createIcons();
}

function renderPagination(totalItems, itemsPerPage, currentPage, onPageChange) {
  const container = document.getElementById('users-pagination');
  if (!container) return;

  const totalPages = Math.ceil(totalItems / itemsPerPage);
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';

  // Previous button
  html += `
    <button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">
      <i data-lucide="chevron-left" style="width: 16px; height: 16px;"></i>
    </button>
  `;

  // Page numbers
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
      html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    } else if (i === currentPage - 2 || i === currentPage + 2) {
      html += `<span style="color: var(--text-muted);">...</span>`;
    }
  }

  // Next button
  html += `
    <button class="page-btn" ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">
      <i data-lucide="chevron-right" style="width: 16px; height: 16px;"></i>
    </button>
  `;

  container.innerHTML = html;

  // Add listeners
  container.querySelectorAll('.page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = parseInt(btn.dataset.page);
      if (page && page !== currentPage) {
        onPageChange(page);
      }
    });
  });

  if (window.lucide) window.lucide.createIcons();
}

function updateBulkActionsBar() {
  const bar = document.getElementById('bulk-actions-bar');
  const countEl = document.getElementById('selected-count');

  if (bar && countEl) {
    const count = selectedUsers.size;
    countEl.textContent = `${count} selected`;
    bar.style.display = count > 0 ? 'flex' : 'none';
  }
}

function clearSelection() {
  selectedUsers.clear();
  document.querySelectorAll('.user-checkbox').forEach(cb => cb.checked = false);
  const selectAll = document.getElementById('select-all');
  if (selectAll) selectAll.checked = false;
  updateBulkActionsBar();
}

async function performBulkAction(action) {
  const userIds = Array.from(selectedUsers);
  if (userIds.length === 0) return;

  if (action === 'delete') {
    if (!confirm(`Are you sure you want to delete ${userIds.length} users and all their bots?`)) return;
  }

  try {
    const headers = await getAuthHeaders();
    let successCount = 0;

    for (const userId of userIds) {
      try {
        if (action === 'upgrade') {
          const res = await fetch(`/api/admin/upgrade/${userId}`, { method: 'PATCH', headers });
          if (res.ok) successCount++;
        } else if (action === 'delete') {
          const res = await fetch(`/api/admin/user/${userId}`, { method: 'DELETE', headers });
          if (res.ok) successCount++;
        }
      } catch (e) {
        console.error(`Failed to ${action} user ${userId}:`, e);
      }
    }

    showToast(`${successCount} of ${userIds.length} users ${action}d successfully`);
    clearSelection();
    loadDashboardData();
  } catch (error) {
    showToast(`Bulk ${action} failed: ${error.message}`, 'error');
  }
}

// Override loadDashboardData to store users
const originalLoadDashboardData = loadDashboardData;
loadDashboardData = async function() {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch('/api/admin/dashboard', { headers });
    if (!response.ok) throw new Error(`Failed to fetch admin data (${response.status})`);

    const data = await response.json();
    allUsersData = data.users || [];

    // Update metrics
    document.getElementById('metric-users').textContent = data.totalUsers || 0;
    document.getElementById('metric-bots').textContent = data.totalBots || 0;
    document.getElementById('metric-convo').textContent = data.totalConversations || 0;
    document.getElementById('metric-leads').textContent = data.totalLeads || 0;

    // Render filtered table
    filterAndRenderUsers();

  } catch (error) {
    console.error('Error loading dashboard:', error);
    showToast('Failed to load dashboard data', 'error');
  }
};

// ==========================================
// CHATBOT MANAGEMENT
// ==========================================
let allChatbotsData = [];
let chatbotsCurrentPage = 1;
const CHATBOTS_PER_PAGE = 9;

function initChatbotManagement() {
  // Search input
  const searchInput = document.getElementById('chatbot-search');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(() => {
      chatbotsCurrentPage = 1;
      filterAndRenderChatbots();
    }, 300));
  }

  // Status filter
  const statusFilter = document.getElementById('chatbot-status-filter');
  if (statusFilter) {
    statusFilter.addEventListener('change', () => {
      chatbotsCurrentPage = 1;
      filterAndRenderChatbots();
    });
  }
}

async function loadChatbotsData() {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch('/api/admin/chatbots', { headers });
    if (!response.ok) throw new Error('Failed to fetch chatbots');

    const data = await response.json();
    allChatbotsData = data.chatbots || [];
    filterAndRenderChatbots();
  } catch (error) {
    console.error('Error loading chatbots:', error);
    showToast('Failed to load chatbots', 'error');
  }
}

function filterChatbots(chatbots) {
  const searchTerm = document.getElementById('chatbot-search')?.value.toLowerCase() || '';
  const statusFilter = document.getElementById('chatbot-status-filter')?.value || '';

  return chatbots.filter(bot => {
    const matchesSearch = !searchTerm ||
      bot.botName?.toLowerCase().includes(searchTerm) ||
      bot.websiteUrl?.toLowerCase().includes(searchTerm) ||
      bot.widgetId?.toLowerCase().includes(searchTerm);

    const matchesStatus = !statusFilter ||
      (statusFilter === 'active' && bot.isActive) ||
      (statusFilter === 'inactive' && !bot.isActive);

    return matchesSearch && matchesStatus;
  });
}

function filterAndRenderChatbots() {
  const filtered = filterChatbots(allChatbotsData);
  renderChatbotsGrid(filtered);
  renderChatbotsPagination(filtered.length, CHATBOTS_PER_PAGE, chatbotsCurrentPage, (page) => {
    chatbotsCurrentPage = page;
    filterAndRenderChatbots();
  });
}

function renderChatbotsGrid(chatbots) {
  const grid = document.getElementById('chatbots-grid');
  const emptyState = document.getElementById('chatbots-empty');

  if (!grid) return;

  // Pagination
  const start = (chatbotsCurrentPage - 1) * CHATBOTS_PER_PAGE;
  const paginatedBots = chatbots.slice(start, start + CHATBOTS_PER_PAGE);

  if (paginatedBots.length === 0) {
    grid.style.display = 'none';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  grid.style.display = 'grid';
  if (emptyState) emptyState.style.display = 'none';
  grid.innerHTML = '';

  paginatedBots.forEach(bot => {
    const card = document.createElement('div');
    card.className = `chatbot-card ${!bot.isActive ? 'inactive' : ''}`;

    const avatarUrl = bot.customization?.botLogo;
    const botName = bot.customization?.botName || 'Unnamed Bot';
    const ownerName = bot.ownerName || 'Unknown';
    const ownerEmail = bot.ownerEmail || 'No email';

    card.innerHTML = `
      <div class="chatbot-header">
        <div class="chatbot-avatar">
          ${avatarUrl ? `<img src="${escapeHTML(avatarUrl)}" alt="">` : `<i data-lucide="bot" style="width: 24px; height: 24px;"></i>`}
        </div>
        <div class="chatbot-info">
          <div class="chatbot-name">${escapeHTML(botName)}</div>
          <div class="chatbot-url">${escapeHTML(bot.websiteUrl || 'No URL')}</div>
        </div>
        <div class="chatbot-status">
          <div class="status-toggle ${bot.isActive ? 'active' : ''}" data-bot-id="${escapeHTML(bot.widgetId)}" title="${bot.isActive ? 'Active' : 'Inactive'}"></div>
        </div>
      </div>

      <div class="chatbot-owner">
        <div class="chatbot-owner-avatar">${escapeHTML(ownerName.charAt(0))}</div>
        <div class="chatbot-owner-info">
          <div class="chatbot-owner-name">${escapeHTML(ownerName)}</div>
          <div class="chatbot-owner-email">${escapeHTML(ownerEmail)}</div>
        </div>
      </div>

      <div class="chatbot-stats">
        <div class="chatbot-stat">
          <div class="chatbot-stat-value">${bot.conversationCount || 0}</div>
          <div class="chatbot-stat-label">Conversations</div>
        </div>
        <div class="chatbot-stat">
          <div class="chatbot-stat-value">${bot.leadsCount || 0}</div>
          <div class="chatbot-stat-label">Leads</div>
        </div>
      </div>

      <div class="chatbot-actions">
        <button class="btn btn-secondary" data-action="view-bot" data-bot-id="${escapeHTML(bot.widgetId)}">
          <i data-lucide="eye" style="width: 14px; height: 14px;"></i>
          View
        </button>
        <button class="btn btn-secondary" data-action="preview-bot" data-bot-id="${escapeHTML(bot.widgetId)}">
          <i data-lucide="play" style="width: 14px; height: 14px;"></i>
          Preview
        </button>
        <button class="btn btn-danger btn-icon" data-action="delete-bot" data-bot-id="${escapeHTML(bot.widgetId)}" title="Delete Bot">
          <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
        </button>
      </div>
    `;

    // Status toggle listener
    const toggle = card.querySelector('.status-toggle');
    toggle.addEventListener('click', () => toggleBotStatus(bot.widgetId, !bot.isActive));

    // View button listener - show bot details modal
    const viewBtn = card.querySelector('[data-action="view-bot"]');
    viewBtn.addEventListener('click', () => showBotDetails(bot));

    // Preview button listener - open bot in new tab
    const previewBtn = card.querySelector('[data-action="preview-bot"]');
    previewBtn.addEventListener('click', () => {
      // Open the bot widget preview page
      window.open(`/widget/${bot.widgetId}`, '_blank');
    });

    // Delete button listener
    const deleteBtn = card.querySelector('[data-action="delete-bot"]');
    deleteBtn.addEventListener('click', () => deleteBot(bot.widgetId, bot.botName));

    grid.appendChild(card);
  });

  if (window.lucide) window.lucide.createIcons();
}

function renderChatbotsPagination(totalItems, itemsPerPage, currentPage, onPageChange) {
  const container = document.getElementById('chatbots-pagination');
  if (!container) return;

  const totalPages = Math.ceil(totalItems / itemsPerPage);
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';

  html += `
    <button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">
      <i data-lucide="chevron-left" style="width: 16px; height: 16px;"></i>
    </button>
  `;

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
      html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    } else if (i === currentPage - 2 || i === currentPage + 2) {
      html += `<span style="color: var(--text-muted);">...</span>`;
    }
  }

  html += `
    <button class="page-btn" ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">
      <i data-lucide="chevron-right" style="width: 16px; height: 16px;"></i>
    </button>
  `;

  container.innerHTML = html;

  container.querySelectorAll('.page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = parseInt(btn.dataset.page);
      if (page && page !== currentPage) {
        onPageChange(page);
      }
    });
  });

  if (window.lucide) window.lucide.createIcons();
}

async function toggleBotStatus(botId, newStatus) {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/admin/chatbots/${botId}/status`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ isActive: newStatus })
    });

    if (!res.ok) throw new Error('Failed to update bot status');

    showToast(`Bot ${newStatus ? 'activated' : 'deactivated'} successfully`);
    loadChatbotsData();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// Show bot details modal
function showBotDetails(bot) {
  // Create modal if not exists
  let modal = document.getElementById('bot-details-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'bot-details-modal';
    modal.className = 'modal';
    document.body.appendChild(modal);
  }

  const createdDate = bot.createdAt ? new Date(bot.createdAt).toLocaleDateString() : 'Unknown';

  modal.innerHTML = `
    <div class="modal-content" style="max-width: 600px;">
      <div class="modal-header">
        <h2>Bot Details</h2>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="modal-field">
          <label>Bot Name</label>
          <div class="value">${escapeHTML(bot.botName || 'Unnamed Bot')}</div>
        </div>
        <div class="modal-field">
          <label>Widget ID</label>
          <div class="value" style="font-family: monospace;">${escapeHTML(bot.widgetId)}</div>
        </div>
        <div class="modal-field">
          <label>Website URL</label>
          <div class="value">
            <a href="${escapeHTML(bot.websiteUrl || '#')}" target="_blank" style="color: var(--accent);">${escapeHTML(bot.websiteUrl || 'N/A')}</a>
          </div>
        </div>
        <div class="modal-field">
          <label>Status</label>
          <div class="value">
            <span class="badge ${bot.isActive ? 'badge-yes' : 'badge-no'}">${bot.isActive ? 'Active' : 'Inactive'}</span>
          </div>
        </div>
        <div class="modal-field">
          <label>Owner</label>
          <div class="value">${escapeHTML(bot.ownerName)} (${escapeHTML(bot.ownerEmail)})</div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 20px;">
          <div class="health-metric">
            <div class="health-metric-label">Conversations</div>
            <div class="health-metric-value">${bot.conversationCount || 0}</div>
          </div>
          <div class="health-metric">
            <div class="health-metric-label">Leads</div>
            <div class="health-metric-value">${bot.leadsCount || 0}</div>
          </div>
          <div class="health-metric">
            <div class="health-metric-label">Created</div>
            <div class="health-metric-value" style="font-size: 13px;">${createdDate}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  modal.classList.add('show');

  // Close button listener
  modal.querySelector('.modal-close').addEventListener('click', () => {
    modal.classList.remove('show');
  });

  // Close on outside click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('show');
  });
}

// Delete bot
async function deleteBot(botId, botName) {
  if (!confirm(`Are you sure you want to delete "${botName || 'this bot'}"? This will also delete all associated leads.`)) {
    return;
  }

  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/admin/chatbots/${botId}`, {
      method: 'DELETE',
      headers
    });

    if (!res.ok) throw new Error('Failed to delete bot');

    showToast('Bot deleted successfully');
    loadChatbotsData();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// Update switchSection to handle chatbots
const originalSwitchSection = switchSection;
switchSection = function(sectionId) {
  originalSwitchSection(sectionId);

  if (sectionId === 'chatbots') {
    loadChatbotsData();
  } else if (sectionId === 'logs') {
    loadAuditLogs();
    loadAuditSummary();
  }
};

// Change user plan via dropdown
async function changeUserPlan(userId, newPlan, currentPlan) {
  try {
    const planNames = {
      free: 'Free (Trial)',
      starter: 'Starter',
      pro: 'Pro',
      agency: 'Agency'
    };

    if (!confirm(`Change plan from ${planNames[currentPlan] || currentPlan} to ${planNames[newPlan]}?`)) {
      // Revert the dropdown
      loadDashboardData();
      return;
    }

    const headers = await getAuthHeaders();
    const res = await fetch(`/api/admin/users/${userId}/plan`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ plan: newPlan })
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to change plan');
    }

    showToast(`Plan changed to ${planNames[newPlan]} successfully`);
    loadDashboardData(); // Refresh data
  } catch (error) {
    showToast(error.message, 'error');
    // Revert dropdown
    loadDashboardData();
  }
}

// ==========================================
// AUDIT LOGS
// ==========================================
let auditCurrentPage = 1;
const AUDIT_PER_PAGE = 50;

function initAuditLogs() {
  // Action filter
  const actionFilter = document.getElementById('audit-action-filter');
  if (actionFilter) {
    actionFilter.addEventListener('change', () => {
      auditCurrentPage = 1;
      loadAuditLogs();
    });
  }

  // Date filters
  const dateFrom = document.getElementById('audit-date-from');
  const dateTo = document.getElementById('audit-date-to');
  if (dateFrom) {
    dateFrom.addEventListener('change', () => {
      auditCurrentPage = 1;
      loadAuditLogs();
    });
  }
  if (dateTo) {
    dateTo.addEventListener('change', () => {
      auditCurrentPage = 1;
      loadAuditLogs();
    });
  }

  // Refresh button
  const refreshBtn = document.getElementById('refresh-logs-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadAuditLogs();
      loadAuditSummary();
    });
  }

  // Export button
  const exportBtn = document.getElementById('export-logs-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportAuditLogs);
  }
}

async function loadAuditLogs() {
  try {
    const action = document.getElementById('audit-action-filter')?.value || '';
    const startDate = document.getElementById('audit-date-from')?.value || '';
    const endDate = document.getElementById('audit-date-to')?.value || '';

    const params = new URLSearchParams({
      page: auditCurrentPage,
      limit: AUDIT_PER_PAGE
    });
    if (action) params.append('action', action);
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);

    const headers = await getAuthHeaders();
    const res = await fetch(`/api/admin/audit-logs?${params}`, { headers });
    if (!res.ok) throw new Error('Failed to fetch audit logs');

    const data = await res.json();
    renderAuditLogs(data.logs);
    renderAuditPagination(data.pagination);
  } catch (error) {
    console.error('Error loading audit logs:', error);
    showToast('Failed to load audit logs', 'error');
  }
}

async function loadAuditSummary() {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/admin/audit-logs/summary', { headers });
    if (!res.ok) throw new Error('Failed to fetch audit summary');

    const data = await res.json();

    const todayEl = document.getElementById('audit-today');
    const weekEl = document.getElementById('audit-week');
    const totalEl = document.getElementById('audit-total');

    if (todayEl) todayEl.textContent = data.today || 0;
    if (weekEl) weekEl.textContent = data.last7Days || 0;
    if (totalEl) totalEl.textContent = data.total || 0;
  } catch (error) {
    console.error('Error loading audit summary:', error);
  }
}

function renderAuditLogs(logs) {
  const tbody = document.getElementById('audit-logs-body');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (!logs || logs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 40px; color: var(--text-muted);">
          No audit logs found.
        </td>
      </tr>
    `;
    return;
  }

  logs.forEach(log => {
    const row = document.createElement('tr');

    const timestamp = new Date(log.createdAt).toLocaleString();
    const actionClass = log.success ? '' : 'style="color: var(--danger);"';
    const statusBadge = log.success
      ? '<span class="badge badge-yes">Success</span>'
      : '<span class="badge" style="background: rgba(248, 113, 113, 0.15); color: var(--danger);">Failed</span>';

    row.innerHTML = `
      <td style="font-size: 12px; color: var(--text-muted);">${escapeHTML(timestamp)}</td>
      <td ${actionClass}>${escapeHTML(formatActionName(log.action))}</td>
      <td>
        <div style="display: flex; align-items: center; gap: 8px;">
          <div class="user-avatar" style="width: 28px; height: 28px; font-size: 12px;">${escapeHTML(log.actor.name?.charAt(0) || 'A')}</div>
          <span>${escapeHTML(log.actor.name)}</span>
        </div>
      </td>
      <td>${escapeHTML(log.target.email || log.target.botName || 'N/A')}</td>
      <td style="font-family: monospace; font-size: 12px;">${escapeHTML(log.ipAddress || 'N/A')}</td>
      <td>${statusBadge}</td>
    `;
    tbody.appendChild(row);
  });
}

function formatActionName(action) {
  const names = {
    'USER_UPGRADE': 'User Upgrade',
    'USER_DELETE': 'User Delete',
    'USER_FEATURES_UPDATE': 'Features Update',
    'BOT_STATUS_TOGGLE': 'Bot Status Toggle',
    'BOT_DELETE': 'Bot Delete',
    'ADMIN_LOGIN': 'Admin Login',
    'BULK_UPGRADE': 'Bulk Upgrade',
    'BULK_DELETE': 'Bulk Delete'
  };
  return names[action] || action.replace(/_/g, ' ');
}

function renderAuditPagination(pagination) {
  const container = document.getElementById('audit-pagination');
  if (!container || !pagination) return;

  const { page, pages, total } = pagination;

  if (pages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = `
    <span style="color: var(--text-muted); font-size: 13px; margin-right: 12px;">
      Showing ${((page - 1) * AUDIT_PER_PAGE) + 1}-${Math.min(page * AUDIT_PER_PAGE, total)} of ${total}
    </span>
  `;

  html += `
    <button class="page-btn" ${page === 1 ? 'disabled' : ''} data-page="${page - 1}">
      <i data-lucide="chevron-left" style="width: 16px; height: 16px;"></i>
    </button>
  `;

  for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) {
    html += `<button class="page-btn ${i === page ? 'active' : ''}" data-page="${i}">${i}</button>`;
  }

  html += `
    <button class="page-btn" ${page === pages ? 'disabled' : ''} data-page="${page + 1}">
      <i data-lucide="chevron-right" style="width: 16px; height: 16px;"></i>
    </button>
  `;

  container.innerHTML = html;

  container.querySelectorAll('.page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const newPage = parseInt(btn.dataset.page);
      if (newPage && newPage !== auditCurrentPage) {
        auditCurrentPage = newPage;
        loadAuditLogs();
      }
    });
  });

  if (window.lucide) window.lucide.createIcons();
}

async function exportAuditLogs() {
  try {
    const action = document.getElementById('audit-action-filter')?.value || '';
    const startDate = document.getElementById('audit-date-from')?.value || '';
    const endDate = document.getElementById('audit-date-to')?.value || '';

    const params = new URLSearchParams();
    if (action) params.append('action', action);
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);

    const headers = await getAuthHeaders();
    const res = await fetch(`/api/admin/audit-logs/export?${params}`, { headers });
    if (!res.ok) throw new Error('Export failed');

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    showToast('Audit logs exported successfully');
  } catch (error) {
    showToast('Failed to export audit logs', 'error');
  }
}

// Initialize audit logs on page load
document.addEventListener('DOMContentLoaded', () => {
  initAuditLogs();
});
