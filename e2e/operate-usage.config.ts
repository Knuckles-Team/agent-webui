import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: '.',
  testMatch: ['operate-usage.browser.ts'],
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5206', browserName: 'chromium', screenshot: 'only-on-failure' },
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: 'pnpm exec vite --host 127.0.0.1 --port 5206 --strictPort',
    url: 'http://127.0.0.1:5206',
    reuseExistingServer: false,
  },
})
