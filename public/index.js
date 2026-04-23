// Index page interactivity

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
