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
        // "Private Bank" tokens (redesign/private-bank). Point at the CSS
        // variables in src/index.css so a palette tweak is one edit. Additive:
        // teal/dark above stay untouched for pages not yet restyled. Note:
        // var()-backed colours do not take Tailwind opacity modifiers.
        bank: {
          bg: 'var(--bg)',
          side: 'var(--side)',
          card: 'var(--card)',
          raise: 'var(--raise)',
          line: 'var(--line)',
          tx: 'var(--tx)',
          mu: 'var(--mu)',
          fa: 'var(--fa)',
          gold: 'var(--gold)',
          'gold-tx': 'var(--gold-tx)',
          'gold-ink': 'var(--gold-ink)',
          pos: 'var(--pos)',
          warn: 'var(--warn)',
          neg: 'var(--neg)',
        },
      },
      boxShadow: {
        card: 'var(--card-shadow)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
