
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Segoe UI', 'Tahoma', 'Geneva', 'Verdana', 'sans-serif'],
      },
      colors: {
        primary: 'var(--color-primary)', 
        secondary: 'var(--color-secondary)',
        background: 'var(--color-background)',
        textMain: 'var(--color-text)',
      }
    },
  },
  plugins: [],
}
