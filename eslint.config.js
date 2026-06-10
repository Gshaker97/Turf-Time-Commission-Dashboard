// Minimal lint — exists to catch the one bug class Vite builds can't:
// referencing an identifier that was never imported/defined (e.g. using
// dealAmounts without importing it builds fine but white-screens at runtime).
// Keep this lean; it is not a style linter.
import globals from 'globals'

export default [
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
    },
  },
]
