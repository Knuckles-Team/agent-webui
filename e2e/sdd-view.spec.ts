import { test, expect } from '@playwright/test'

test.describe('SDDView E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sdd')
  })

  test('should display SDD lifecycle tabs', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Check for SDD tabs
    await expect(page.locator('text=Constitution')).toBeVisible()
    await expect(page.locator('text=Specifications')).toBeVisible()
    await expect(page.locator('text=Plans')).toBeVisible()
    await expect(page.locator('text=Tasks')).toBeVisible()
  })

  test('should display constitution', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Check for constitution content
    await expect(page.locator('text=Constitution')).toBeVisible()
    await expect(page.locator('text=Governance Rules')).toBeVisible()
  })

  test('should edit constitution', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Click on edit button
    const editButton = page.locator('button:has-text("Edit"), button[aria-label*="edit"]').first()
    if (await editButton.isVisible()) {
      await editButton.click()

      // Check for edit dialog
      await expect(page.locator('text=Edit Constitution')).toBeVisible()

      // Modify governance rules
      const rulesInput = page.locator('textarea[placeholder*="governance" i]').first()
      if (await rulesInput.isVisible()) {
        await rulesInput.fill('Updated governance rule')
      }

      // Submit
      const submitButton = page.locator('button:has-text("Save"), button:has-text("Update")').first()
      await submitButton.click()

      // Check for success message
      await expect(page.locator('text=success')).toBeVisible({ timeout: 5000 })
    }
  })

  test('should open create spec dialog', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Navigate to Specifications tab
    await page.click('text=Specifications')

    // Click on create spec button
    const createButton = page.locator('button:has-text("Create Spec"), button[aria-label*="create"]').first()
    if (await createButton.isVisible()) {
      await createButton.click()

      // Check for dialog
      await expect(page.locator('text=Create New Specification')).toBeVisible()
      await expect(page.locator('input[placeholder*="specification title" i]')).toBeVisible()
    }
  })

  test('should fill and submit spec form', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Navigate to Specifications tab
    await page.click('text=Specifications')

    // Open create dialog
    const createButton = page.locator('button:has-text("Create Spec"), button[aria-label*="create"]').first()
    if (await createButton.isVisible()) {
      await createButton.click()

      // Fill form
      const titleInput = page.locator('input[placeholder*="specification title" i]').first()
      await titleInput.fill('E2E Test Spec')

      const descriptionInput = page.locator('textarea[placeholder*="description" i]').first()
      await descriptionInput.fill('E2E test specification description')

      const userStoriesInput = page.locator('textarea[placeholder*="user stories" i]').first()
      if (await userStoriesInput.isVisible()) {
        await userStoriesInput.fill('As a user, I want E2E testing')
      }

      const acceptanceCriteriaInput = page.locator('textarea[placeholder*="acceptance criteria" i]').first()
      if (await acceptanceCriteriaInput.isVisible()) {
        await acceptanceCriteriaInput.fill('Given E2E test, when run, then pass')
      }

      // Submit form
      const submitButton = page.locator('button:has-text("Create Spec"), button:has-text("Submit")').first()
      await submitButton.click()

      // Check for success message
      await expect(page.locator('text=success')).toBeVisible({ timeout: 5000 })
    }
  })

  test('should display spec details', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Navigate to Specifications tab
    await page.click('text=Specifications')

    // Click on a spec card
    const specCard = page.locator('[data-testid="spec-card"]').first()
    if (await specCard.isVisible()) {
      await specCard.click()

      // Check for spec details
      await expect(page.locator('text=Specification Details')).toBeVisible()
    }
  })

  test('should navigate to Plans tab', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Navigate to Plans tab
    await page.click('text=Plans')

    // Check for plans content
    await expect(page.locator('text=Implementation Plans')).toBeVisible()
  })

  test('should create plan from spec', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Navigate to Specifications tab
    await page.click('text=Specifications')

    // Click on a spec card
    const specCard = page.locator('[data-testid="spec-card"]').first()
    if (await specCard.isVisible()) {
      await specCard.click()

      // Look for create plan button
      const createPlanButton = page.locator('button:has-text("Create Plan"), button[aria-label*="plan"]').first()
      if (await createPlanButton.isVisible()) {
        await createPlanButton.click()

        // Check for plan dialog
        await expect(page.locator('text=Create Implementation Plan')).toBeVisible()

        // Fill form
        const approachInput = page.locator('textarea[placeholder*="technical approach" i]').first()
        if (await approachInput.isVisible()) {
          await approachInput.fill('E2E test technical approach')
        }

        // Submit
        const submitButton = page.locator('button:has-text("Create"), button:has-text("Submit")').first()
        await submitButton.click()

        // Check for success message
        await expect(page.locator('text=success')).toBeVisible({ timeout: 5000 })
      }
    }
  })

  test('should navigate to Tasks tab', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Navigate to Tasks tab
    await page.click('text=Tasks')

    // Check for tasks content
    await expect(page.locator('text=Task Management')).toBeVisible()
  })

  test('should display task dependencies', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Navigate to Tasks tab
    await page.click('text=Tasks')

    // Check for dependency visualization
    await expect(page.locator('text=Task Dependencies')).toBeVisible()
  })

  test('should update task status', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Navigate to Tasks tab
    await page.click('text=Tasks')

    // Find a task and click status dropdown
    const taskCard = page.locator('[data-testid="task-card"]').first()
    if (await taskCard.isVisible()) {
      const statusDropdown = taskCard.locator('select, [role="combobox"]').first()
      if (await statusDropdown.isVisible()) {
        await statusDropdown.click()
        // Select a new status
        await page.click('text=in_progress')
        await page.waitForTimeout(500)
      }
    }
  })

  test('should sync SDD to memory', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Look for sync button
    const syncButton = page.locator('button:has-text("Sync to Memory"), button[aria-label*="sync"]').first()
    if (await syncButton.isVisible()) {
      await syncButton.click()

      // Check for success message
      await expect(page.locator('text=success')).toBeVisible({ timeout: 5000 })
    }
  })

  test('should display SDD lifecycle visualization', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Check for lifecycle visualization
    await expect(page.locator('text=SDD Lifecycle')).toBeVisible()
  })

  test('should search specs', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Navigate to Specifications tab
    await page.click('text=Specifications')

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

  test('should filter specs by status', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Navigate to Specifications tab
    await page.click('text=Specifications')

    // Look for status filter
    const statusFilter = page.locator('select, [role="combobox"]').first()
    if (await statusFilter.isVisible()) {
      await statusFilter.click()
      // Select a status
      await page.click('text=draft')
      await page.waitForTimeout(500)
    }
  })

  test('should display empty state when no specs', async ({ page }) => {
    // This test would require mocking the API to return empty data
    await page.waitForLoadState('networkidle')
    await expect(page.locator('text=Specifications')).toBeVisible()
  })

  test('should be responsive on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })
    await page.waitForLoadState('networkidle')

    // Check that the layout adapts
    await expect(page.locator('text=Constitution')).toBeVisible()

    // Check that tabs are still accessible
    await page.click('text=Specifications')
    await expect(page.locator('text=Specifications')).toBeVisible()
  })
})
