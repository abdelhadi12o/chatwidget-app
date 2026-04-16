// Main index page functionality

document.addEventListener('DOMContentLoaded', async () => {
    try {
        if (window.location.protocol.startsWith('http')) {
            const response = await fetch('/api/config');
            if(response.ok) {
                const config = await response.json();

                // 1. Tell Clerk to send them directly to the dashboard after logging in!
                const dashboardUrl = encodeURIComponent(window.location.origin + '/dashboard');

                // Attach sign-in URLs
                document.querySelectorAll('[data-clerk-signin]').forEach(el => {
                    if(config.clerkSignInUrl) el.href = `${config.clerkSignInUrl}?redirect_url=${dashboardUrl}`;
                });

                // Attach sign-up URLs
                document.querySelectorAll('[data-clerk-signup]').forEach(el => {
                    if(config.clerkSignUpUrl) el.href = `${config.clerkSignUpUrl}?redirect_url=${dashboardUrl}`;
                });

                // 2. Load Clerk to process tokens
                const clerkJs = document.createElement('script');
                clerkJs.src = 'https://cdn.jsdelivr.net/npm/@clerk/clerk-js@latest/dist/clerk.browser.js';
                clerkJs.setAttribute('data-clerk-publishable-key', config.clerkPublishableKey);
                clerkJs.crossOrigin = 'anonymous';
                document.head.appendChild(clerkJs);

                clerkJs.addEventListener('load', async () => {
                    await window.Clerk.load();
                    // Removed automatic redirection to allow users to stay on the landing page
                });
            }
        }
    } catch (error) {
        console.warn('Clerk configuration could not be loaded.');
    }
});

// FAQ Toggle Logic
function toggleFaq(button) {
    const answer = button.nextElementSibling;
    const icon = button.querySelector('svg');

    // Close other open FAQs
    document.querySelectorAll('.faq-answer').forEach(el => {
        if(el !== answer && !el.classList.contains('hidden')) {
            el.classList.add('hidden');
            el.previousElementSibling.querySelector('svg').classList.remove('rotate-180');
        }
    });

    // Toggle current
    answer.classList.toggle('hidden');
    icon.classList.toggle('rotate-180');
}

// Mobile Menu Logic
const hamburgerBtn = document.getElementById('hamburger-btn');
const closeMenuBtn = document.getElementById('close-menu');
const mobileMenu = document.getElementById('mobile-menu');
const mobileMenuBackdrop = document.getElementById('mobile-menu-backdrop');
const mobileLinks = document.querySelectorAll('.mobile-link');

function toggleMobileMenu() {
    if(mobileMenu) {
        // Toggle sidebar translation
        mobileMenu.classList.toggle('translate-x-full');
        document.body.classList.toggle('overflow-hidden');

        // Toggle backdrop visibility & opacity for smooth fade
        if(mobileMenuBackdrop) {
            if(mobileMenuBackdrop.classList.contains('hidden')) {
                mobileMenuBackdrop.classList.remove('hidden');
                setTimeout(() => mobileMenuBackdrop.classList.remove('opacity-0'), 10);
            } else {
                mobileMenuBackdrop.classList.add('opacity-0');
                setTimeout(() => mobileMenuBackdrop.classList.add('hidden'), 300);
            }
        }
    }
}

if (hamburgerBtn && closeMenuBtn) {
    hamburgerBtn.addEventListener('click', toggleMobileMenu);
    closeMenuBtn.addEventListener('click', toggleMobileMenu);
}

if (mobileMenuBackdrop) {
    mobileMenuBackdrop.addEventListener('click', toggleMobileMenu);
}

if (mobileLinks) {
    mobileLinks.forEach(link => link.addEventListener('click', toggleMobileMenu));
}

// Scroll Reveal Animation Logic
function reveal() {
    var reveals = document.querySelectorAll(".reveal");
    for (var i = 0; i < reveals.length; i++) {
        var windowHeight = window.innerHeight;
        var elementTop = reveals[i].getBoundingClientRect().top;
        var elementVisible = 100;
        if (elementTop < windowHeight - elementVisible) {
            reveals[i].classList.add("active");
        }
    }
}
window.addEventListener("scroll", reveal);
// Trigger once on load
reveal();

// Checkout handler - ensures user is logged in and appends clerk_id to checkout URL
async function handleCheckout(checkoutLink) {
    console.log('[handleCheckout] Starting checkout process...');

    // 1. Wait for Clerk to be fully loaded and ready
    const waitForClerk = async (maxAttempts = 50) => {
        console.log('[waitForClerk] Starting Clerk readiness check, maxAttempts:', maxAttempts);
        let attempts = 0;
        while (attempts < maxAttempts) {
            // Safer check: Clerk exists and is ready via multiple possible indicators
            const clerkExists = !!window.Clerk;
            const clerkLoaded = window.Clerk && (window.Clerk.loaded === true);
            const clerkIsReadyFn = window.Clerk && typeof window.Clerk.isReady === 'function';
            const clerkIsReady = clerkIsReadyFn ? window.Clerk.isReady() : false;
            const clerkHasUser = window.Clerk && window.Clerk.user !== undefined;

            const isReady = clerkExists && (clerkLoaded || clerkIsReady || clerkHasUser);

            if (attempts % 10 === 0) {
                console.log('[waitForClerk] Attempt', attempts, {
                    clerkExists,
                    clerkLoaded,
                    clerkIsReadyFn,
                    clerkIsReady,
                    clerkHasUser,
                    isReady
                });
            }

            if (isReady) {
                console.log('[waitForClerk] Clerk loaded successfully on attempt', attempts);
                return true;
            }

            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        console.log('[waitForClerk] Clerk failed to load after', maxAttempts, 'attempts');
        return false;
    };

    // Show loading state
    const clickedButton = event.target.closest('a, button');
    const originalText = clickedButton ? clickedButton.innerHTML : null;
    if (clickedButton) {
        clickedButton.innerHTML = 'Loading...';
        clickedButton.style.pointerEvents = 'none';
        clickedButton.style.opacity = '0.7';
    }

    console.log('[handleCheckout] Waiting for Clerk to be ready...');
    const clerkReady = await waitForClerk();
    console.log('[handleCheckout] Clerk ready state:', clerkReady, 'window.Clerk exists:', !!window.Clerk);

    if (!clerkReady || !window.Clerk) {
        console.error('[handleCheckout] Clerk failed to load - showing alert');
        alert('Unable to connect to authentication service. Please refresh.');
        if (clickedButton) {
            clickedButton.innerHTML = originalText;
            clickedButton.style.pointerEvents = '';
            clickedButton.style.opacity = '';
        }
        return;
    }

    console.log('[handleCheckout] Clerk loaded successfully');

    // 2. Check if user is logged in
    const user = window.Clerk.user;
    console.log('[handleCheckout] User state:', user ? { id: user.id, email: user.emailAddresses?.[0]?.emailAddress } : 'not logged in');

    if (user && user.id) {
        // 3. User is logged in - append clerk_id and redirect to checkout
        const userId = user.id;
        const separator = checkoutLink.includes('?') ? '&' : '?';
        const checkoutUrlWithClerkId = `${checkoutLink}${separator}checkout[custom][clerk_id]=${encodeURIComponent(userId)}`;
        window.location.href = checkoutUrlWithClerkId;
    } else {
        // 4. User is NOT logged in - open Clerk sign up modal
        // After sign up, they'll be redirected back to this page
        window.Clerk.openSignUp({
            redirectUrl: window.location.href,
            afterSignUpUrl: window.location.href
        });

        // Restore button state
        if (clickedButton) {
            clickedButton.innerHTML = originalText;
            clickedButton.style.pointerEvents = '';
            clickedButton.style.opacity = '';
        }
    }
}
