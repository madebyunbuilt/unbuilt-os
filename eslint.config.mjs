import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';

export default defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    rules: {
      // Correctness
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',

      // TypeScript
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',

      // React
      'react/self-closing-comp': 'error',
      'react/jsx-no-useless-fragment': ['error', { allowExpressions: true }],
      'react/jsx-curly-brace-presence': ['error', { props: 'never', children: 'never' }],

      // Imports
      'import/no-duplicates': 'error',
      'import/first': 'error',
      'import/newline-after-import': 'error',
    },
  },

  {
    files: ['*.config.{js,mjs,cjs,ts}'],
    rules: { 'import/no-anonymous-default-export': 'off' },
  },

  // Must stay last: turns off every rule that would fight Prettier.
  prettier,

  globalIgnores([
    '.next/**',
    '.vercel/**',
    'out/**',
    'build/**',
    'coverage/**',
    'node_modules/**',
    'next-env.d.ts',
    'public/**',
    'convex/_generated/**',
    'test-results/**',
    'playwright-report/**',
  ]),
]);
