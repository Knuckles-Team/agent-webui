import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'workspace-viewport.browser.ts',
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5197', browserName: 'chromium' },
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: 'corepack pnpm exec vite --host 127.0.0.1 --port 5197',
    url: 'http://127.0.0.1:5197',
    reuseExistingServer: false,
  },
})
