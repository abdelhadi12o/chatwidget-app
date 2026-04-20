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
function showToast(message, isError = false) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toast.style.backgroundColor = isError ? '#f87171' : '#333';
  document.getElementById('toast-container').appendChild(toast);

  setTimeout(() => {
    toast.classList.add('show');
    setTimeout(() => {
      toast.remove();
    }, 3000);
  }, 100);
}

// Helper: get fresh Clerk session token
async function getAuthHeaders() {
  const token = await window.Clerk.session?.getToken();
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

// Fetch and populate dashboard data
async function loadDashboardData() {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch('/api/admin/dashboard', { headers });
    if (!response.ok) throw new Error(`Failed to fetch admin data (${response.status})`);

    const data = await response.json();

    // Update metrics
    document.getElementById('metric-users').textContent = data.totalUsers;
    document.getElementById('metric-bots').textContent = data.totalBots;
    document.getElementById('metric-convo').textContent = data.totalConversations;
    document.getElementById('metric-leads').textContent = data.totalLeads;

    // Populate table
    const tbody = document.getElementById('data-table-body');
    tbody.innerHTML = '';

    data.users.forEach(user => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${escapeHTML(user.name)}</td>
        <td>${escapeHTML(user.email)}</td>
        <td>${escapeHTML(user.plan)}</td>
        <td>${user.hasBot ? 'Yes' : 'No'}</td>
        <td>${user.conversationCount}</td>
        <td>
          <input type="text" class="features-input" id="features-${user.clerkUserId}" value="${escapeHTML((user.features || []).join(', '))}" placeholder="e.g. beta_tester, ai_brain" style="background: #1e1e2e; border: 1px solid #3a3a47; border-radius: 4px; color: #d6d6e6; padding: 6px 10px; font-size: 13px; width: 180px;">
          <button class="actions-button" onclick="saveFeatures('${user.clerkUserId}')" style="margin-left: 8px;">Save</button>
        </td>
        <td>
          <button class="actions-button view-btn" data-user='${JSON.stringify(user).replace(/'/g, "&#39;")}'>View</button>
          <button class="actions-button" data-user-id="${user.clerkUserId}" data-action="upgrade">→ Pro</button>
          <button class="actions-button" data-user-id="${user.clerkUserId}" data-action="delete">Delete</button>
        </td>
      `;
      tbody.appendChild(row);
    });

    // Action button listeners
    document.querySelectorAll('.actions-button').forEach(button => {
      button.addEventListener('click', async (e) => {
        const userId = e.target.dataset.userId;
        const action = e.target.dataset.action;

        try {
          const headers = await getAuthHeaders();
          if (action === 'upgrade') {
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
          }
        } catch (error) {
          showToast(error.message, true);
        }
      });
    });
  } catch (error) {
    console.error('Error loading dashboard:', error);
    showToast('Failed to load dashboard data', true);
  }
}

// Modal functionality
const modal = document.getElementById('user-modal');
const modalClose = document.getElementById('modal-close');

// Handle View button clicks
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('view-btn')) {
    try {
      const userData = JSON.parse(e.target.dataset.user);
      // Populate modal fields
      document.getElementById('modal-user-name').textContent = userData.name || 'Unknown';
      document.getElementById('modal-user-email').textContent = userData.email || 'No email';
      document.getElementById('modal-user-plan').textContent = userData.plan || 'free';
      document.getElementById('modal-user-joined').textContent = userData.joinedAt || 'Unknown';
      document.getElementById('modal-user-lastactive').textContent = userData.lastActive || 'Never';
      document.getElementById('modal-user-location').textContent = userData.location || 'Unknown (Requires IP API)';
      document.getElementById('modal-user-bots').textContent = userData.botNames || 'No bots';
      // Show modal
      modal.classList.add('show');
    } catch (error) {
      console.error('Error parsing user data:', error);
      showToast('Failed to load user details', true);
    }
  }
});

// Close modal on X click
if (modalClose) {
  modalClose.addEventListener('click', () => {
    modal.classList.remove('show');
  });
}

// Close modal on outside click
modal?.addEventListener('click', (e) => {
  if (e.target === modal) {
    modal.classList.remove('show');
  }
});

// Save user features
async function saveFeatures(userId) {
  try {
    const input = document.getElementById(`features-${userId}`);
    const featuresText = input.value;

    // Split by commas and trim whitespace
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
    showToast(error.message, true);
  }
}
