// Clerk initialization for pages
document.addEventListener('DOMContentLoaded', async () => {
    try {
        if (!window.location.protocol.startsWith('http')) return;

        const response = await fetch('/api/config');
        if (!response.ok) {
            console.error('[clerk-init] Config fetch failed:', response.status);
            // Set fallback: redirect to dashboard for manual auth
            document.querySelectorAll('[data-clerk-signin], [data-clerk-signup]').forEach(el => {
                el.href = '/dashboard';
            });
            return;
        }

        const config = await response.json();
        const dashboardUrl = encodeURIComponent(window.location.origin + '/dashboard');

        document.querySelectorAll('[data-clerk-signin]').forEach(el => {
            el.href = config.clerkSignInUrl + '?redirect_url=' + dashboardUrl;
        });

        document.querySelectorAll('[data-clerk-signup]').forEach(el => {
            el.href = config.clerkSignUpUrl + '?redirect_url=' + dashboardUrl;
        });
    } catch (error) {
        console.error('[clerk-init] Failed:', error);
        // Set fallback: redirect to dashboard for manual auth
        document.querySelectorAll('[data-clerk-signin], [data-clerk-signup]').forEach(el => {
            el.href = '/dashboard';
        });
    }
});
