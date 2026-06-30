// Flat ESLint config. Goal: enforce the codebase's discipline (strict TS, ~no
// `any`) without a noisy big-bang. Stylistic rules are delegated to Prettier
// (eslint-config-prettier disables them). Discipline rules start as 'warn' so the
// gate is adoptable; ratchet to 'error' over time.

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist', 'runtime-dist', 'release', 'node_modules', 'scripts/.smoke', 'demo'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Project-wide severity tuning (overrides the recommended presets).
  {
    rules: {
      // TypeScript already checks undefined identifiers (and knows browser/node
      // globals) far better than this rule — the standard call for TS projects.
      'no-undef': 'off',
      // The codebase deliberately uses comma-expressions (e.g. `return (e.preventDefault(), undo())`).
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
      'prefer-const': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },

  // React hooks/refresh discipline (editor only).
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // The Figma REST API and the runtime emitter are intentionally untyped.
  { files: ['src/figma.ts', 'runtime/emitter.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },

  // Electron main/preload are CommonJS and legitimately use require().
  { files: ['electron/**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },

  prettier,
)
