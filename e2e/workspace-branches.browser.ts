// spec: OVERSTORY-DESIGN-R005.1
// spec: OVERSTORY-APPS-R046.2.2
import { expect, test } from '@playwright/test'

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`loaded branch journey with ${reducedMotion} motion`, async ({ page }, info) => {
    test.setTimeout(120_000)
    await page.route('**/auth/session', (route) =>
      route.fulfill({
        json: {
          authenticated: true,
          subject: 'branch-reader',
          tenant: 'synthetic',
          webui_role: 'reader',
          roles: ['kg:read'],
          csrf_token: crypto.randomUUID(),
        },
      }),
    )
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname
      const result = (value: unknown) =>
        route.fulfill({
          json: { ok: true, result: { value }, meta: { registry_digest: 'synthetic', api_version: '1' } },
        })
      if (path === '/api/v1/ops/fleet.status') return result({ children: { catalog: { state: 'up' } } })
      if (path === '/api/v1/ops/fleet.catalog.list')
        return result({
          items: [
            {
              id: 'search',
              server: 'catalog',
              name: 'Search',
              kind: 'tool',
              description: 'Synthetic search capability',
            },
            {
              id: 'lookup',
              server: 'catalog',
              name: 'Lookup',
              kind: 'tool',
              description: 'Synthetic lookup capability',
            },
          ],
          next_cursor: null,
        })
      if (path.startsWith('/api/configure')) return route.fulfill({ json: { models: [], builtinTools: [] } })
      if (path === '/api/enhanced/models') return route.fulfill({ json: { models: [], default_id: '' } })
      if (path === '/api/chats') return route.fulfill({ json: [] })
      return route.fulfill({ status: 501, json: { detail: 'Unavailable in synthetic branch fixture' } })
    })
    await page.addInitScript(() => localStorage.setItem('agent-webui.consent-dismissed', 'agent-webui-consent-v1'))
    await page.emulateMedia({ reducedMotion })
    await page.goto('/workspace/operate?server=catalog')
    await expect(page.getByRole('link', { name: 'Search', exact: true })).toBeVisible()
    const historyLength = await page.evaluate(() => history.length)
    await page.keyboard.press('Control+k')
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('textbox')).toBeFocused()
    await dialog.getByRole('button', { name: 'Branches', exact: true }).focus()
    await page.keyboard.press('Space')
    await dialog.getByRole('button', { name: 'Browse Tools & connections' }).focus()
    await page.keyboard.press('Enter')
    await expect(dialog.getByRole('heading', { name: 'Tools & connections destinations' })).toBeFocused()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Browse Fleet: catalog' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(dialog.getByRole('heading', { name: 'Fleet: catalog destinations' })).toBeFocused()
    expect(await page.evaluate(() => history.length)).toBe(historyLength)
    for (const viewport of [
      { width: 320, height: 740 },
      { width: 740, height: 320 },
      { width: 1440, height: 900 },
      { width: 587, height: 913 },
    ]) {
      await page.setViewportSize(viewport)
      const link = dialog.getByRole('link', { name: 'Capability: Search (catalog)' })
      await link.focus()
      await expect(link).toBeFocused()
      await expect(link, `focused leaf at ${viewport.width} by ${viewport.height}`).toBeInViewport()
      expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
      expect(await link.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
      await info.attach(`branches-${reducedMotion}-${viewport.width}x${viewport.height}`, {
        body: await page.screenshot({ path: info.outputPath(`branches-${viewport.width}x${viewport.height}.png`) }),
        contentType: 'image/png',
      })
    }
    const input = dialog.getByRole('textbox', { name: 'Search destinations' })
    // Simulated keyboard occlusion is separate from native-device acceptance.
    await input.focus()
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport!, 'height', { value: 240, configurable: true })
      window.visualViewport!.dispatchEvent(new Event('resize'))
    })
    await expect(input).toBeFocused()
    await expect
      .poll(async () => {
        const box = (await dialog.boundingBox())!
        return box.y + box.height
      })
      .toBeLessThanOrEqual(240)
    await expect(input).toBeInViewport()
    await page.evaluate(() => {
      Reflect.deleteProperty(window.visualViewport!, 'height')
      window.visualViewport!.dispatchEvent(new Event('resize'))
    })
    await input.fill('Lookup')
    await expect(dialog.getByRole('link', { name: 'Capability: Lookup (catalog)' })).toBeVisible()
    await input.fill('')
    await expect(dialog.getByRole('heading', { name: 'Fleet: catalog destinations' })).toBeVisible()
    await dialog.getByRole('button', { name: 'List', exact: true }).click()
    await expect(dialog.getByRole('link', { name: 'Capability: Search (catalog)' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Branches', exact: true }).click()
    await expect(dialog.getByRole('heading', { name: 'Fleet: catalog destinations' })).toBeVisible()
    // Explicit ancestor return interrupts immediately; no camera state enters history.
    await dialog.getByRole('button', { name: 'Back to Tools & connections' }).click()
    await expect(dialog.getByRole('heading', { name: 'Tools & connections destinations' })).toBeFocused()
    await dialog.getByRole('button', { name: 'Browse Fleet: catalog' }).click()
    await dialog.getByRole('link', { name: 'Capability: Search (catalog)' }).focus()
    await page.keyboard.press('Enter')
    await expect(dialog).not.toBeVisible()
    await expect(page.getByRole('article', { name: 'Capability detail' })).toContainText('Synthetic search capability')
    await expect(page).toHaveURL(/server=catalog&item=search$/)
    await page.goBack()
    await expect(page).toHaveURL(/server=catalog$/)
    await page.goForward()
    await expect(page.getByRole('article', { name: 'Capability detail' })).toContainText('Synthetic search capability')
    await page.keyboard.press('Control+k')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Find destination' })).toBeFocused()
  })
}
