import base from '@campusly/config/eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Web ESLint flat config — shared base (CODING_STANDARDS.md §13.2) plus the
 * Next.js core-web-vitals rules and React Hooks rules. Unifies the monorepo on
 * ESLint 9 flat config (api/web/packages all use the same engine).
 */
export default [
  ...base,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      '@next/next': nextPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
      // These rules rely on context.getAncestors(), removed in ESLint 9; the
      // Next 14 plugin hasn't migrated them. Page/Document checks are still
      // enforced by `next build`. Re-enable when on a Next plugin with ESLint 9 support.
      '@next/next/no-duplicate-head': 'off',
      '@next/next/no-page-custom-font': 'off',
    },
  },
  {
    ignores: ['.next/**', 'next-env.d.ts'],
  },
];
