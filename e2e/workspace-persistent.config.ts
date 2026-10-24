import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'workspace-persistent.browser.ts',
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5204', browserName: 'chromium' },
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: 'corepack pnpm exec vite --host 127.0.0.1 --port 5204 --strictPort',
    url: 'http://127.0.0.1:5204',
    reuseExistingServer: false,
  },
})
