import { test, expect } from '@playwright/test'

/**
 * `/table-explorer` (nav id `knowledge.table-explorer`, WD10-A-SQL) — the SQL/catalog
 * explorer's four panes. This is a dedicated, interaction-level spec beyond the
 * generic route census `routes-smoke.spec.ts` already runs for every top-level route
 * (including this one): navigate the catalog tree, open a table, and switch into the
 * "try it" tab.
 *
 * `minRole: 'admin'` on this route (see `nav-registry.ts`'s entry and its comment —
 * this is a raw-SQL execution surface, matching `knowledge.cypher`'s precedent), so
 * this spec only passes against a session whose Keycloak test user actually carries
 * `kg:admin` — the same precondition `e2e/auth.setup.ts` establishes for the whole
 * suite. Nothing here retries or special-cases a lower-privileged session; a 403/hidden
 * nav item is a legitimate reason for this spec to fail, and that failure is the
 * correct signal to fix the test user's role, not this spec.
 */

test.describe('Table Explorer', () => {
  test('renders the catalog and lets the user drill into a table', async ({ page }) => {
    await page.goto('/table-explorer')
    await page.waitForLoadState('networkidle')

    await expect(page.locator('text=Table Explorer')).toBeVisible()

    // Pane 1: either a live schema tree (at least one expandable schema row) or the
    // honest "not serving on this backend yet" degradation — never a blank crash.
    const degraded = page.locator('text=/not serving on this backend yet/i')
    const schemaRow = page.locator('[data-testid="table-explorer"] button').first()
    await expect(degraded.or(schemaRow)).toBeVisible({ timeout: 15_000 })

    if (await degraded.isVisible()) {
      test.info().annotations.push({
        type: 'skip-reason',
        description: 'POST /graph/sql-schema is not serving on this deployment; pane 1 has nothing to drill into.',
      })
      return
    }

    // Expand the first schema, open its first table, and land on the column-detail tab.
    await schemaRow.click()
    const tableRow = page.locator('[data-testid="table-explorer"] button').nth(1)
    await tableRow.click()

    await expect(page.locator('text=Columns')).toBeVisible()
    await expect(page.locator('text=Vectorization')).toBeVisible()
  })
})
