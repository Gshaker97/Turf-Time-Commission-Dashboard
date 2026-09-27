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

  // The Apps Scripts were UNLINTED, and it cost a two-day sync outage.
  // Refactoring the excluded-reps check deleted `const repLc`, which was still
  // read 80 lines below in the create branch. Nothing caught it: `.gs` files
  // are not bundled by Vite, so the build is silent on them, and the runtime
  // error only fires when there is a NEW deal to import — so the script looks
  // healthy until the moment it matters. `no-undef` finds this instantly.
  //
  // These scripts run on Apps Script's V8 runtime: script-scoped, no modules,
  // with Google's service objects as globals. They also share top-level names
  // across files (each .gs is one scope), so `no-redeclare` would be noise —
  // it is off, and the rules stay narrow on purpose.
  {
    files: ['scripts/**/*.gs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.es2021,
        SpreadsheetApp: 'readonly', PropertiesService: 'readonly', UrlFetchApp: 'readonly',
        Logger: 'readonly', LockService: 'readonly', Utilities: 'readonly',
        MailApp: 'readonly', GmailApp: 'readonly', DriveApp: 'readonly',
        Session: 'readonly', ScriptApp: 'readonly', CacheService: 'readonly',
        HtmlService: 'readonly', ContentService: 'readonly', console: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      // OFF here, unlike src/. There the rule guards a real TDZ throw: a
      // module-scope `const` read above its declaration. An Apps Script file
      // is ONE script scope where top-level `var`s hoist, and the config
      // block deliberately assigns SCH_RATES / SCH_PAY_RULE / SCH_KNOWN_OFFICES
      // from functions defined above their declarations — safe, and flagging
      // it would only train us to ignore the output. `no-undef` is the rule
      // doing the work here; it is the one that catches a deleted variable.
      'no-use-before-define': 'off',
      'no-redeclare': 'off',
      'no-unused-vars': 'off',
    },
  },
]
