import { test, expect } from '@playwright/test'
import { ROUTES } from '../src/lib/nav-registry'

/**
 * Full-registry route census + `nav-registry.ts` mobile-declaration
 * cross-check (register item D-WUI-29, task D-WUI-29 "make the browser
 * validation suite actually able to test the application").
 *
 * Iterates every top-level route in `ROUTES` (skipping `:param` drill-down
 * routes, which need a real entity id and aren't top-level destinations —
 * see the docstring on `routesBySection` in `nav-registry.ts`) and, for
 * each, records what actually happened against the live app: whether it
 * rendered, whether it crashed, whether the layout overflows the viewport,
 * and whether any of that matches the route's own declared
 * `mobile: 'full' | 'adapted' | 'unsupported'`.
 *
 * Desktop vs. mobile coverage comes from running this file under both the
 * `chromium`/`Mobile Chrome` (or `chromium-desktop`/`chromium-mobile` on a
 * real-browser host) projects — no viewport is set by hand here, so each
 * project's own device preset drives it, consistent with the rest of this
 * suite.
 *
 * ★ Methodology fix for the exact trap this item was filed over: the first
 * version of this spec (SL5, 2026-08-06, D-WUI-29) reported 39/39 "passed"
 * while every route was silently sitting on the Keycloak login page,
 * because nothing asserted on the redirect. This version hard-fails a route
 * the moment it lands on Keycloak instead of the app — that is the one
 * assertion that makes every other result in this file trustworthy.
 */

const KEYCLOAK_HOST_HINT = 'keycloak'
const CRASH_TEXT = 'Something went wrong'

const topLevelRoutes = ROUTES.filter((route) => !route.path.includes(':'))

for (const route of topLevelRoutes) {
  test(`route census: ${route.id} (${route.path})`, async ({ page }, testInfo) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(String(err)))

    // NOTE (found live, D-WUI-29): this used to listen for `page.on('response', ...)`
    // and match it against `new URL(route.path, page.url() || 'http://x')`. On a
    // fresh page (before the first navigation), `page.url()` is `'about:blank'`,
    // which is truthy — so `|| 'http://x'` never kicked in — and the WHATWG URL
    // constructor throws `TypeError: Invalid URL` when given `about:blank` as a
    // base for a relative path. That fired on the very first response of every
    // single route census, failing all 38 tests with a harness bug rather than a
    // real app finding, before any of the assertions below ever ran. `page.goto()`
    // already returns the navigation's own Response — using that directly is both
    // simpler and correct (each route census test gets a fresh page per Playwright's
    // default test isolation, so this really is the top-level navigation response).
    let httpStatus: number | null = null
    let navError: string | null = null
    try {
      const response = await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      httpStatus = response?.status() ?? null
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {
        // Some views hold a live/streaming connection open (charts, chat) and will
        // never go idle — not itself a failure signal, so don't fail the test on it.
      })
    } catch (err) {
      navError = String(err)
    }

    const finalUrl = page.url()
    const redirectedToLogin = finalUrl.includes(KEYCLOAK_HOST_HINT)

    // *** The decisive assertion this spec exists to make ***
    // If auth didn't actually hold, every other observation below is
    // meaningless — fail fast and say exactly why, rather than recording a
    // false "rendered fine" the way the pre-auth version of this file did.
    expect(
      redirectedToLogin,
      `route ${route.id} (${route.path}) redirected to Keycloak (${finalUrl}) instead of ` +
        'rendering the app — the authenticated session did not hold for this route.',
    ).toBe(false)

    const crashed = await page
      .locator(`text=${CRASH_TEXT}`)
      .isVisible()
      .catch(() => false)

    const viewport = page.viewportSize()
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    const overflowPx = viewport ? Math.max(0, scrollWidth - viewport.width) : 0
    // Small tolerance for scrollbar-width rounding; anything past that is a
    // real horizontal-overflow signal, not noise.
    const hasSignificantOverflow = overflowPx > 8

    const isMobileProject = /mobile|pixel|iphone/i.test(testInfo.project.name)

    await testInfo.attach('route-report.json', {
      body: JSON.stringify(
        {
          routeId: route.id,
          path: route.path,
          declaredMobile: route.mobile,
          project: testInfo.project.name,
          isMobileProject,
          finalUrl,
          redirectedToLogin,
          httpStatus,
          navError,
          crashed,
          viewport,
          scrollWidth,
          overflowPx,
          hasSignificantOverflow,
          consoleErrors,
          pageErrors,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    })

    // Real app bugs: never acceptable regardless of the mobile declaration.
    expect.soft(navError, `${route.id}: navigation error`).toBeNull()
    expect.soft(crashed, `${route.id}: error boundary fired ("${CRASH_TEXT}")`).toBe(false)

    if (isMobileProject) {
      // The mobile-declaration cross-check: a route claiming 'full' or
      // 'adapted' promises a usable mobile layout. 'unsupported' explicitly
      // does not, so overflow there is not treated as a fresh finding —
      // just recorded in the attachment above.
      if (route.mobile !== 'unsupported') {
        expect
          .soft(
            hasSignificantOverflow,
            `${route.id}: declared mobile='${route.mobile}' but overflows the viewport by ` +
              `${overflowPx}px — the nav-registry declaration does not match reality.`,
          )
          .toBe(false)
      }
    }
  })
}
