import pluginJs from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier/flat'
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import globals from 'globals'
import neostandard from 'neostandard'
import tseslint from 'typescript-eslint'
import { defineConfig } from 'eslint/config'

export default defineConfig(
  pluginJs.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  neostandard({ noJsx: true, noStyle: true }),
  // Accessibility lint: a class of defect no complexity or type tool can see
  // (missing alt text, unlabeled controls, non-interactive elements wired to
  // click handlers, etc.). `flatConfigs.recommended` ships its rules at
  // `error`. The initial sweep of this repo found 94 findings (76
  // label-has-associated-control, 6 no-static-element-interactions, 6
  // click-events-have-key-events, 3 no-autofocus, 1 no-redundant-roles) --
  // real defects, but too many to fix as a side effect of a gate-adoption
  // lane and too many to land at `error` without bricking every commit that
  // touches an unrelated line in one of the affected files (the same
  // "absolute gate on existing debt blocks everything" trap this repo's own
  // `lint` hook comment names for the pre-existing eslint errors). Every rule
  // in the recommended set stays ENABLED -- none disabled, no baseline file --
  // just downgraded uniformly from `error` to `warn` so the count is visible
  // on every run and a NEW instance still shows up, without blocking commits
  // on the existing 94 today.
  jsxA11y.flatConfigs.recommended,
  {
    // Downgrade every ENABLED recommended rule from `error` to `warn`,
    // preserving its options and leaving rules the preset itself turned
    // `off` (anchor-ambiguous-text, control-has-associated-label,
    // label-has-for) alone -- a naive `[rule, 'warn']` over every key would
    // have turned those back ON, which is not what "downgrade" means.
    rules: Object.fromEntries(
      Object.entries(jsxA11y.flatConfigs.recommended.rules ?? {})
        .filter(([, config]) => (Array.isArray(config) ? config[0] : config) !== 'off')
        .map(([rule, config]) => [
          rule,
          Array.isArray(config) ? ['warn', ...config.slice(1)] : 'warn',
        ]),
    ),
  },
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
      // scripts/ (pre-commit hook entries, GOC-28's no-fabrication gate) is
      // plain Node ESM run directly via `node scripts/*.mjs`, not part of
      // `tsconfig.json`'s `include` -- same "outside the TS build project"
      // reason as e2e/ above, not a suppression of anything real (scripts/
      // previously held only .py files, which eslint never covered anyway).
      'scripts/**',
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
