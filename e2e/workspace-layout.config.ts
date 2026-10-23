import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5196'
// Synthetic read-only API fixtures against the real app, not authenticated live acceptance.
export default defineConfig({
  testDir: '.',
  testMatch: ['workspace-layout.spec.ts', 'workspace-task-lifecycle.spec.ts'],
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results/workspace-layout',
  use: { baseURL, browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHROME_CHANNEL },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        command: 'corepack pnpm exec vite --host 127.0.0.1 --port 5196',
        url: baseURL,
        reuseExistingServer: false,
      },
})
