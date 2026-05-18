/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Warm, human red — the Raktify brand hero colour.
        rk: {
          50: '#fff5f3',
          100: '#ffe7e1',
          200: '#ffccc0',
          300: '#ffa794',
          400: '#fb7458',
          500: '#ef4a32',
          600: '#dc2f1d',
          700: '#b8231a',
          800: '#971f1b',
          900: '#7c1d1b',
        },
        // Warm neutral surfaces — replaces cold slate on the landing page.
        cream: '#fdf8f4',
        sand: '#f5ece4',
      },
      fontFamily: {
        sans: ['Inter', '"Noto Sans Devanagari"', 'system-ui', 'sans-serif'],
        display: ['Inter', '"Noto Sans Devanagari"', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '70%,100%': { transform: 'scale(1.6)', opacity: '0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.7s cubic-bezier(0.16,1,0.3,1) both',
        'fade-in': 'fade-in 0.8s ease-out both',
        float: 'float 6s ease-in-out infinite',
        'pulse-ring': 'pulse-ring 2.4s cubic-bezier(0.16,1,0.3,1) infinite',
      },
      boxShadow: {
        soft: '0 2px 8px -2px rgba(124,29,27,0.08), 0 10px 28px -10px rgba(124,29,27,0.14)',
        lift: '0 16px 48px -16px rgba(124,29,27,0.30)',
      },
    },
  },
  plugins: [],
};
