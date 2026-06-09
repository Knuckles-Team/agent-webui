/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // Only collect Vitest unit/integration specs under src. The Playwright
    // e2e specs live in ./e2e and are driven by `pnpm test:e2e` — without an
    // explicit include the default glob also picks up the Playwright specs and
    // errors (no Playwright runner inside the Vitest process).
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.venv/**',
      'e2e/**',
    ],
    // Give jsdom a concrete base URL so components issuing relative fetches
    // (e.g. `fetch('/api/enhanced/...')`) resolve under undici/jsdom instead of
    // throwing "Failed to parse URL".
    environmentOptions: {
      jsdom: {
        url: 'http://localhost',
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'src/__tests__/',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.spec.ts',
        '**/*.spec.tsx',
        '**/dist/',
        '**/coverage/',
        '**/types/',
        '**/*.config.*',
        '**/vite.config.*',
      ],
      include: ['src/**/*.{ts,tsx}'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
    setupFiles: ['./src/__tests__/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // Keep a SINGLE React instance under jsdom (shared with react-dom,
    // @tanstack/react-query, @xyflow/react, etc.). See note below — the real
    // breakage was a duplicate physical `react` copy in node_modules; this
    // dedupe is the belt-and-braces guard for the Vite module graph.
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
})
