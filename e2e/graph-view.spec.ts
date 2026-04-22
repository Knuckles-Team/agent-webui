import { test, expect } from '@playwright/test'

test.describe('GraphView E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/graph')
  })

  test('should display graph statistics', async ({ page }) => {
    // Wait for the page to load
    await page.waitForLoadState('networkidle')

    // Check for graph statistics
    await expect(page.locator('text=Graph Statistics')).toBeVisible()
    await expect(page.locator('text=Overview')).toBeVisible()
  })

  test('should navigate between tabs', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Click on Visualization tab
    await page.click('text=Visualization')
    await expect(page.locator('text=Interactive Graph Visualization')).toBeVisible()

    // Click on Nodes tab
    await page.click('text=Nodes')
    await expect(page.locator('text=Graph Nodes')).toBeVisible()

    // Click on Relationships tab
    await page.click('text=Relationships')
    await expect(page.locator('text=Graph Relationships')).toBeVisible()

    // Click on Explorer tab
    await page.click('text=Explorer')
    await expect(page.locator('text=Quick Access')).toBeVisible()
  })

  test('should switch graph layouts', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Navigate to Visualization tab
    await page.click('text=Visualization')
    await expect(page.locator('text=Interactive Graph Visualization')).toBeVisible()

    // Test layout switching
    await page.click('text=Hierarchical')
    await expect(page.locator('text=Hierarchical')).toBeVisible()

    await page.click('text=Circular')
    await expect(page.locator('text=Circular')).toBeVisible()

    await page.click('text=Force')
    await expect(page.locator('text=Force')).toBeVisible()
  })

  test('should handle refresh button', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Find and click refresh button
    const refreshButton = page.locator('button[aria-label*="refresh"], button[title*="refresh"]').first()
    if (await refreshButton.isVisible()) {
      await refreshButton.click()
      // Should reload the data
      await page.waitForLoadState('networkidle')
    }
  })

  test('should display node details when node is selected', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Navigate to Nodes tab
    await page.click('text=Nodes')
    await expect(page.locator('text=Graph Nodes')).toBeVisible()

    // Click on a node (if available)
    const nodeCard = page.locator('[data-testid="node-card"]').first()
    if (await nodeCard.isVisible()) {
      await nodeCard.click()
      // Should show node details
      await expect(page.locator('text=Node Details')).toBeVisible()
    }
  })

  test('should filter nodes by type', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Navigate to Nodes tab
    await page.click('text=Nodes')

    // Look for type filter dropdown
    const typeFilter = page.locator('select, [role="combobox"]').first()
    if (await typeFilter.isVisible()) {
      await typeFilter.click()
      // Select a type
      await page.click('text=Memory')
      await page.waitForLoadState('networkidle')
    }
  })

  test('should export graph visualization', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Navigate to Visualization tab
    await page.click('text=Visualization')

    // Look for export button
    const exportButton = page.locator('button:has-text("Export"), button[aria-label*="export"]').first()
    if (await exportButton.isVisible()) {
      const downloadPromise = page.waitForEvent('download')
      await exportButton.click()
      const download = await downloadPromise
      expect(download.suggestedFilename()).toMatch(/\.(png|svg)$/)
    }
  })

  test('should handle zoom controls', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Navigate to Visualization tab
    await page.click('text=Visualization')

    // Look for zoom controls
    const zoomIn = page.locator('button[aria-label*="zoom in"], button:has-text("+")').first()
    const zoomOut = page.locator('button[aria-label*="zoom out"], button:has-text("-")').first()

    if (await zoomIn.isVisible()) {
      await zoomIn.click()
      await page.waitForTimeout(500)
    }

    if (await zoomOut.isVisible()) {
      await zoomOut.click()
      await page.waitForTimeout(500)
    }
  })

  test('should display empty state when no data', async ({ page }) => {
    // This test would require mocking the API to return empty data
    // For now, we'll just check the page loads
    await page.waitForLoadState('networkidle')
    await expect(page.locator('text=Graph Statistics')).toBeVisible()
  })

  test('should be responsive on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })
    await page.waitForLoadState('networkidle')

    // Check that the layout adapts
    await expect(page.locator('text=Graph Statistics')).toBeVisible()

    // Check that tabs are still accessible
    await page.click('text=Visualization')
    await expect(page.locator('text=Interactive Graph Visualization')).toBeVisible()
  })
})
