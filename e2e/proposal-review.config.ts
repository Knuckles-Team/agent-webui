import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

// Synthetic channel, production control component, real sandboxed browser.
export default defineConfig({
  testDir: '.',
  testMatch: 'proposal-review.browser.ts',
  workers: 1,
  reporter: 'list',
  outputDir: process.env.PROPOSAL_RESULTS_DIR || 'test-results/proposal-review',
  use: {
    baseURL: 'http://127.0.0.1:5198',
    browserName: 'chromium',
    launchOptions: { chromiumSandbox: true },
  },
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: 'corepack pnpm exec vite --config e2e/fixtures/proposal-review/vite.config.ts',
    url: 'http://127.0.0.1:5198',
    reuseExistingServer: false,
  },
})
