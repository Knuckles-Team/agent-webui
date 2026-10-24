import { chromium, expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`persistent map and retained task journey with ${reducedMotion} motion`, async ({ page }, info) => {
    test.setTimeout(150_000)
    await page.route('**/auth/session', (route) =>
      route.fulfill({
        json: {
          authenticated: true,
          subject: 'workspace-reader',
          tenant: 'synthetic',
          webui_role: 'maintainer',
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
      if (path === '/api/v1/ops/fleet.status')
        return result({ children: { catalog: { state: 'up' }, documents: { state: 'idle' } } })
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
      if (path.startsWith('/api/chats/')) return route.fulfill({ json: { messages: [] } })
      return route.fulfill({ status: 501, json: { detail: 'Unavailable in the synthetic workspace fixture' } })
    })
    await page.addInitScript(() => localStorage.setItem('agent-webui.consent-dismissed', 'agent-webui-consent-v1'))
    await page.emulateMedia({ reducedMotion })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/workspace/work')
    const composer = page.getByRole('textbox', { name: 'Message input' })
    await composer.fill('Retained unsent workspace draft')
    await composer.evaluate((element) => element.setAttribute('data-retention-probe', 'original'))
    await page
      .getByRole('navigation', { name: 'Primary workspace contexts' })
      .getByRole('link', { name: 'operate', exact: true })
      .click()
    const map = page.getByRole('complementary', { name: 'Workspace map' })
    await map.locator('.workspace-map-branches').getByRole('link', { name: 'Fleet: catalog', exact: true }).click()
    const capability = map
      .locator('.workspace-map-branches')
      .getByRole('link', { name: 'Capability: Search (catalog)', exact: true })
    await capability.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/server=catalog&item=search/)
    await expect(
      page
        .getByRole('region', { name: 'Current workspace task' })
        .getByRole('heading', { name: 'Search', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Operate', exact: true })).toBeFocused()
    await page.getByRole('button', { name: 'Focus map', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Workspace navigation', exact: true })).toBeFocused()
    const historyLength = await page.evaluate(() => history.length)
    await map.getByRole('button', { name: 'List', exact: true }).click()
    await map.getByRole('button', { name: 'Map', exact: true }).click()
    expect(await page.evaluate(() => history.length)).toBe(historyLength)
    await page.goBack()
    await expect(page).toHaveURL(/server=catalog$/)
    await page.goForward()
    await expect(page).toHaveURL(/item=search$/)
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 320, height: 740 },
      { width: 740, height: 320 },
      { width: 587, height: 913 },
    ]) {
      await page.setViewportSize(viewport)
      await capability.focus()
      await expect(capability).toBeInViewport()
      await page.screenshot({ path: info.outputPath(`persistent-${viewport.width}x${viewport.height}.png`) })
      await expect
        .poll(() =>
          capability.evaluate((element) => {
            const box = element.getBoundingClientRect()
            return [box.left + 8, box.left + box.width / 2, box.right - 8].every((x) =>
              [box.top + 8, box.top + box.height / 2, box.bottom - 8].every((y) =>
                element.contains(document.elementFromPoint(x, y)),
              ),
            )
          }),
        )
        .toBe(true)
      expect(await page.locator('.workspace-frame').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
      await info.attach(`persistent-${viewport.width}x${viewport.height}`, {
        body: await page.screenshot({ path: info.outputPath(`persistent-${viewport.width}x${viewport.height}.png`) }),
        contentType: 'image/png',
      })
    }
    await page.getByRole('button', { name: 'Focus current task', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Current workspace task', exact: true })).toBeFocused()
    await page
      .getByRole('navigation', { name: 'Primary workspace contexts' })
      .getByRole('link', { name: 'explore', exact: true })
      .click()
    await expect(map.getByText('Explore', { exact: true }).first()).toBeVisible()
    await page
      .getByRole('navigation', { name: 'Primary workspace contexts' })
      .getByRole('link', { name: 'work', exact: true })
      .click()
    await expect(composer).toHaveValue('Retained unsent workspace draft')
    await expect(composer).toHaveAttribute('data-retention-probe', 'original')
  })
}

test('persistent map keyboard access at actual 200% browser zoom', async ({}, info) => {
  const profile = await mkdtemp(join(tmpdir(), 'persistent-zoom-'))
  const extension = fileURLToPath(new URL('fixtures/zoom', import.meta.url))
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: null,
    args: ['--window-size=640,900', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  })
  try {
    const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'))
    const page = context.pages()[0]
    await page.route('**/auth/session', (route) =>
      route.fulfill({
        json: {
          authenticated: true,
          subject: 'workspace-reader',
          tenant: 'synthetic',
          webui_role: 'maintainer',
          roles: ['kg:read'],
        },
      }),
    )
    await page.route('**/api/**', (route) =>
      route.fulfill({ status: 501, json: { detail: 'Unavailable in synthetic zoom fixture' } }),
    )
    await page.addInitScript(() => localStorage.setItem('agent-webui.consent-dismissed', 'agent-webui-consent-v1'))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('http://127.0.0.1:5204/workspace/operate')
    const before = await page.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio }))
    const zoom = await worker.evaluate(`(async () => {
      const [tab] = await chrome.tabs.query({ active: true });
      await chrome.tabs.setZoom(tab.id, 2);
      return chrome.tabs.getZoom(tab.id);
    })()`)
    expect(zoom).toBe(2)
    await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(before.dpr * 2)
    const map = page.getByRole('complementary', { name: 'Workspace map' })
    await map.getByRole('button', { name: 'List', exact: true }).click()
    const target = map.locator('.workspace-map-list').getByRole('link', { name: 'Explore', exact: true })
    await map.getByRole('button', { name: 'List', exact: true }).focus()
    for (let count = 0; count < 12; count++) {
      if (await target.evaluate((el) => el === document.activeElement)) break
      await page.keyboard.press('Tab')
    }
    await expect(target).toBeFocused()
    await expect
      .poll(() =>
        target.evaluate((el) => {
          const box = el.getBoundingClientRect()
          return [box.left + 8, box.right - 8].every((x) =>
            [box.top + 8, box.bottom - 8].every((y) => el.contains(document.elementFromPoint(x, y))),
          )
        }),
      )
      .toBe(true)
    const session = await context.newCDPSession(page)
    const shot = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await info.attach('persistent-map-native-200-percent', {
      body: Buffer.from(shot.data, 'base64'),
      contentType: 'image/png',
    })
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/workspace\/explore$/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  } finally {
    await context.close()
    await rm(profile, { recursive: true, force: true })
  }
})
