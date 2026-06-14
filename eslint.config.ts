import pluginJs from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier/flat'
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended'
import globals from 'globals'
import neostandard from 'neostandard'
import tseslint from 'typescript-eslint'
import { defineConfig } from 'eslint/config'

export default defineConfig(
  pluginJs.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  neostandard({ noJsx: true, noStyle: true }),
  eslintPluginPrettierRecommended,
  eslintConfigPrettier,
  { files: ['src/**/*.{js,mjs,cjs,ts,tsx}', '*.{js,mjs,cjs,ts,tsx}'] },
  {
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      'server/**',
      'node_modules/**',
      '**/.venv/**',
      'scratch/**',
      'agent/**',
      // Playwright e2e specs + config live outside the app's TS build project
      // (their own tooling/tsconfig), so the typed lint can't resolve them.
      'e2e/**',
      'playwright.config.ts',
      'commitlint.config.js',
      'vitest.config.ts',
      'vite.config.ts',
    ],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allow: [{ name: ['Error', 'URL', 'URLSearchParams'], from: 'lib' }],
          allowAny: true,
          allowBoolean: true,
          allowNullish: true,
          allowNumber: true,
          allowRegExp: true,
        },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-void': ['error', { allowAsStatement: true }],
    },
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Test & e2e code legitimately uses mocks, fixtures, and assertions that the
    // strict type-checked preset flags as "technically valid but unnecessary".
    // typescript-eslint recommends relaxing these for test files rather than
    // contorting mock setup — production code keeps the full strict baseline.
    files: [
      '**/__tests__/**',
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
      'src/**/setup.ts',
      'e2e/**',
      'playwright.config.ts',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
)
