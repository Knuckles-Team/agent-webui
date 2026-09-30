import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

// A separate synthetic component suite; the authenticated live suite stays intact.
export default defineConfig({
  testDir: '.',
  testMatch: 'accessibility.spec.ts',
  workers: 1,
  outputDir: process.env.ACCESSIBILITY_RESULTS_DIR || '/tmp/webui-accessibility-results',
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5195', browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHROME_CHANNEL },
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: 'corepack pnpm exec vite --config e2e/fixtures/accessibility/vite.config.ts',
    url: 'http://127.0.0.1:5195',
    reuseExistingServer: false,
  },
})
