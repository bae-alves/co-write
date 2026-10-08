import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * Architecture rules (MVI + Repository). See apps/desktop/src/renderer/src/features/README.md.
 *  - Only `repository.ts` may touch the outside world.
 *  - view → intent → (model, repository); never the other way round.
 */
const outsideWorldGlobals = [
  'fetch',
  'WebSocket',
  'XMLHttpRequest',
  'EventSource',
  'localStorage',
  'sessionStorage',
  'indexedDB',
].map((name) => ({ name, message: 'Outside-world access belongs in a feature repository.ts.' }))

const forbidImports = (...groups) => ({
  'no-restricted-imports': [
    'error',
    { patterns: groups.map(([group, message]) => ({ group: [group], message })) },
  ],
})

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/out/**', '**/dist/**', '**/build/**', 'apps/server/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-globals': ['error', ...outsideWorldGlobals],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'api',
          message: 'window.api is reached only via a repository.ts.',
        },
        {
          object: 'globalThis',
          property: 'fetch',
          message: 'Outside-world access belongs in a feature repository.ts.',
        },
      ],
    },
  },
  // The one place that may touch the outside world.
  {
    files: [
      'apps/desktop/src/renderer/**/repository.ts',
      'apps/desktop/src/renderer/**/repository.test.ts',
    ],
    rules: { 'no-restricted-globals': 'off', 'no-restricted-properties': 'off' },
  },
  // Model: pure state + DFA. No React, no intents, no repositories.
  {
    files: ['apps/desktop/src/renderer/**/model.ts'],
    rules: forbidImports(
      ['react', 'Models are framework-free state.'],
      ['react-dom*', 'Models are framework-free state.'],
      ['**/intent', 'Models never call intents.'],
      ['**/repository', 'Only intents may use repositories.'],
      ['**/view', 'Models never know about views.'],
    ),
  },
  // View: passive. Reads the model, fires intents. Never touches repositories or creates stores.
  {
    files: ['apps/desktop/src/renderer/**/view.tsx'],
    rules: forbidImports(
      ['**/repository', 'Views never use repositories; fire an intent instead.'],
      ['zustand', 'Views read models; they do not create stores.'],
    ),
  },
  // Intent: no UI.
  {
    files: ['apps/desktop/src/renderer/**/intent.ts'],
    rules: forbidImports(
      ['react', 'Intents are UI-free.'],
      ['react-dom*', 'Intents are UI-free.'],
      ['**/view', 'Intents never know about views.'],
    ),
  },
  // Repository: leaf. Knows nothing about the rest of the feature.
  {
    files: ['apps/desktop/src/renderer/**/repository.ts'],
    rules: forbidImports(
      ['react', 'Repositories are UI-free.'],
      ['**/model', 'Repositories do not know about models.'],
      ['**/intent', 'Repositories do not know about intents.'],
      ['**/view', 'Repositories do not know about views.'],
    ),
  },
)
