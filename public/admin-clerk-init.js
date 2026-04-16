// Load Clerk dynamically using the working pattern from dashboard.html
async function loadClerk() {
  try {
    // 1. Fetch config from backend
    const configRes = await fetch('/api/config');
    const config = await configRes.json();

    // 2. Dynamically load Clerk JS from CDN (exact pattern that works)
    const clerkJs = document.createElement('script');
    clerkJs.src = 'https://cdn.jsdelivr.net/npm/@clerk/clerk-js@latest/dist/clerk.browser.js';
    clerkJs.setAttribute('data-clerk-publishable-key', config.clerkPublishableKey);
    clerkJs.crossOrigin = 'anonymous';
    clerkJs.async = true;
    document.head.appendChild(clerkJs);

    await new Promise((resolve) => clerkJs.addEventListener('load', resolve));

    // 3. Initialize Clerk (wait for window.Clerk to be available)
    if (!window.Clerk) {
      throw new Error('Clerk library not loaded');
    }

    // Clerk auto-initializes from the data attribute, but we can also explicitly load
    await window.Clerk.load({
      publishableKey: config.clerkPublishableKey,
      signInUrl: config.clerkSignInUrl,
      signUpUrl: config.clerkSignUpUrl,
    });

    // 4. Ensure user is signed in before showing admin UI
    if (!window.Clerk.user) {
      window.location.href = config.clerkSignInUrl || '/sign-in';
      return;
    }

    console.log('✅ Clerk loaded, user:', window.Clerk.user.emailAddresses[0]?.emailAddress);

    // 5. Now load dashboard
    loadDashboardData();
  } catch (e) {
    console.error('Failed to load Clerk:', e);
    showToast('Authentication failed - please sign in', true);
  }
}

// Initialize Clerk on load
document.addEventListener('DOMContentLoaded', loadClerk);
