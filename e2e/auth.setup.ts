import path from 'node:path'
import { test as setup, expect } from '@playwright/test'

/**
 * Playwright's standard "setup project" auth pattern
 * (https://playwright.dev/docs/auth#basic-shared-account-in-all-tests): this
 * spec is wired as its own `setup` project in `playwright.config.ts`, which
 * every browser project depends on (`dependencies: ['setup']`) and whose
 * `storageState` output every browser project reuses. No bespoke mechanism —
 * this drives the REAL Keycloak Authorization-Code+PKCE hosted login form
 * with a non-interactive test credential, exactly the way a human signs in.
 *
 * Background (register item D-WUI-29): the first live run of this suite
 * against `au.example` produced 68 failures across every route at both desktop
 * and mobile viewports, and 100% of them were the Keycloak login page — the
 * suite had no auth setup at all, so every navigation redirected to
 * Keycloak and every assertion failed against a login form instead of the
 * app. That run also revealed a methodology trap: a route census spec
 * "passed" 39/39 despite every route landing on the login wall, because
 * nothing asserted on the redirect. This file exists to close both gaps at
 * once — establish a real session AND prove, with a decisive assertion
 * against real page content, that the session actually works before any
 * other spec is trusted to run.
 *
 * Credential source — environment only, never hardcoded or committed:
 *   E2E_KEYCLOAK_USERNAME / E2E_KEYCLOAK_PASSWORD
 *
 * `agent-webui`'s browser client (`agent-webui` in
 * `scripts/provision_identity.py`) is provisioned with
 * `directAccessGrantsEnabled: false` — a Resource-Owner-Password grant is
 * not available for this client and is not the intended flow anyway; the
 * interactive hosted-login-form walk below is the standard, correct path
 * for a confidential authorization-code client and is what a real browser
 * does.
 *
 * If no credential is present in the environment, this setup fails loudly
 * and immediately instead of letting the suite silently proceed to
 * reproduce D-WUI-29's noise. Provisioning a suitable non-interactive
 * credential (a dedicated, minimally-scoped test user in the `homelab`
 * realm) is an operator decision, not something this suite invents for
 * itself — see the D-WUI-29 register entry and the SL5 UI-validation audit
 * for the current state of that decision.
 */

const authFile = path.join(process.cwd(), 'playwright/.auth/user.json')

setup('authenticate against Keycloak', async ({ page }) => {
  const username = process.env.E2E_KEYCLOAK_USERNAME
  const password = process.env.E2E_KEYCLOAK_PASSWORD

  if (!username || !password) {
    throw new Error(
      '[auth.setup] E2E_KEYCLOAK_USERNAME / E2E_KEYCLOAK_PASSWORD are not set in ' +
        'the environment. Refusing to run the suite unauthenticated against a live, ' +
        'OIDC-gated deployment: every route would redirect to the Keycloak login page ' +
        'and every assertion would fail against a login form instead of the app ' +
        '(see register item D-WUI-29). Provide a dedicated, non-interactive test-user ' +
        'credential via the environment — never hardcode or commit one.',
    )
  }

  await page.goto('/')

  // Unauthenticated navigation is redirected by the app's own OIDC gate
  // (agent/agent_webui/oidc_session.py) to /auth/login, which the app then
  // sends on to Keycloak's hosted Authorization Code + PKCE login form.
  await page.waitForURL(/\/realms\/[^/]+\/protocol\/openid-connect\/auth/, {
    timeout: 30_000,
  })

  await page.locator('#username, input[name="username"]').first().fill(username)
  await page.locator('#password, input[name="password"]').first().fill(password)
  await page.locator('#kc-login, button[type="submit"], input[type="submit"]').first().click()

  // Land back on the app's own origin — not merely "no longer on Keycloak",
  // which a Keycloak-hosted error page would also satisfy.
  await page.waitForURL((url) => !url.hostname.includes('keycloak'), {
    timeout: 30_000,
  })

  // *** The decisive check this task exists to demand ***
  // D-WUI-29's whole finding was that a suite can report green while every
  // route is actually a login form, because nothing asserted on real page
  // content. Do not trust the redirect alone: navigate to a known route and
  // assert its own real heading. NOTE: this originally asserted on
  // `text=Graph Statistics`, copied from `graph-view.spec.ts` on the
  // assumption that spec was a reliable reference — it is not. That whole
  // spec (and 3 of the other 4 pre-existing specs) predate a GraphView
  // redesign and assert on headings/tabs/testids that no longer exist
  // anywhere in `src/` (grepped: zero hits). The current, real heading
  // `GraphView.tsx` renders is "Unified Graph Workspace" — asserting on
  // that instead. Until THIS passes, every other number this suite
  // produces is meaningless.
  await page.goto('/graph')
  await page.waitForURL((url) => !url.hostname.includes('keycloak'), {
    timeout: 15_000,
  })
  await expect(page.locator('text=Unified Graph Workspace')).toBeVisible({ timeout: 15_000 })

  await page.context().storageState({ path: authFile })
})
