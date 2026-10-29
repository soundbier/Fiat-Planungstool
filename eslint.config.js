import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'dist-e2e/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'public/**/*.js'],
    languageOptions: { globals: globals.browser }
  },
  {
    files: ['public/boot-error.js'],
    languageOptions: { sourceType: 'script', ecmaVersion: 5 }
  },
  {
    files: ['*.config.js', 'test/**/*.js', 'test-rules/**/*.js', 'e2e/**/*.js'],
    languageOptions: { globals: globals.node }
  },
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error'
    }
  },
  { files: ['public/boot-error.js'], rules: { 'no-var': 'off' } }
];
