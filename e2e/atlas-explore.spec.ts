import { test, expect, type Page } from '@playwright/test'

/**
 * `/explore` (Atlas) — the flagship surface's end-to-end cover.
 *
 * Exercises exactly the journey the design exists for: pick a modality, run a query,
 * and switch the renderer to 3D. A page that can do those three things is the product;
 * one that cannot is a table with extra steps, and no unit test can tell them apart —
 * the 3D path needs a real WebGL context, which jsdom does not have.
 *
 * ★ Methodology, same as `routes-smoke.spec.ts`: every test hard-fails the moment the
 * browser lands on Keycloak instead of the app. Without that assertion an unauthenticated
 * run reports green while nothing under test ever rendered (D-WUI-29).
 */

const KEYCLOAK_HOST_HINT = 'keycloak'

async function openExplore(page: Page): Promise<void> {
  await page.goto('/explore')
  expect(page.url()).not.toContain(KEYCLOAK_HOST_HINT)
  await expect(page.getByTestId('atlas-view')).toBeVisible()
}

test.describe('Atlas explorer', () => {
  test('offers more than one modality', async ({ page }) => {
    await openExplore(page)
    const picker = page.getByTestId('atlas-modality-picker')
    await expect(picker).toBeVisible()
    await expect(picker.getByTestId('atlas-modality-graph')).toBeVisible()
    await expect(picker.getByTestId('atlas-modality-sparql')).toBeVisible()
  })

  test('switches modality and swaps the console between read-only and editable', async ({ page }) => {
    await openExplore(page)
    // The KG modality has no text query language here, so its console is read-only.
    await expect(page.getByLabel('Query')).toHaveAttribute('readonly', '')
    await page.getByTestId('atlas-modality-sparql').click()
    // SPARQL does, so the same box becomes an editor.
    await expect(page.getByLabel('Query')).not.toHaveAttribute('readonly', '')
    await expect(page.getByLabel('Query')).toHaveValue(/SELECT/)
  })

  test('runs a query and renders it, then switches the renderer to 3D', async ({ page }) => {
    await openExplore(page)
    await page.getByTestId('atlas-run').click()

    // The renderer switcher appears once there is a result to draw.
    const switcher = page.getByTestId('atlas-renderer-switcher')
    await expect(switcher).toBeVisible({ timeout: 30_000 })

    const table = page.getByTestId('atlas-renderer-table')
    await expect(table).toBeEnabled()
    await table.click()
    await expect(page.getByTestId('atlas-table')).toBeVisible()

    // The claim under test: a KG result projects into a graph, so 3D is available —
    // and it must actually mount a canvas, not silently fall back to the table.
    const threeD = page.getByTestId('atlas-renderer-graph3d')
    await expect(threeD).toBeEnabled()
    await threeD.click()
    await expect(page.getByTestId('atlas-graph3d')).toBeVisible()
    await expect(page.getByTestId('atlas-graph3d').locator('canvas')).toBeVisible()
  })

  test('states an absent capability instead of rendering a blank panel', async ({ page }) => {
    await openExplore(page)
    // Either the source tree enumerated, or it says why it could not. Never neither.
    const tree = page.getByTestId('atlas-schema-tree')
    const stated = page.getByTestId('atlas-schema-unavailable')
    await expect(tree.or(stated)).toBeVisible({ timeout: 30_000 })
  })
})
