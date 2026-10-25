import { chromium, expect, test, type Locator, type Page } from '@playwright/test'
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
    const assistantEntry = page
      .locator('#workspace-assistant-entry-slot')
      .getByRole('button', { name: 'Expand chat', exact: true })
    const composer = page.locator('#chat-message-input')
    await expect(composer).toHaveCount(1)
    await expect(composer).toBeHidden()
    await expect(assistantEntry).toHaveAttribute('aria-expanded', 'false')
    await assistantEntry.click()
    await composer.fill('Retained unsent workspace draft')
    await composer.evaluate((element) => element.setAttribute('data-retention-probe', 'original'))
    await composer.press('Escape')
    await expect(assistantEntry).toBeFocused()
    await expect(page.locator('#workspace-assistant')).toBeHidden()
    expect(
      await page.locator('#workspace-assistant').evaluate((element) => element.getBoundingClientRect().height),
    ).toBe(0)
    await openCompactControls(page, /^Workspace context:/)
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
    await expect(map.getByRole('searchbox', { name: 'Filter loaded destinations' })).toBeFocused()
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
    await openCompactControls(page, 'More workspace controls')
    await page.getByRole('button', { name: 'Focus current task', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Current workspace task', exact: true })).toBeFocused()
    await openCompactControls(page, /^Workspace context:/)
    await page
      .getByRole('navigation', { name: 'Primary workspace contexts' })
      .getByRole('link', { name: 'explore', exact: true })
      .click()
    await expect(map.getByText('Explore', { exact: true }).first()).toBeVisible()
    await openCompactControls(page, /^Workspace context:/)
    await page
      .getByRole('navigation', { name: 'Primary workspace contexts' })
      .getByRole('link', { name: 'work', exact: true })
      .click()
    await expect(composer).toHaveValue('Retained unsent workspace draft')
    await expect(composer).toHaveAttribute('data-retention-probe', 'original')
    await expect(composer).toBeHidden()
    await assistantEntry.click()
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible()
    await expect(composer).toHaveValue('Retained unsent workspace draft')
    await expect(composer).toHaveAttribute('data-retention-probe', 'original')
  })
}

async function tabTo(page: Page, target: Locator) {
  for (let count = 0; count < 100; count++) {
    if (await target.evaluate((element) => element === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  throw new Error('Workspace control is not reachable by keyboard')
}
async function hit(target: Locator) {
  await expect
    .poll(() =>
      target.evaluate((element) => {
        const box = element.getBoundingClientRect()
        return [box.left + 8, box.right - 8].every((x) =>
          [box.top + 8, box.bottom - 8].every((y) => element.contains(document.elementFromPoint(x, y))),
        )
      }),
    )
    .toBe(true)
}
for (const reducedMotion of ['reduce', 'no-preference'] as const)
  for (const nativeZoom of [false, true]) {
    test(`keyboard filter list breadcrumbs history ${reducedMotion} zoom=${nativeZoom}`, async ({}, info) => {
      test.setTimeout(120000)
      const profile = await mkdtemp(join(tmpdir(), 'persistent-acceptance-profile-'))
      const extension = fileURLToPath(new URL('fixtures/zoom', import.meta.url))
      const context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium',
        headless: true,
        viewport: nativeZoom ? null : { width: 320, height: 740 },
        args: ['--window-size=640,900', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      })
      try {
        const page = context.pages()[0]
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
        await page.goto('http://127.0.0.1:5204/workspace/operate?server=catalog')
        await tabTo(page, page.getByRole('button', { name: 'Show map', exact: true }))
        await page.keyboard.press('Enter')
        const map = page.getByRole('complementary', { name: 'Workspace map' })
        await expect(
          map
            .locator('.workspace-map-branches')
            .getByRole('link', { name: 'Capability: Search (catalog)', exact: true }),
        ).toBeVisible()
        if (nativeZoom) {
          const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'))
          const dpr = await page.evaluate(() => devicePixelRatio)
          const zoom = await worker.evaluate(
            `(async()=>{const [tab]=await chrome.tabs.query({active:true});await chrome.tabs.setZoom(tab.id,2);return chrome.tabs.getZoom(tab.id)})()`,
          )
          expect(zoom).toBe(2)
          await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(dpr * 2)
        }
        const filter = map.getByRole('searchbox', { name: 'Filter loaded destinations' })
        const historyLength = await page.evaluate(() => history.length)
        await tabTo(page, filter)
        await hit(filter)
        await page.keyboard.type('Lookup')
        const lookup = map
          .locator('.workspace-map-list')
          .getByRole('link', { name: 'Capability: Lookup (catalog)', exact: true })
        await expect(lookup).toBeVisible()
        expect(await page.evaluate(() => history.length)).toBe(historyLength)
        await tabTo(page, lookup)
        await hit(lookup)
        await page.keyboard.press('Enter')
        await expect(page).toHaveURL(/server=catalog&item=lookup$/)
        await expect(page.getByRole('heading', { name: 'Operate', exact: true })).toBeFocused()
        await expect(
          page
            .getByRole('region', { name: 'Current workspace task' })
            .getByRole('heading', { name: 'Lookup', exact: true }),
        ).toBeVisible()
        await tabTo(page, filter)
        await page.keyboard.press('Control+A')
        await page.keyboard.press('Backspace')
        const beforeList = await page.evaluate(() => history.length)
        const list = map.getByRole('button', { name: 'List', exact: true })
        await tabTo(page, list)
        await hit(list)
        await page.keyboard.press('Space')
        expect(await page.evaluate(() => history.length)).toBe(beforeList)
        const search = map
          .locator('.workspace-map-list')
          .getByRole('link', { name: 'Capability: Search (catalog)', exact: true })
        await tabTo(page, search)
        await hit(search)
        await page.keyboard.press('Enter')
        await expect(page).toHaveURL(/server=catalog&item=search$/)
        const crumb = map
          .getByRole('navigation', { name: 'Selected workspace path' })
          .getByRole('link', { name: 'Fleet: catalog', exact: true })
        await tabTo(page, crumb)
        await hit(crumb)
        await page.keyboard.press('Enter')
        await expect(page).toHaveURL(/server=catalog$/)
        await repeatHistory(page, map, crumb)
        const session = await context.newCDPSession(page)
        const shot = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
        await info.attach('keyboard-acceptance', { body: Buffer.from(shot.data, 'base64'), contentType: 'image/png' })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      } finally {
        await context.close()
        await rm(profile, { recursive: true, force: true })
      }
    })
  }

async function repeatHistory(page: Page, map: Locator, crumb: Locator) {
  for (let i = 0; i < 3; i++) {
    await page.goBack()
    await expect(page).toHaveURL(/server=catalog&item=search$/)
    await expect(
      map
        .getByRole('navigation', { name: 'Selected workspace path' })
        .getByRole('link', { name: 'Capability: Search (catalog)', exact: true }),
    ).toHaveAttribute('aria-current', 'location')
    await expect(page.getByRole('heading', { name: 'Operate', exact: true })).toBeFocused()
    await page.goForward()
    await expect(page).toHaveURL(/server=catalog$/)
    await expect(crumb).toHaveAttribute('aria-current', 'location')
    await expect(page.getByRole('heading', { name: 'Operate', exact: true })).toBeFocused()
  }
}

async function openCompactControls(page: Page, name: string | RegExp) {
  const trigger = page.getByRole('button', { name })
  if (await trigger.isVisible()) await trigger.click()
}
