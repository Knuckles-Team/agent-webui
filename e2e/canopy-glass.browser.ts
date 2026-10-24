// spec: WEBUI-DESIGN-R002.1.1
// spec: WEBUI-DESIGN-R004.1.1
// spec: WEBUI-DESIGN-R005.2
// spec: WEBUI-APPS-R049.2.1
import { expect, test, type Page, type Locator } from '@playwright/test'
import { baseURL, fixedTime, responses } from './fixtures/documentation-screenshots.mjs'

const names = [
  'Canopy moisture gradients',
  'Fungal network connectivity',
  'Understory structure mapping',
  'Seasonal water balance',
  'Soil carbon observations',
  'Riparian field notes',
  'Pollinator activity survey',
  'Forest restoration methods',
  'Microclimate sensor readings',
  'Habitat continuity assessment',
  'Watershed source inventory',
  'Research synthesis',
]
const records = names.map((title, index) => ({
  id: `evidence:${index}`,
  type: index % 2 ? 'Study' : 'Field notes',
  title,
}))

async function prepare(page: Page, theme: string, securityWarning = false) {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== baseURL) return route.abort('blockedbyclient')
    if (url.pathname === '/auth/session' && securityWarning)
      return route.fulfill({
        json: { ...responses['/auth/session'], mode: 'none', banner: 'Synthetic unsecured-install warning' },
      })
    if (url.pathname === '/api/enhanced/ontology/object-set/search')
      return route.fulfill({ json: { count: records.length, rows: records } })
    if (url.pathname.startsWith('/api/enhanced/ontology/object/')) {
      const id = decodeURIComponent(url.pathname.split('/').at(-1)!)
      const row = records.find((entry) => entry.id === id)!
      return route.fulfill({
        json: {
          id,
          object_type: row.type,
          properties: {
            title: row.title,
            summary:
              'Synthetic research evidence for the Canopy Glass browser review. Field observations are retained with their source context.',
            status: 'Reviewed',
            source: 'Synthetic research collection',
            coverage: 'Temperate forest study area',
          },
          links: { out: records.slice(1).map((entry) => ({ type: 'cites', target: entry.id })) },
          history: [
            {
              id: 'edit:1',
              edit_type: 'property_set',
              after: { status: 'Reviewed' },
              actor: 'Synthetic reviewer',
              timestamp: fixedTime,
            },
          ],
        },
      })
    }
    const json = responses[url.pathname as keyof typeof responses]
    if (json !== undefined) return route.fulfill({ json })
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/'))
      return route.fulfill({ status: 501, json: { detail: 'Not available in this synthetic fixture' } })
    return route.continue()
  })
  await page.routeWebSocket('**/*', (socket) => socket.close())
  await page.clock.setFixedTime(new Date(fixedTime))
  await page.addInitScript((value) => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('pydantic-chat-ui-theme', value)
    localStorage.setItem('agent-webui.consent-dismissed', 'agent-webui-consent-v1')
  }, theme)
  await page.goto('/workspace/explore?q=forest&entity=evidence%3A0')
  await expect(page.getByRole('region', { name: 'Selected evidence' }).getByRole('heading')).toHaveText(names[0])
  await expect(page.getByText('12 matching objects')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  return failures
}

async function expandedHeader(page: Page) {
  for (const name of ['work', 'explore', 'operate'])
    await expect(
      page.getByRole('navigation', { name: 'Primary workspace contexts' }).getByRole('link', { name, exact: true }),
    ).toBeVisible()
  for (const name of ['Find destination', 'Focus map', 'Focus current task'])
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  const box = await page.locator('.workspace-context-rail').boundingBox()
  expect(box!.x).toBe(0)
  expect(box!.width).toBe(page.viewportSize()!.width)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

for (const variant of [
  { theme: 'light', motion: 'no-preference' },
  { theme: 'light', motion: 'reduce' },
  { theme: 'dark', motion: 'reduce' },
  { theme: 'glass', motion: 'reduce' },
] as const) {
  test(`Canopy evidence journey ${variant.theme} ${variant.motion}`, async ({ page }, info) => {
    test.setTimeout(120_000)
    await page.emulateMedia({ reducedMotion: variant.motion })
    const failures = await prepare(page, variant.theme)
    const details = page.getByRole('region', { name: 'Selected evidence' })
    const search = page.getByRole('textbox', { name: 'Find evidence' })
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 320, height: 740 },
      { width: 844, height: 390 },
      { width: 768, height: 1024 },
      { width: 2560, height: 720 },
    ]) {
      await page.setViewportSize(viewport)
      await expandedHeader(page)
      await expect(search).toHaveValue('forest')
      await expect(details.getByRole('heading')).toHaveText(names[0])
      await page
        .getByRole('region', { name: 'Current workspace task' })
        .evaluate((el) => el.scrollIntoView({ block: 'nearest' }))
      if (variant.motion === 'reduce')
        await expect(details.locator('.explore-detail-content')).toHaveCSS('animation-name', 'none')
      await page.screenshot({
        path: info.outputPath(`canopy-${variant.theme}-${variant.motion}-${viewport.width}x${viewport.height}.png`),
        animations: 'disabled',
      })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    for (let repeat = 0; repeat < 3; repeat++) {
      await details.getByRole('button', { name: 'relationships', exact: true }).click()
      await expect(details.getByRole('button', { name: /cites.*evidence:1$/ })).toBeVisible()
      await details.getByRole('button', { name: 'history', exact: true }).click()
      await expect(details.getByText('Synthetic reviewer')).toBeVisible()
      await page.goBack()
      await expect(details.getByRole('button', { name: 'relationships' })).toHaveAttribute('aria-pressed', 'true')
      await details.getByRole('button', { name: 'overview', exact: true }).click()
    }
    await details.getByRole('button', { name: 'Close evidence details' }).click()
    await expect(details).toHaveCount(0)
    await expect(search).toBeFocused()
    await expect(search).toHaveValue('forest')
    await page
      .getByRole('list', { name: 'Evidence results' })
      .getByRole('link', { name: new RegExp(names[0]) })
      .click()
    await expect(details.getByRole('heading')).toBeFocused()
    const find = page.getByRole('button', { name: 'Find destination', exact: true })
    await find.click()
    await page.setViewportSize({ width: 320, height: 740 })
    await page.keyboard.press('Escape')
    await expect(find).toBeFocused()
    await expect(find).toBeInViewport()
    expect(failures).toEqual([])
  })
}

test('Canopy appearance preferences retain the task and remove effects', async ({ page }, info) => {
  await prepare(page, 'light')
  const appearance = page.locator('.workspace-appearance summary')
  await appearance.click()
  await page.getByLabel('Density', { exact: true }).selectOption('comfortable')
  await expect(page.locator('html')).toHaveAttribute('data-density', 'comfortable')
  await page.getByLabel('Motion', { exact: true }).selectOption('reduce')
  await page.getByLabel('Surfaces', { exact: true }).selectOption('opaque')
  await expect(page.locator('.workspace-map')).toHaveCSS('backdrop-filter', 'none')
  await page.keyboard.press('Escape')
  await expect(appearance).toBeFocused()
  await expect(page.getByRole('textbox', { name: 'Find evidence' })).toHaveValue('forest')
  await expect(page.locator('.explore-detail-content')).toHaveCSS('animation-name', 'none')
  await page.screenshot({ path: info.outputPath('canopy-opaque-comfortable.png'), animations: 'disabled' })
  await page.emulateMedia({ forcedColors: 'active' })
  await expect(page.locator('.workspace-map')).toHaveCSS('backdrop-filter', 'none')
  await page.screenshot({ path: info.outputPath('canopy-forced-colors.png') })
})

test('Canopy keeps enlarged navigation and final detail actions reachable', async ({ page }, info) => {
  await prepare(page, 'light')
  for (const size of [
    { width: 1440, height: 540 },
    { width: 844, height: 390 },
    { width: 320, height: 740 },
  ]) {
    await page.setViewportSize(size)
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%'
    })
    const nav = page.getByRole('navigation', { name: 'Primary workspace contexts' })
    for (const name of ['work', 'explore', 'operate']) {
      const link = nav.getByRole('link', { name, exact: true })
      await link.focus()
      await expect(link).toBeInViewport()
    }
    const overflow = await page
      .locator('.workspace-context-rail, .workspace-header-row, .workspace-context-navigation')
      .evaluateAll((elements) => elements.some((element) => element.scrollWidth > element.clientWidth))
    expect(overflow).toBe(false)
    const detail = page.getByRole('region', { name: 'Selected evidence' })
    await detail.getByRole('button', { name: 'relationships', exact: true }).click()
    const last = detail.getByRole('button', { name: /cites.*evidence:11$/ })
    // Follow the real keyboard sequence into the last row, not synthetic scroll padding.
    const previous = detail.getByRole('button', { name: /cites.*evidence:10$/ })
    await previous.focus()
    await page.keyboard.press('Tab')
    await expect(last).toBeFocused()
    await expect(last).toBeInViewport()
    await expect
      .poll(() =>
        last.evaluate((element) => {
          const box = element.getBoundingClientRect()
          return [box.left + 6, box.right - 6].every((x) =>
            [box.top + 6, box.bottom - 6].every((y) => element.contains(document.elementFromPoint(x, y))),
          )
        }),
      )
      .toBe(true)
    expect(
      await page
        .locator('.workspace-route-content')
        .evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom)),
    ).toBeGreaterThanOrEqual(96)
    await page.screenshot({
      path: info.outputPath(`canopy-text-200-${size.width}x${size.height}.png`),
      animations: 'disabled',
    })
  }
})

test('Canopy dark security warning keeps its paired contrast', async ({ page }, info) => {
  await prepare(page, 'dark', true)
  const warning = page.getByTestId('auth-mode-banner')
  await expect(warning).toBeVisible()
  expect(await contrast(warning)).toBeGreaterThanOrEqual(4.5)
  const search = page.getByRole('button', { name: 'Search', exact: true })
  await search.hover()
  expect(await contrast(search)).toBeGreaterThanOrEqual(4.5)
  await page.screenshot({ path: info.outputPath('canopy-dark-security-warning.png'), animations: 'disabled' })
  await page.getByRole('button', { name: 'Open chat', exact: true }).click()
  const send = page.getByRole('button', { name: 'Send message', exact: true })
  await expect(send).toBeDisabled()
  await expect(send).toHaveCSS('opacity', '1')
  expect(await contrast(send)).toBeGreaterThanOrEqual(4.5)
  await page.screenshot({ path: info.outputPath('canopy-dark-disabled-control.png'), animations: 'disabled' })
})
async function contrast(target: Locator) {
  return target.evaluate((element) => {
    const style = getComputedStyle(element)
    const luminance = (value: string) => {
      const channels = value
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    }
    const foreground = luminance(style.color)
    const background = luminance(style.backgroundColor)
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
  })
}
