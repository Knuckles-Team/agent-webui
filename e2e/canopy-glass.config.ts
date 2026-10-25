import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'
import { baseURL } from './fixtures/documentation-screenshots.mjs'

// Isolated from authenticated e2e config: no storage state, live URL or login setup.
export default defineConfig({
  testDir: '.',
  testMatch: [
    'canopy-glass.browser.ts',
    'native-chat.browser.ts',
    'explore-graph.browser.ts',
    'work-workflows.browser.ts',
    'operate-usage.browser.ts',
  ],
  outputDir: '../test-results/canopy-glass',
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL,
    browserName: 'chromium',
    serviceWorkers: 'block',
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
    screenshot: 'only-on-failure',
  },
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: 'pnpm exec vite --host 127.0.0.1 --port 5206 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
