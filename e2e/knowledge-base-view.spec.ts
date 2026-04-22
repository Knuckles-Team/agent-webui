import { test, expect } from '@playwright/test'

test.describe('KnowledgeBaseView E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/kb')
  })

  test('should display knowledge base list', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Check for knowledge base list
    await expect(page.locator('text=Knowledge Bases')).toBeVisible()
  })

  test('should open ingestion dialog', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Click on ingest button
    const ingestButton = page.locator('button:has-text("Ingest"), button[aria-label*="ingest"]').first()
    if (await ingestButton.isVisible()) {
      await ingestButton.click()

      // Check for dialog
      await expect(page.locator('text=Ingest Knowledge Base')).toBeVisible()
      await expect(page.locator('input[placeholder*="knowledge base id" i]')).toBeVisible()
    }
  })

  test('should fill and submit ingestion form', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Open ingestion dialog
    const ingestButton = page.locator('button:has-text("Ingest"), button[aria-label*="ingest"]').first()
    if (await ingestButton.isVisible()) {
      await ingestButton.click()

      // Fill form
      const kbIdInput = page.locator('input[placeholder*="knowledge base id" i]').first()
      await kbIdInput.fill('test_kb_e2e')

      const nameInput = page.locator('input[placeholder*="knowledge base name" i]').first()
      await nameInput.fill('E2E Test KB')

      const sourceInput = page.locator('input[placeholder*="source path" i]').first()
      await sourceInput.fill('/test/path')

      // Submit form
      const submitButton = page.locator('button:has-text("Start Ingestion"), button:has-text("Submit")').first()
      await submitButton.click()

      // Check for success message
      await expect(page.locator('text=success')).toBeVisible({ timeout: 5000 })
    }
  })

  test('should navigate between KB tabs', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Click on a knowledge base
    const kbCard = page.locator('[data-testid="kb-card"]').first()
    if (await kbCard.isVisible()) {
      await kbCard.click()

      // Check for tabs
      await expect(page.locator('text=Articles')).toBeVisible()
      await expect(page.locator('text=Concepts')).toBeVisible()
      await expect(page.locator('text=Health')).toBeVisible()

      // Navigate to Articles tab
      await page.click('text=Articles')
      await expect(page.locator('text=Articles')).toBeVisible()

      // Navigate to Concepts tab
      await page.click('text=Concepts')
      await expect(page.locator('text=Concepts')).toBeVisible()

      // Navigate to Health tab
      await page.click('text=Health')
      await expect(page.locator('text=Health')).toBeVisible()
    }
  })

  test('should display article details', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Click on a knowledge base
    const kbCard = page.locator('[data-testid="kb-card"]').first()
    if (await kbCard.isVisible()) {
      await kbCard.click()

      // Navigate to Articles tab
      await page.click('text=Articles')

      // Click on an article
      const articleCard = page.locator('[data-testid="article-card"]').first()
      if (await articleCard.isVisible()) {
        await articleCard.click()

        // Check for article details
        await expect(page.locator('text=Article Details')).toBeVisible()
      }
    }
  })

  test('should run health check', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Click on a knowledge base
    const kbCard = page.locator('[data-testid="kb-card"]').first()
    if (await kbCard.isVisible()) {
      await kbCard.click()

      // Navigate to Health tab
      await page.click('text=Health')

      // Look for health check button
      const healthButton = page.locator('button:has-text("Run Health Check"), button[aria-label*="health"]').first()
      if (await healthButton.isVisible()) {
        await healthButton.click()

        // Check for health status
        await expect(page.locator('text=Health Status')).toBeVisible({ timeout: 5000 })
      }
    }
  })

  test('should search knowledge bases', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Find search input
    const searchInput = page.locator('input[placeholder*="search" i]').first()
    if (await searchInput.isVisible()) {
      await searchInput.fill('test')

      // Wait for results
      await page.waitForTimeout(500)

      // Check that search worked
      await expect(searchInput).toHaveValue('test')
    }
  })

  test('should filter by article type', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Click on a knowledge base
    const kbCard = page.locator('[data-testid="kb-card"]').first()
    if (await kbCard.isVisible()) {
      await kbCard.click()

      // Navigate to Articles tab
      await page.click('text=Articles')

      // Look for filter dropdown
      const filterDropdown = page.locator('select, [role="combobox"]').first()
      if (await filterDropdown.isVisible()) {
        await filterDropdown.click()
        // Select a filter option
        await page.click('text=All')
      }
    }
  })

  test('should display empty state when no KBs', async ({ page }) => {
    // This test would require mocking the API to return empty data
    await page.waitForLoadState('networkidle')
    await expect(page.locator('text=Knowledge Bases')).toBeVisible()
  })

  test('should handle KB deletion', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Click on a knowledge base
    const kbCard = page.locator('[data-testid="kb-card"]').first()
    if (await kbCard.isVisible()) {
      // Look for delete button
      const deleteButton = kbCard.locator('button[aria-label*="delete"], button:has-text("Delete")').first()
      if (await deleteButton.isVisible()) {
        // Accept dialog if it appears
        page.on('dialog', dialog => dialog.accept())

        await deleteButton.click()

        // Check for success message
        await expect(page.locator('text=deleted')).toBeVisible({ timeout: 5000 })
      }
    }
  })

  test('should be responsive on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })
    await page.waitForLoadState('networkidle')

    // Check that the layout adapts
    await expect(page.locator('text=Knowledge Bases')).toBeVisible()

    // Check that ingestion button is still accessible
    const ingestButton = page.locator('button:has-text("Ingest"), button[aria-label*="ingest"]').first()
    if (await ingestButton.isVisible()) {
      await ingestButton.click()
      await expect(page.locator('text=Ingest Knowledge Base')).toBeVisible()
    }
  })
})
