// Interactivity for pricing page
function toggleFaq(button) {
    const answer = button.nextElementSibling;
    const icon = button.querySelector('svg');
    answer.classList.toggle('hidden');
    icon.classList.toggle('rotate-180');
}

const hamburgerBtn = document.getElementById('hamburger-btn');
const closeMenuBtn = document.getElementById('close-menu');
const mobileMenu = document.getElementById('mobile-menu');
const backdrop = document.getElementById('mobile-menu-backdrop');

function toggleMenu() {
    mobileMenu.classList.toggle('translate-x-full');
    document.body.classList.toggle('overflow-hidden');
    if (backdrop.classList.contains('hidden')) {
        backdrop.classList.remove('hidden');
        setTimeout(() => backdrop.classList.remove('opacity-0'), 10);
    } else {
        backdrop.classList.add('opacity-0');
        setTimeout(() => backdrop.classList.add('hidden'), 300);
    }
}

if(hamburgerBtn) hamburgerBtn.addEventListener('click', toggleMenu);
if(closeMenuBtn) closeMenuBtn.addEventListener('click', toggleMenu);
if(backdrop) backdrop.addEventListener('click', toggleMenu);

function reveal() {
    document.querySelectorAll(".reveal").forEach(el => {
        if (el.getBoundingClientRect().top < window.innerHeight - 100) el.classList.add("active");
    });
}
window.addEventListener("scroll", reveal);
reveal();

// Checkout handler - redirects with clerk_id if logged in
async function handleCheckout(checkoutLink) {
    const clickedButton = event.target.closest('a, button');
    const originalText = clickedButton ? clickedButton.innerHTML : null;
    if (clickedButton) {
        clickedButton.innerHTML = 'Loading...';
        clickedButton.style.pointerEvents = 'none';
        clickedButton.style.opacity = '0.7';
    }

    // Wait for clerk-ready flag or event
    const clerkReady = await new Promise((resolve) => {
        if (window.clerkReady) {
            resolve(true);
            return;
        }
        if (window.Clerk && window.Clerk.load && window.Clerk.user !== undefined) {
            resolve(true);
            return;
        }
        window.addEventListener('clerk-loaded', () => resolve(true), { once: true });
        setTimeout(() => resolve(false), 8000);
    });

    if (!clerkReady || !window.Clerk) {
        alert('Unable to connect to authentication service. Please refresh.');
        if (clickedButton) {
            clickedButton.innerHTML = originalText;
            clickedButton.style.pointerEvents = '';
            clickedButton.style.opacity = '';
        }
        return;
    }

    // If Clerk exists but not yet loaded, load it
    if (!window.clerkReady && window.Clerk.load) {
        try {
            await window.Clerk.load();
        } catch(e) {
            alert('Unable to connect to authentication service. Please refresh.');
            if (clickedButton) {
                clickedButton.innerHTML = originalText;
                clickedButton.style.pointerEvents = '';
                clickedButton.style.opacity = '';
            }
            return;
        }
    }

    const user = window.Clerk.user;

    if (user && user.id) {
        const userId = user.id;
        const separator = checkoutLink.includes('?') ? '&' : '?';
        const checkoutUrlWithClerkId = `${checkoutLink}${separator}checkout[custom][clerk_id]=${encodeURIComponent(userId)}`;
        window.location.href = checkoutUrlWithClerkId;
    } else {
        window.location.href = '/pricing?login=true';
        if (clickedButton) {
            clickedButton.innerHTML = originalText;
            clickedButton.style.pointerEvents = '';
            clickedButton.style.opacity = '';
        }
    }
}
