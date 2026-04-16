// Tailwind configuration
tailwind.config = {
    theme: {
        extend: {
            colors: {
                bg: '#080d14',
                surface: '#0f1823',
                primary: '#06b6d4',
                accent: '#3b82f6',
                text: '#f8fafc',
                muted: '#94a3b8',
                border: '#1e293b',
                success: '#10b981',
            },
            fontFamily: {
                clash: ['Clash Display', 'sans-serif'],
                satoshi: ['Satoshi', 'sans-serif'],
            },
            animation: {
                'marquee': 'marquee 30s linear infinite',
                'float': 'float 6s ease-in-out infinite',
            },
            keyframes: {
                marquee: {
                    '0%': { transform: 'translateX(0%)' },
                    '100%': { transform: 'translateX(-50%)' }
                },
                float: {
                    '0%, 100%': { transform: 'translateY(0)' },
                    '50%': { transform: 'translateY(-20px)' },
                }
            }
        }
    }
};
