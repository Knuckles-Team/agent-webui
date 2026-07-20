import { test, expect } from '@playwright/test'

/**
 * Workflow Editor E2E (D9).
 *
 * Mirrors the lightweight, backend-tolerant pattern of graph-view.spec.ts: it
 * loads the route and asserts the editor chrome (canvas + palette + toolbar)
 * renders. Capability/workflow API calls degrade gracefully so the canvas still
 * renders without a live backend.
 */
test.describe('Workflow Editor E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/workflows')
  })

  test('renders the canvas, palette and toolbar', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Palette is always present (control-flow entries are static).
    await expect(page.getByTestId('palette-item-step')).toBeVisible()
    await expect(page.getByTestId('palette-item-router')).toBeVisible()

    // The React Flow canvas mounts.
    await expect(page.getByTestId('workflow-canvas')).toBeVisible()

    // Toolbar actions.
    await expect(page.getByRole('button', { name: /run/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /save/i })).toBeVisible()
  })

  test('exposes the workflow name input', async ({ page }) => {
    await page.waitForLoadState('networkidle')
    await expect(page.getByLabel('workflow name')).toBeVisible()
  })
})
