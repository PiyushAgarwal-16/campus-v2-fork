import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Shared ESLint flat config for Campusly V2.
 * Enforces the TypeScript rules from CODING_STANDARDS.md §13.2:
 * strict typing, no unjustified `any`, intent-revealing code.
 * Prettier handles formatting, so style rules are disabled via `prettier`.
 */
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/build/**', '**/.next/**', '**/node_modules/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  prettier,
);
