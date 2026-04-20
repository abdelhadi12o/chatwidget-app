// Interactivity for contact page
const hamburgerBtn = document.getElementById('hamburger-btn');
const closeMenuBtn = document.getElementById('close-menu');
const mobileMenu = document.getElementById('mobile-menu');
const backdrop = document.getElementById('mobile-menu-backdrop');

function toggleMenu() {
    if (!mobileMenu) return;
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

if (hamburgerBtn) hamburgerBtn.addEventListener('click', toggleMenu);
if (closeMenuBtn) closeMenuBtn.addEventListener('click', toggleMenu);
if (backdrop) backdrop.addEventListener('click', toggleMenu);

// Scroll Reveal Animation
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
reveal();

// Form Logic
const form = document.getElementById('contactForm');
const successMsg = document.getElementById('successMessage');
const subjectField = document.getElementById('subjectField');

if (form) {
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        form.classList.add('hidden');
        if (successMsg) successMsg.classList.remove('hidden');
    });
}

function resetForm() {
    if (form) form.reset();
    if (successMsg) successMsg.classList.add('hidden');
    if (form) form.classList.remove('hidden');
    if (subjectField) subjectField.value = "";
}

function requestDemo() {
    if (subjectField) {
        subjectField.value = 'Demo Request';
        form.scrollIntoView({ behavior: 'smooth', block: 'center' });
        subjectField.classList.add('ring-2', 'ring-primary', 'bg-primary/10');
        setTimeout(() => {
            subjectField.classList.remove('ring-2', 'ring-primary', 'bg-primary/10');
        }, 1500);
    }
}
