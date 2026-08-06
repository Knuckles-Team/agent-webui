import { defineConfig, devices } from '@playwright/test'

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * `PLAYWRIGHT_BASE_URL` switches the whole suite from "build and drive a
 * local `pnpm run dev` server" (the default, unchanged) to "drive an
 * already-running deployment" (e.g. `https://au.arpa` from a real-browser
 * validation host) — no separate, uncommitted config file needed for that;
 * one config, one standard mechanism, as Playwright intends.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173'
const isLiveTarget = !!process.env.PLAYWRIGHT_BASE_URL

/**
 * Storage state produced by the `setup` project (`e2e/auth.setup.ts`), which
 * drives a real Keycloak Authorization-Code+PKCE login. Every non-setup
 * project below depends on `setup` and reuses this file — Playwright's
 * standard shared-auth pattern
 * (https://playwright.dev/docs/auth#basic-shared-account-in-all-tests).
 * See D-WUI-29: without this, every route redirects to the Keycloak login
 * page and the suite produces zero signal about the application.
 */
const authFile = 'playwright/.auth/user.json'

/**
 * Optional Chrome channel override (e.g. `PLAYWRIGHT_CHROME_CHANNEL=chrome`
 * on a host that has system Google Chrome installed but no downloaded
 * Playwright browser binaries — a real-browser validation client). Unset in
 * CI/local dev, which keeps using Playwright's bundled Chromium as before.
 */
const chromeChannel = process.env.PLAYWRIGHT_CHROME_CHANNEL || undefined

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [['html'], ['list'], ['junit', { outputFile: 'test-results/junit.xml' }]],
  /* Shared settings for all tests below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL,

    /* The homelab's private CA isn't in every client's trust store; only
     * relaxed when actually pointed at a live deployment. */
    ignoreHTTPSErrors: isLiveTarget,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Screenshot on failure */
    screenshot: 'only-on-failure',

    /* Video on failure */
    video: 'retain-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    /* Runs once, before every project below (`dependencies: ['setup']`),
     * and produces the storageState they all share. See e2e/auth.setup.ts. */
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },

    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: chromeChannel, storageState: authFile },
      dependencies: ['setup'],
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], storageState: authFile },
      dependencies: ['setup'],
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], storageState: authFile },
      dependencies: ['setup'],
    },

    /* Test against mobile viewports. */
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'], channel: chromeChannel, storageState: authFile },
      dependencies: ['setup'],
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'], storageState: authFile },
      dependencies: ['setup'],
    },
  ],

  /* Run the local dev server before starting the tests — skipped entirely
   * when PLAYWRIGHT_BASE_URL points at an already-running deployment. */
  webServer: isLiveTarget
    ? undefined
    : {
        command: 'pnpm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      },
})
