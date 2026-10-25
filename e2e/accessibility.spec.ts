import { test, expect, type Page } from '@playwright/test'

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

const viewports = [320, 375, 768, 1440].flatMap((width) => ['light', 'dark'].map((theme) => ({ width, theme })))

for (const { width, theme } of viewports) {
  // spec: WEBUI-DESIGN-R003, WEBUI-DESIGN-R004
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
    const input = page.locator('#chat-message-input')
    await expectClosedAssistant(page)
    await page.getByRole('button', { name: 'Expand chat' }).click()
    await input.fill('Retained accessibility draft')
    await input.evaluate((element) => element.setAttribute('data-retention-probe', 'original'))
    await input.press('Escape')
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const expand = page.getByRole('button', { name: 'Expand chat' })
      await expectClosedAssistant(page)
      await expand.focus()
      await page.keyboard.press('Enter')
      const restore = page.getByRole('button', { name: 'Restore chat size' })
      await expect(restore).toBeFocused()
      await expect(restore).toHaveAttribute('aria-expanded', 'true')
      await expect(restore).toHaveAttribute('aria-pressed', 'true')
      await page.getByRole('button', { name: 'Focus message input' }).press('Enter')
      await expect(input).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(expand).toBeFocused()
      await expect(input).toHaveValue('Retained accessibility draft')
      await expect(input).toHaveAttribute('data-retention-probe', 'original')
    }
    await page.getByRole('button', { name: 'Expand chat' }).click()
    await page.getByRole('button', { name: 'Focus message input' }).press('Enter')
    await expect(input).toBeFocused()
    await page.getByRole('button', { name: 'Switch view' }).click()
    await expect(page.getByRole('button', { name: 'Expand chat' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Restore chat size' })).toHaveCount(0)
    const primary = await page.getByRole('region', { name: 'Workspace assistant' }).boundingBox()
    const layout = await page.locator('.workspace-chat-layout').boundingBox()
    expect(primary!.width).toBeCloseTo(layout!.width, 0)
    expect(primary!.height).toBeCloseTo(layout!.height, 0)
    await expect(input).toBeVisible()
    await expect(input).toHaveValue('Retained accessibility draft')
    await expect(input).toHaveAttribute('data-retention-probe', 'original')
    await page.getByRole('button', { name: 'Switch view' }).click()
    await expect(page.getByRole('button', { name: 'Restore chat size' })).toBeEnabled()
    await expect(page.locator('#chat-panel-toggle')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`workspace-${width}-${theme}.png`), animations: 'disabled' })
  })
}

test('native assistant has no overlay transition or decorative activity', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expectClosedAssistant(page)
  await page.getByRole('button', { name: 'Expand chat' }).press('Enter')
  const panel = page.locator('#workspace-assistant')
  await expect(panel).toBeVisible()
  expect(await panel.evaluate((element) => getComputedStyle(element).position)).toBe('static')
  expect(await panel.evaluate((element) => getComputedStyle(element).animationName)).toBe('none')
  await page.locator('#chat-message-input').press('Escape')
  await expect(page.getByRole('button', { name: 'Expand chat' })).toBeFocused()
  await expectClosedAssistant(page)
})

async function expectClosedAssistant(page: Page) {
  const panel = page.locator('#workspace-assistant')
  await expect(panel).toHaveCount(1)
  await expect(panel).toBeHidden()
  await expect(page.locator('#chat-message-input')).toHaveCount(1)
  await expect(page.locator('#chat-message-input')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Focus message input' })).toHaveCount(0)
  const expand = page.getByRole('button', { name: 'Expand chat' })
  await expect(expand).toHaveAttribute('aria-expanded', 'false')
  await expect(expand).toHaveAttribute('aria-pressed', 'false')
  expect(await panel.evaluate((element) => element.getBoundingClientRect().height)).toBe(0)
  const context = await page.locator('.workspace-context-content').boundingBox()
  const layout = await page.locator('.workspace-chat-layout').boundingBox()
  expect(context!.width).toBeCloseTo(layout!.width, 0)
  expect(context!.height).toBeCloseTo(layout!.height, 0)
}
