/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        teal: {
          400: '#2dd4bf',
          500: '#00D4AA',
          600: '#00b894',
        },
        cyan: {
          400: '#00A3FF',
        },
        nexlink: {
          teal: '#00D4AA',
          blue: '#00A3FF',
        },
      },
      fontFamily: {
        grotesk: ['Space Grotesk', 'sans-serif'],
      },
      keyframes: {
        spin_once: {
          '0%':   { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        spin_once: 'spin_once 0.5s ease-in-out',
      },
    },
  },
  plugins: [],
};
