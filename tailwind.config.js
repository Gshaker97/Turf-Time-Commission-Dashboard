/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        teal: {
          DEFAULT: '#00b894',
          dark: '#00a381',
          light: '#1fd1a8',
        },
        dark: {
          DEFAULT: '#1a1a1a',
          nav: '#1e1e1e',
          card: '#242424',
          surface: '#2a2a2a',
          lighter: '#2e2e2e',
          border: '#333333',
          muted: '#3a3a3a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
