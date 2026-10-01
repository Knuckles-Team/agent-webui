import { test, expect } from '@playwright/test'

// Keep the review reproducible offline, including the production font import.
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:5195') {
      await route.continue()
    } else {
      await route.abort()
    }
  })
})

const viewports = [320, 375, 768, 1440].flatMap((width) =>
  ['light', 'dark'].map((theme) => ({ width, theme })),
)

for (const { width, theme } of viewports) {
  test(`keyboard, focus, descriptions and layout at ${width}px (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await page.evaluate((theme) => document.documentElement.classList.toggle('dark', theme === 'dark'), theme)
    await expect(page.getByRole('group', { name: 'Filter 2' })).toBeVisible()
    const field = page.getByRole('combobox', { name: 'Filter 2 field' })
    await field.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('option', { name: 'Name' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(field).toBeFocused()
    const remove = page.getByRole('button', { name: 'Remove filter 2' })
    await remove.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('group', { name: 'Filter 2' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Review preflight' }).click()
    const target = page.getByRole('textbox', { name: /Target/ })
    await expect(target).toHaveAttribute('aria-invalid', 'true')
    await expect(target).toHaveAccessibleDescription(/Select a target.*Required value is missing/)
    await expect(page.getByRole('checkbox', { name: 'Use cache' })).toHaveAccessibleDescription(
      'Reuse previous results.',
    )
    const open = page.getByRole('button', { name: 'Open chat' })
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await open.focus()
      await page.keyboard.press('Enter')
      await expect(open).toHaveAttribute('aria-expanded', 'true')
      await expect(page.getByRole('button', { name: 'Close chat' })).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(page.getByRole('button', { name: 'Maximize' })).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('button', { name: 'Minimize' })).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(open).toBeFocused()
      await expect(open).toHaveAttribute('aria-expanded', 'false')
    }
    await open.press('Enter')
    await page.getByRole('button', { name: 'Close chat' }).press('Enter')
    await expect(open).toBeFocused()
    await page.getByRole('button', { name: 'Switch view' }).click()
    await expect(open).toBeDisabled()
    await page.getByRole('button', { name: 'Switch view' }).click()
    await expect(open).toBeEnabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`workspace-${width}-${theme}.png`), animations: 'disabled' })
  })
}

test('reduced motion removes drawer transitions and decorative animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const open = page.getByRole('button', { name: 'Open chat' })
  expect(await open.evaluate((element) => getComputedStyle(element).transitionProperty)).toBe('none')
  expect(await open.locator('span').evaluate((element) => getComputedStyle(element).animationName)).toBe('none')
  await open.press('Enter')
  const panel = page.getByRole('complementary', { name: 'Agent Chat' })
  expect(await panel.evaluate((element) => getComputedStyle(element).transitionProperty)).toBe('none')
  await page.keyboard.press('Escape')
  await expect(open).toBeFocused()
})
