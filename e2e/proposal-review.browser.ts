import { test, expect, type Locator } from '@playwright/test'
import { longArguments, tallArguments, requesterAgent, runReference } from './fixtures/proposal-review/payload'

async function withinViewport(locator: Locator, width: number, height: number) {
  await expect(locator).toBeInViewport()
  const bounds = await locator.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height + 1)
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 375, height: 320 },
  { width: 640, height: 240 },
]) {
  for (const payload of ['long', 'tall']) {
    // spec: WEBUI-APPS-R048
    test(`complete ${payload} review and trusted decisions at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.route('**/*', (route) =>
        new URL(route.request().url()).origin === 'http://127.0.0.1:5198' ? route.continue() : route.abort(),
      )
      await page.goto(`/?payload=${payload}`)
      const dialog = page.getByRole('dialog', { name: 'Review agent browser request' })
      await expect(dialog).toBeVisible()
      await expect(dialog).toHaveCSS('overflow-y', 'auto')
      await withinViewport(dialog, viewport.width, viewport.height)
      const exact = dialog.locator('pre')
      expect(await exact.textContent()).toBe(payload === 'long' ? longArguments : tallArguments)
      expect(Buffer.byteLength(longArguments)).toBe(8192)
      await expect(dialog.getByText(requesterAgent, { exact: true })).toHaveText(requesterAgent)
      await expect(dialog.getByText(runReference, { exact: true })).toHaveText(runReference)
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      expect(await exact.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      await exact.focus()
      await exact.press('Control+End')
      expect(await exact.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
      await page.keyboard.press('Tab')
      const decline = page.getByRole('button', { name: 'Decline request' })
      await expect(decline).toBeFocused()
      await withinViewport(decline, viewport.width, viewport.height)
      await page.keyboard.press('Tab')
      const accept = page.getByRole('button', { name: 'Accept request' })
      await expect(accept).toBeFocused()
      await withinViewport(accept, viewport.width, viewport.height)
      await accept.evaluate((button: HTMLButtonElement) => button.click())
      await expect(page.getByTestId('response')).toHaveText('pending')
      await page.screenshot({ path: test.info().outputPath('review-decisions.png'), animations: 'disabled' })
      await accept.press('Enter')
      await expect(page.getByTestId('response')).toHaveText('accepted')
      await expect(dialog).toHaveCount(0)
      await page.reload()
      await decline.click()
      await expect(page.getByTestId('response')).toHaveText('declined')
    })
  }
}
