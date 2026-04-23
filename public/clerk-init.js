// Clerk initialization for pages
(async () => {
    try {
        if (!window.location.protocol.startsWith('http')) return;

        const response = await fetch('/api/config');
        if (!response.ok) {
            console.error('[clerk-init] Config fetch failed:', response.status);
            document.querySelectorAll('[data-clerk-signin], [data-clerk-signup]').forEach(el => {
                el.href = '/dashboard';
            });
            return;
        }

        const config = await response.json();

        const clerkScript = document.createElement('script');
        clerkScript.src = 'https://cdn.jsdelivr.net/npm/@clerk/clerk-js@latest/dist/clerk.browser.js';
        clerkScript.setAttribute('data-clerk-publishable-key', config.clerkPublishableKey);
        clerkScript.async = true;
        clerkScript.crossOrigin = 'anonymous';
        document.head.appendChild(clerkScript);

        await new Promise((resolve, reject) => {
            clerkScript.addEventListener('load', resolve);
            clerkScript.addEventListener('error', () => {
                console.error('[clerk-init] Failed to load Clerk library');
                reject(new Error('Clerk load failed'));
            });
        });

        await window.Clerk.load({
            publishableKey: config.clerkPublishableKey,
            signInUrl: config.clerkSignInUrl,
            signUpUrl: config.clerkSignUpUrl,
        });

        window.clerkReady = true;
        window.dispatchEvent(new Event('clerk-loaded'));

        const dashboardUrl = encodeURIComponent(window.location.origin + '/dashboard');

        document.querySelectorAll('[data-clerk-signin]').forEach(el => {
            el.href = config.clerkSignInUrl + '?redirect_url=' + dashboardUrl;
        });

        document.querySelectorAll('[data-clerk-signup]').forEach(el => {
            el.href = config.clerkSignUpUrl + '?redirect_url=' + dashboardUrl;
        });
    } catch (error) {
        console.error('[clerk-init] Failed:', error);
        document.querySelectorAll('[data-clerk-signin], [data-clerk-signup]').forEach(el => {
            el.href = '/dashboard';
        });
    }
})();
