import { expect, test, type Locator, type Page } from '@playwright/test'

for (const theme of ['light', 'dark', 'glass']) {
  test(`Arbora shell identity and contrast in ${theme}`, async ({ page }, info) => {
    await prepareIdentity(page, theme)
    const map = page.getByRole('complementary', { name: 'Workspace map' })
    const selected = map
      .locator('.workspace-map-branches')
      .getByRole('link', { name: 'Capability: Search (catalog)', exact: true })
    await expect(selected).toHaveAttribute('aria-current', 'location')
    for (const size of [
      { width: 1440, height: 900 },
      { width: 320, height: 740 },
    ]) {
      await page.setViewportSize(size)
      await page.goto('about:blank')
      await page.goto('/workspace/operate?server=catalog&item=search')
      await expect(
        page
          .getByRole('region', { name: 'Current workspace task' })
          .getByRole('heading', { name: 'Search', exact: true }),
      ).toBeVisible()
      await page.screenshot({ path: info.outputPath(`identity-${theme}-${size.width}x${size.height}-initial.png`) })
      await checkDesktopShell(page, size)
      await checkNarrowTask(page, map, size)
      await openNarrowMap(page, map, size)
      await selected.focus()
      await expect(selected).toBeInViewport()
      expect(await page.locator('.workspace-frame').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
      await openContext(page)
      await page.locator('.workspace-context-rail nav a[aria-current]').hover()
      const contrast = await page
        .locator(
          [
            '.workspace-context-rail nav a[aria-current]',
            '.workspace-map-node',
            '.workspace-map-context p',
            '.workspace-command-trigger',
            '.workspace-appearance summary',
            '.workspace-frame-eyebrow',
            '.workspace-frame-actions button',
            '.workspace-task-surface .workspace-route-content :is(h1, h2, h3, p, label, input, a, button:not(:disabled))',
          ].join(', '),
        )
        .evaluateAll((elements) => {
          const canvas = document.createElement('canvas')
          canvas.width = 1
          canvas.height = 1
          const context = canvas.getContext('2d')!
          function rgba(value: string) {
            context.clearRect(0, 0, 1, 1)
            context.fillStyle = value
            context.fillRect(0, 0, 1, 1)
            return Array.from(context.getImageData(0, 0, 1, 1).data)
          }
          function background(element: Element | null): number[] {
            if (!element) return [255, 255, 255, 255]
            const color = rgba(getComputedStyle(element).backgroundColor)
            const parent = background(element.parentElement)
            return color.map((value, index) =>
              index === 3 ? 255 : (value * color[3]) / 255 + parent[index] * (1 - color[3] / 255),
            )
          }
          function luminance(color: number[]) {
            const channels = color
              .slice(0, 3)
              .map((value) => value / 255)
              .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
            return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
          }
          return elements.map((element) => {
            const foreground = luminance(rgba(getComputedStyle(element).color))
            const back = luminance(background(element))
            return {
              label: element.textContent,
              nativeTask: element.closest('.workspace-task-surface') !== null,
              ratio: (Math.max(foreground, back) + 0.05) / (Math.min(foreground, back) + 0.05),
            }
          })
        })
      expect(contrast.filter((result) => result.nativeTask).length).toBeGreaterThan(5)
      for (const result of contrast) expect(result.ratio, `${theme}: ${result.label}`).toBeGreaterThanOrEqual(4.5)
      await closeContext(page)
      await selected.focus()
      await page.screenshot({ path: info.outputPath(`identity-${theme}-${size.width}x${size.height}.png`) })
      await closeNarrowMap(page, map, size)
    }
    await checkPrimaryWork(page)
  })
}

for (const theme of ['light', 'dark', 'glass']) {
  test(`workspace palette cancellation in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await prepareIdentity(page, theme)
    const task = page.getByRole('region', { name: 'Current workspace task' })
    const dialog = page.getByRole('dialog')
    await expect(task.getByRole('heading', { name: 'Search', exact: true })).toBeVisible()
    for (const close of ['Escape', 'Close']) {
      await task.focus()
      await page.keyboard.press('Control+k')
      await expect(dialog).toBeVisible()
      if (close === 'Escape') await page.keyboard.press('Escape')
      else await dialog.getByRole('button', { name: 'Close destination search' }).click()
      await expect(dialog).not.toBeVisible()
      await expect(task).toBeFocused()
    }
    const find = page.getByRole('button', { name: 'Find destination' })
    await expect(find).toBeVisible()
    await find.click()
    await page.keyboard.press('Escape')
    await expect(find).toBeFocused()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: 'Find destination' }).click()
    await expect(dialog).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.keyboard.press('Escape')
    await expect(find).toBeFocused()
    await expect(find).toBeInViewport()
  })
}

async function prepareIdentity(page: Page, theme: string) {
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

  await page.addInitScript((value) => localStorage.setItem('pydantic-chat-ui-theme', value), theme)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/workspace/operate?server=catalog&item=search')
  await expect(page.locator('html')).toHaveClass(new RegExp(`(^| )${theme}( |$)`))
}

async function tabTo(page: Page, target: Locator) {
  for (let count = 0; count < 100; count++) {
    if (await target.evaluate((element) => element === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  throw new Error('Map disclosure is not reachable by keyboard')
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

async function checkNarrowTask(page: Page, map: Locator, size: { width: number; height: number }) {
  if (size.width !== 320) return
  await expect(map).not.toBeVisible()
  const sizes = await page
    .locator('.workspace-header-row button:visible')
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height))
  for (const height of sizes) expect(height).toBeGreaterThanOrEqual(44)
  const task = await page.getByRole('region', { name: 'Current workspace task' }).boundingBox()
  expect(task!.y).toBeLessThan(290)
  expect(task!.height).toBeGreaterThanOrEqual(340)
  await expectDock(page)
  await hit(page.getByRole('button', { name: 'Reprobe readiness', exact: true }))
  await page.locator('.workspace-task-surface .workspace-route-content').evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await hit(page.getByRole('button', { name: 'Refresh capabilities', exact: true }))
  await expectDock(page)
  await tabTo(page, page.getByRole('textbox', { name: 'Filter fleet children' }))
  await hit(page.getByRole('textbox', { name: 'Filter fleet children' }))
  await checkNativeAssistant(page)
  await checkCompactFocus(page)
}

async function openNarrowMap(page: Page, map: Locator, size: { width: number; height: number }) {
  if (size.width !== 320) return
  await tabTo(page, page.getByRole('button', { name: 'Show map', exact: true }))
  await page.keyboard.press('Enter')
  await expect(map).toBeVisible()
  await page.setViewportSize({ width: 740, height: 320 })
  await expect(map).toBeVisible()
  await page.setViewportSize(size)
}

async function closeNarrowMap(page: Page, map: Locator, size: { width: number; height: number }) {
  if (size.width !== 320) return
  await tabTo(page, page.getByRole('button', { name: 'Hide map', exact: true }))
  await page.keyboard.press('Enter')
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(map).not.toBeVisible()
}

async function expectDock(page: Page) {
  await expect(page.locator('#chat-panel-toggle')).toHaveCount(0)
  const panel = page.getByRole('region', { name: 'Workspace assistant' })
  expect(await panel.evaluate((element) => getComputedStyle(element).position)).toBe('static')
  expect(await page.locator('.workspace-viewport').evaluate((element) => element.getBoundingClientRect().height)).toBe(
    740,
  )
}
async function checkNativeAssistant(page: Page) {
  const expand = page.getByRole('button', { name: 'Expand chat', exact: true })
  await tabTo(page, expand)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Restore chat size', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(expand).toBeFocused()
  await page.getByRole('button', { name: 'Focus message input' }).click()
  await expect(page.getByRole('textbox', { name: 'Message input' })).toBeFocused()
  await expectDock(page)
}
async function checkPrimaryWork(page: Page) {
  await page.setViewportSize({ width: 320, height: 740 })
  await openContext(page)
  await page
    .getByRole('navigation', { name: 'Primary workspace contexts' })
    .getByRole('link', { name: 'work', exact: true })
    .click()
  await expect(page.locator('#chat-panel-toggle')).toHaveCount(0)
  await expect
    .poll(() => page.locator('.workspace-viewport').evaluate((element) => element.getBoundingClientRect().height))
    .toBe(740)
  await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible()
}

async function openContext(page: Page) {
  const trigger = page.getByRole('button', { name: /^Workspace context:/ })
  if (await trigger.isVisible()) {
    await tabTo(page, trigger)
    await page.keyboard.press('Enter')
  }
}

async function checkDesktopShell(page: Page, size: { width: number; height: number }) {
  const logo = page.locator('.workspace-brand-logo')
  await expect.poll(() => logo.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
  if (size.width !== 1440) return
  const header = await page.locator('.workspace-context-rail').boundingBox()
  expect(header!.height).toBeLessThanOrEqual(64)
  const handle = page.getByRole('separator', { name: 'Resize workspace map' })
  await expect(handle).toHaveAttribute('aria-valuenow', '14')
  await handle.focus()
  await page.keyboard.press('Home')
  await expect(handle).toHaveAttribute('aria-valuenow', '12')
  await page.keyboard.press('End')
  await expect(handle).toHaveAttribute('aria-valuenow', '22')
  // End changes layout. Let the locator wait for a stable, actionable handle
  // before starting the raw pointer drag, rather than using a stale rectangle.
  await handle.hover()
  const start = await handle.boundingBox()
  const x = start!.x + start!.width / 2
  const y = start!.y + start!.height / 2
  await page.mouse.down()
  await page.mouse.move(x - 128, y, { steps: 8 })
  await page.mouse.up()
  await expect(handle).toHaveAttribute('aria-valuenow', '14')
  expect(await page.evaluate(() => localStorage.getItem('agent-webui.workspace-map-width'))).toBe('14')
  const task = await page.getByRole('region', { name: 'Current workspace task' }).boundingBox()
  expect(task!.width).toBeGreaterThanOrEqual(384)
  await expect(page.locator('.workspace-map')).toHaveCSS('animation-name', 'none')
  await page.emulateMedia({ forcedColors: 'active' })
  await expect(page.locator('.workspace-map')).toHaveCSS('backdrop-filter', 'none')
  await page.emulateMedia({ forcedColors: 'none' })
  const media = await page.context().newCDPSession(page)
  await media.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-reduced-transparency', value: 'reduce' },
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ],
  })
  await expect(page.locator('.workspace-map')).toHaveCSS('backdrop-filter', 'none')
  await expect(page.locator('.workspace-map')).toHaveCSS('background-color', /rgb\(.*\)/)
  await media.detach()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Find destination' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const close = dialog.getByRole('button', { name: 'Close destination search', exact: true })
  await hit(close)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
}

async function closeContext(page: Page) {
  const trigger = page.getByRole('button', { name: /^Workspace context:/ })
  if (!(await trigger.isVisible())) return
  await page.locator('.workspace-context-rail nav a[aria-current]').focus()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
}

async function checkCompactFocus(page: Page) {
  const current = page.locator('.workspace-context-rail nav a[aria-current]')
  await expect(current).toBeVisible()
  await tabTo(page, current)
  await page.keyboard.press('Enter')
  await expect(current).toBeFocused()
  const focus = page.getByRole('button', { name: 'Focus current task' })
  await tabTo(page, focus)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: 'Current workspace task' })).toBeFocused()
  const find = page.getByRole('button', { name: 'Find destination' })
  await tabTo(page, find)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await expect(find).toBeFocused()
}
