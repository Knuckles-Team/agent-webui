import { defineConfig } from '@playwright/test'
import { readFileSync } from 'node:fs'

// Supply the real composed static host; this test must never start Vite dev.
const baseURL = process.env.PLAYWRIGHT_BASE_URL
if (!baseURL) throw new Error('PLAYWRIGHT_BASE_URL must name a locally served production build')
const tokenFile = process.env.PLAYWRIGHT_SYNTHETIC_TOKEN_FILE

export default defineConfig({
  testDir: '.',
  testMatch: 'workspace-cold-entry.browser.ts',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    browserName: 'chromium',
    reducedMotion: 'reduce',
    extraHTTPHeaders: tokenFile ? { Authorization: `Bearer ${readFileSync(tokenFile, 'utf8').trim()}` } : {},
  },
})
