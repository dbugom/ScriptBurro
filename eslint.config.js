import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['**/dist/**', '**/node_modules/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser, ...globals.node, chrome: 'readonly', browser: 'readonly' } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_|^s$|^a$|^sender$', caughtErrors: 'none' }], 'no-empty': ['error', { allowEmptyCatch: true }] }
  },
  { files: ['**/*.inject.js'], languageOptions: { sourceType: 'script' } }
];
