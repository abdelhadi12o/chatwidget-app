// Clerk initialization for dashboard
(async function() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    const script = document.createElement('script');
    script.setAttribute('data-clerk-publishable-key', config.clerkPublishableKey);
    script.src = 'https://cdn.jsdelivr.net/npm/@clerk/clerk-js@latest/dist/clerk.browser.js';
    script.async = true;
    script.crossOrigin = 'anonymous';

    script.addEventListener('load', () => {
      window.dispatchEvent(new Event('clerk-loaded'));
    });

    script.addEventListener('error', () => {
      window.dispatchEvent(new Event('clerk-failed'));
    });

    document.head.appendChild(script);
  } catch(e) {
    window.dispatchEvent(new Event('clerk-failed'));
  }
})();
