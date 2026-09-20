// Minimal lint — exists to catch the bug classes Vite builds can't:
//  • referencing an identifier that was never imported/defined (e.g. using
//    dealAmounts without importing it builds fine but white-screens at runtime)
//  • reading a const/let declared LATER in the same scope. This builds and
//    only throws when the line actually runs, so it white-screened the Leads
//    page in production: a useMemo read `scoped` two hooks above where
//    `scoped` was declared. Hoisted function declarations are exempt — the
//    codebase relies on those.
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
      'no-use-before-define': ['error', { variables: true, functions: false, classes: false }],
      'no-unused-vars': ['warn', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
    },
  },
]
