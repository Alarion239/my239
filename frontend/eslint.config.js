import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**'] },

  // Web app: browser globals, React rules.
  {
    files: ['web/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },

  // Shared package: platform-agnostic. Enforce the native-safety contract by
  // banning DOM globals so a violation fails lint/CI instead of breaking the
  // future React Native build. fetch/Response are allowed (present on native).
  {
    files: ['shared/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'No DOM in @my239/shared — keep it native-safe (see README).' },
        { name: 'document', message: 'No DOM in @my239/shared — keep it native-safe (see README).' },
        { name: 'localStorage', message: 'Use the TokenStore port instead — @my239/shared stays native-safe.' },
        { name: 'sessionStorage', message: 'Use a port instead — @my239/shared stays native-safe.' },
      ],
    },
  },

  // Tests may use node + vitest globals.
  {
    files: ['**/*.test.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
  },
)
