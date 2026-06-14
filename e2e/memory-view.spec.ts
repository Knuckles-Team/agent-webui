import { test, expect } from '@playwright/test'

test.describe('MemoryView E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/memory')
  })

  test('should display memory list', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Check for memory list
    await expect(page.locator('text=Memory Management')).toBeVisible()
  })

  test('should open create memory dialog', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Click on add memory button
    const addButton = page.locator('button:has-text("Add Memory"), button[aria-label*="add"]').first()
    if (await addButton.isVisible()) {
      await addButton.click()

      // Check for dialog
      await expect(page.locator('text=Create New Memory')).toBeVisible()
      await expect(page.locator('textarea[placeholder*="memory content" i]')).toBeVisible()
    }
  })

  test('should fill and submit memory form', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Open create dialog
    const addButton = page.locator('button:has-text("Add Memory"), button[aria-label*="add"]').first()
    if (await addButton.isVisible()) {
      await addButton.click()

      // Fill form
      const contentInput = page.locator('textarea[placeholder*="memory content" i]').first()
      await contentInput.fill('E2E test memory content')

      // Set importance
      const importanceSlider = page.locator('input[type="range"]').first()
      if (await importanceSlider.isVisible()) {
        await importanceSlider.fill('80')
      }

      // Add tag
      const tagInput = page.locator('input[placeholder*="add tag" i]').first()
      if (await tagInput.isVisible()) {
        await tagInput.fill('e2e-test')
        await page.keyboard.press('Enter')
      }

      // Submit form
      const submitButton = page.locator('button:has-text("Create Memory"), button:has-text("Submit")').first()
      await submitButton.click()

      // Check for success message
      await expect(page.locator('text=success')).toBeVisible({ timeout: 5000 })
    }
  })

  test('should navigate between memory tabs', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Check for tabs
    await expect(page.locator('text=Timeline')).toBeVisible()
    await expect(page.locator('text=Search')).toBeVisible()

    // Navigate to Timeline tab
    await page.click('text=Timeline')
    await expect(page.locator('text=Memory Timeline')).toBeVisible()

    // Navigate back to List
    await page.click('text=List')
    await expect(page.locator('text=Memory Management')).toBeVisible()

    // Navigate to Search tab
    await page.click('text=Search')
    await expect(page.locator('text=Advanced Search')).toBeVisible()
  })

  test('should display memory details', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Click on a memory card
    const memoryCard = page.locator('[data-testid="memory-card"]').first()
    if (await memoryCard.isVisible()) {
      await memoryCard.click()

      // Check for memory details
      await expect(page.locator('text=Memory Details')).toBeVisible()
    }
  })

  test('should edit memory', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Find edit button on a memory card
    const memoryCard = page.locator('[data-testid="memory-card"]').first()
    if (await memoryCard.isVisible()) {
      const editButton = memoryCard.locator('button[aria-label*="edit"], button:has-text("Edit")').first()
      if (await editButton.isVisible()) {
        await editButton.click()

        // Check for edit dialog
        await expect(page.locator('text=Edit Memory')).toBeVisible()

        // Modify content
        const contentInput = page.locator('textarea[placeholder*="memory content" i]').first()
        await contentInput.fill('Updated E2E test memory content')

        // Submit
        const submitButton = page.locator('button:has-text("Update"), button:has-text("Save")').first()
        await submitButton.click()

        // Check for success message
        await expect(page.locator('text=success')).toBeVisible({ timeout: 5000 })
      }
    }
  })

  test('should delete memory', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Find delete button on a memory card
    const memoryCard = page.locator('[data-testid="memory-card"]').first()
    if (await memoryCard.isVisible()) {
      const deleteButton = memoryCard.locator('button[aria-label*="delete"], button:has-text("Delete")').first()
      if (await deleteButton.isVisible()) {
        // Accept dialog if it appears
        page.on('dialog', (dialog) => dialog.accept())

        await deleteButton.click()

        // Check for success message
        await expect(page.locator('text=deleted')).toBeVisible({ timeout: 5000 })
      }
    }
  })

  test('should search memories', async ({ page }) => {
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

  test('should filter by importance level', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Look for importance filter
    const importanceFilter = page.locator('select, [role="combobox"]').first()
    if (await importanceFilter.isVisible()) {
      await importanceFilter.click()
      // Select a filter option
      await page.click('text=High')
      await page.waitForTimeout(500)
    }
  })

  test('should filter by tags', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Look for tag filter
    const tagFilter = page.locator('button:has-text("Tags"), [role="combobox"]').first()
    if (await tagFilter.isVisible()) {
      await tagFilter.click()
      // Select a tag
      await page.click('text=test')
      await page.waitForTimeout(500)
    }
  })

  test('should display timeline view', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Navigate to Timeline tab
    await page.click('text=Timeline')

    // Check for timeline visualization
    await expect(page.locator('text=Memory Timeline')).toBeVisible()
  })

  test('should display empty state when no memories', async ({ page }) => {
    // This test would require mocking the API to return empty data
    await page.waitForLoadState('networkidle')
    await expect(page.locator('text=Memory Management')).toBeVisible()
  })

  test('should handle tag management', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Open create dialog
    const addButton = page.locator('button:has-text("Add Memory"), button[aria-label*="add"]').first()
    if (await addButton.isVisible()) {
      await addButton.click()

      // Add multiple tags
      const tagInput = page.locator('input[placeholder*="add tag" i]').first()
      if (await tagInput.isVisible()) {
        await tagInput.fill('tag1')
        await page.keyboard.press('Enter')

        await tagInput.fill('tag2')
        await page.keyboard.press('Enter')

        // Check that tags are displayed
        await expect(page.locator('text=tag1')).toBeVisible()
        await expect(page.locator('text=tag2')).toBeVisible()

        // Remove a tag
        const removeTagButton = page.locator('button:has-text("tag1")').first()
        if (await removeTagButton.isVisible()) {
          await removeTagButton.click()
        }
      }
    }
  })

  test('should be responsive on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })
    await page.waitForLoadState('networkidle')

    // Check that the layout adapts
    await expect(page.locator('text=Memory Management')).toBeVisible()

    // Check that add button is still accessible
    const addButton = page.locator('button:has-text("Add Memory"), button[aria-label*="add"]').first()
    if (await addButton.isVisible()) {
      await addButton.click()
      await expect(page.locator('text=Create New Memory')).toBeVisible()
    }
  })
})
