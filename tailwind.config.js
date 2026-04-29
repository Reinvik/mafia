/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'poker-green': '#1E4D2B',
        'poker-dark': '#0F2916',
        'poker-gold': '#D4AF37',
      },
      backgroundImage: {
        'felt': "url('https://www.transparenttextures.com/patterns/felt.png')"
      }
    },
  },
  plugins: [],
}
