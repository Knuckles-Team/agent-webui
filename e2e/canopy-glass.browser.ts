// spec: WEBUI-DESIGN-R002.1.1
// spec: WEBUI-DESIGN-R004.1.1
// spec: WEBUI-DESIGN-R005.2
// spec: WEBUI-APPS-R049.2.1
import { expect, test, type Page, type Locator } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { baseURL, fixedTime, responses } from './fixtures/documentation-screenshots.mjs'

// Video is worker-scoped. Record only the dedicated preview command, not the full suite.
test.use({
  video: process.env.LIQUID_GLASS_PREVIEW === '1' ? { mode: 'on', size: { width: 1440, height: 900 } } : 'off',
})

const names = [
  'Project documentation',
  'Task results',
  'Setup notes',
  'Release checklist',
  'Service connection guide',
  'Agent operating instructions',
  'Troubleshooting notes',
  'Deployment plan',
  'Configuration reference',
  'Meeting follow-up',
  'Automation checklist',
  'Project summary',
]
const records = names.map((title, index) => ({
  id: `evidence:${index}`,
  type: index % 2 ? 'Note' : 'Document',
  title,
}))

async function prepare(page: Page, theme: string, securityWarning = false, selected = true) {
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
              'Synthetic project documentation for this browser preview. Setup decisions and task results retain their source context.',
            status: 'Reviewed',
            source: 'Demo project',
            coverage: 'Project workspace',
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
  await page.goto(`/workspace/explore?q=project${selected ? '&entity=evidence%3A0' : ''}`)
  if (selected)
    await expect(page.getByRole('region', { name: 'Record details' }).getByRole('heading', { level: 2 })).toHaveText(
      names[0],
    )
  await expect(page.getByText('12 matching records')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  return failures
}

async function expandedHeader(page: Page) {
  for (const name of ['Chat', 'Knowledge', 'Tools'])
    await expect(
      page.getByRole('navigation', { name: 'Primary workspace contexts' }).getByRole('link', { name, exact: true }),
    ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Find destination', exact: true })).toBeVisible()
  for (const name of ['Skip to navigation', 'Skip to content']) {
    const control = page.getByRole('button', { name, exact: true })
    await control.focus()
    await expect(control).toBeInViewport()
  }
  await page.locator('#workspace-home').focus()
  const box = await page.locator('.workspace-context-rail').boundingBox()
  expect(box!.x).toBeGreaterThan(0)
  expect(box!.x).toBeLessThanOrEqual(32)
  expect(box!.width).toBeGreaterThanOrEqual(page.viewportSize()!.width * 0.89)
  expect(Math.abs(box!.width + box!.x * 2 - page.viewportSize()!.width)).toBeLessThanOrEqual(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

test.describe('Liquid Glass reference preview', () => {
  test('project-context fixture, mobile and in-place Agent preview', async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const failures = await prepare(page, 'light')
    const contexts = page.getByRole('navigation', { name: 'Primary workspace contexts' })
    await contexts.getByRole('link', { name: 'Chat', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Chat & tasks', exact: true })).toBeVisible()
    await expect(page.getByText('Tasks and conversations', { exact: true })).toBeVisible()
    await expect(page.getByText('Loading…', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeInViewport()
    await page.screenshot({ path: info.outputPath('liquid-glass-chat-desktop-preview.png'), animations: 'disabled' })
    const attachment = page.getByRole('button', { name: 'Attach image files', exact: true })
    await expect(attachment).toHaveCSS('background-color', 'rgba(184, 207, 185, 0.64)')
    await expect(attachment).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
    await attachment.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(attachment).toBeFocused()
    await expect(attachment).toHaveCSS('outline-style', 'solid')
    expect(
      await attachment.evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth)),
    ).toBeGreaterThanOrEqual(2)
    await page.getByRole('textbox', { name: 'Message input' }).fill('Help me plan the next project step')
    await page.getByRole('heading', { name: 'Chat & tasks', exact: true }).click()
    await page.screenshot({ path: info.outputPath('liquid-glass-chat-controls-preview.png'), animations: 'disabled' })
    await page.getByRole('textbox', { name: 'Message input' }).fill('')
    await contexts.getByRole('link', { name: 'Knowledge', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Record details' }).getByRole('heading', { level: 2 })).toHaveText(
      names[0],
    )
    await page.screenshot({ path: info.outputPath('liquid-glass-desktop-preview.png'), animations: 'disabled' })
    const panels = await page
      .locator('.workspace-context-rail, .workspace-map, .explore-collection, .explore-inspector')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const style = getComputedStyle(element)
          const box = element.getBoundingClientRect()
          return {
            class: element.className,
            fill: style.backgroundColor,
            blur: style.backdropFilter,
            radius: style.borderRadius,
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
          }
        }),
      )
    await info.attach('liquid-glass-materials.json', {
      body: JSON.stringify(panels, null, 2),
      contentType: 'application/json',
    })
    for (const panel of panels) expect(panel.blur).not.toBe('none')
    const selections = await page
      .locator(
        '.workspace-map-node[aria-current], .explore-record[aria-current], .explore-control[aria-pressed="true"]',
      )
      .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).boxShadow))
    expect(selections.length).toBeGreaterThan(0)
    expect(selections.every((shadow) => shadow === 'none')).toBe(true)
    await expect(contexts.getByRole('link', { name: 'Knowledge', exact: true })).toHaveCSS('font-size', '14px')
    await expect(page.locator('#workspace-assistant')).toBeHidden()
    const details = page.getByRole('region', { name: 'Record details' })
    await details.getByRole('button', { name: 'Related records', exact: true }).click()
    await expect(details.getByRole('button', { name: /cites.*evidence:1$/ })).toBeVisible()
    await details.getByRole('button', { name: 'Details', exact: true }).click()
    await page.getByRole('button', { name: 'Expand chat', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible()
    await page.getByRole('textbox', { name: 'Message input' }).fill('Summarize this project documentation')
    await page.screenshot({ path: info.outputPath('liquid-glass-agent-expanded-preview.png'), animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(page.locator('#workspace-assistant')).toBeHidden()
    await details.getByRole('button', { name: 'Close record details' }).click()
    await page.screenshot({ path: info.outputPath('liquid-glass-collection-preview.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('.workspace-viewport').evaluate((element) => element.scrollTo(0, 0))
    await page.screenshot({ path: info.outputPath('liquid-glass-mobile-preview.png'), animations: 'disabled' })
    await contexts.getByRole('link', { name: 'Chat', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeInViewport()
    await page.screenshot({ path: info.outputPath('liquid-glass-chat-mobile-preview.png'), animations: 'disabled' })
    expect(failures).toEqual([])
  })
})

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
    await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${variant.theme}\\b`))
    await expect(page.locator('html')).toHaveAttribute('data-transparency', 'glass')
    const shellMaterial = await page.locator('.workspace-context-rail').evaluate((el) => {
      const style = getComputedStyle(el)
      return { filter: style.backdropFilter, surface: style.backgroundColor }
    })
    expect(shellMaterial.filter).not.toBe('none')
    await info.attach('effective-material', {
      body: JSON.stringify({ ...variant, ...shellMaterial }),
      contentType: 'application/json',
    })
    const details = page.getByRole('region', { name: 'Record details' })
    const search = page.getByRole('textbox', { name: 'Search knowledge' })
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 320, height: 740 },
      { width: 844, height: 390 },
      { width: 768, height: 1024 },
      { width: 2560, height: 720 },
    ]) {
      await page.setViewportSize(viewport)
      await expandedHeader(page)
      await expect(search).toHaveValue('project')
      await expect(details.getByRole('heading', { level: 2 })).toHaveText(names[0])
      await page.locator('.workspace-viewport').evaluate((el) => el.scrollTo(0, 0))
      await expect(page.locator('#workspace-home')).toBeInViewport()
      expect((await page.locator('.workspace-context-rail').boundingBox())!.y).toBeGreaterThan(0)
      if (viewport.width < 1024) {
        await expect(page.getByRole('button', { name: 'Browse workspace' })).toBeVisible()
        await expect(page.getByRole('heading', { name: 'Knowledge', exact: true })).toBeInViewport()
      }
      if (variant.motion === 'reduce')
        await expect(details.locator('.explore-detail-content')).toHaveCSS('animation-name', 'none')
      await page.screenshot({
        path: info.outputPath(`canopy-${variant.theme}-${variant.motion}-${viewport.width}x${viewport.height}.png`),
        animations: 'disabled',
      })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    for (let repeat = 0; repeat < 3; repeat++) {
      await details.getByRole('button', { name: 'Related records', exact: true }).click()
      await expect(details.getByRole('button', { name: /cites.*evidence:1$/ })).toBeVisible()
      await details.getByRole('button', { name: 'Change history', exact: true }).click()
      await expect(details.getByText('Synthetic reviewer')).toBeVisible()
      await page.goBack()
      await expect(details.getByRole('button', { name: 'Related records' })).toHaveAttribute('aria-pressed', 'true')
      await details.getByRole('button', { name: 'Details', exact: true }).click()
    }
    await details.getByRole('button', { name: 'Close record details' }).click()
    await expect(details).toHaveCount(0)
    await expect(search).toBeFocused()
    await expect(search).toHaveValue('project')
    await page
      .getByRole('list', { name: 'Knowledge results' })
      .getByRole('link', { name: new RegExp(names[0]) })
      .click()
    await expect(details.getByRole('heading', { level: 2 })).toBeFocused()
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
  await page.getByRole('combobox', { name: 'Density', exact: true }).selectOption('comfortable')
  await expect(page.locator('html')).toHaveAttribute('data-density', 'comfortable')
  await page.getByRole('combobox', { name: 'Motion', exact: true }).selectOption('reduce')
  await page.getByRole('combobox', { name: 'Surfaces', exact: true }).selectOption('opaque')
  await expect(page.locator('.workspace-map')).toHaveCSS('backdrop-filter', 'none')
  await page.keyboard.press('Escape')
  await expect(appearance).toBeFocused()
  await expect(page.getByRole('textbox', { name: 'Search knowledge' })).toHaveValue('project')
  await expect(page.locator('.explore-detail-content')).toHaveCSS('animation-name', 'none')
  await page.screenshot({ path: info.outputPath('canopy-opaque-comfortable.png'), animations: 'disabled' })
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ forcedColors: 'active', colorScheme })
    await expect(page.locator('.workspace-map')).toHaveCSS('backdrop-filter', 'none')
    const selected = page.locator(
      '.workspace-context-rail nav a[aria-current], .workspace-map-node[aria-current], .workspace-map-toggle[aria-expanded="true"], .workspace-frame-actions button[aria-pressed="true"]',
    )
    expect(await selected.count()).toBeGreaterThan(3)
    const palette = await page.evaluate(() => {
      const probe = document.createElement('span')
      probe.style.cssText = 'color:CanvasText;background:Canvas;border-color:Highlight'
      document.body.append(probe)
      const style = getComputedStyle(probe)
      const result = { color: style.color, background: style.backgroundColor, border: style.borderTopColor }
      probe.remove()
      return result
    })
    const brand = page.locator('#workspace-home')
    await expect(brand).toHaveCSS('color', palette.color)
    await expect(brand).toHaveCSS('background-color', palette.background)
    await expect(brand.locator('span')).toHaveCSS('color', palette.color)
    expect(await contrast(brand)).toBeGreaterThanOrEqual(4.5)
    for (const control of await selected.all()) {
      await expect(control).toHaveCSS('color', palette.color)
      await expect(control).toHaveCSS('background-color', palette.background)
      await expect(control).toHaveCSS('border-top-color', palette.border)
      expect(await contrast(control)).toBeGreaterThanOrEqual(4.5)
    }
    await page.screenshot({ path: info.outputPath(`canopy-forced-colors-${colorScheme}.png`) })
  }
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
    for (const name of ['Chat', 'Knowledge', 'Tools']) {
      const link = nav.getByRole('link', { name, exact: true })
      await link.focus()
      await expect(link).toBeInViewport()
    }
    const overflow = await page
      .locator('.workspace-context-rail, .workspace-header-row, .workspace-context-navigation')
      .evaluateAll((elements) => elements.some((element) => element.scrollWidth > element.clientWidth))
    expect(overflow).toBe(false)
    const detail = page.getByRole('region', { name: 'Record details' })
    await detail.getByRole('button', { name: 'Related records', exact: true }).click()
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
          // Rounded corners are unpainted at enlarged text; each painted edge must remain reachable.
          const centerX = box.left + box.width / 2
          const centerY = box.top + box.height / 2
          return [
            [centerX, centerY],
            [box.left + 6, centerY],
            [box.right - 6, centerY],
            [centerX, box.top + 6],
            [centerX, box.bottom - 6],
          ].every(([x, y]) => element.contains(document.elementFromPoint(x, y)))
        }),
      )
      .toBe(true)
    await expect(page.locator('#chat-panel-toggle')).toHaveCount(0)
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
  await page.getByRole('button', { name: 'Expand chat', exact: true }).click()
  await page.getByRole('button', { name: 'Focus message input', exact: true }).click()
  const send = page.getByRole('button', { name: 'Send message', exact: true })
  await expect(send).toBeDisabled()
  await expect(send).toHaveCSS('opacity', '1')
  expect(await contrast(send)).toBeGreaterThanOrEqual(4.5)
  await page.screenshot({ path: info.outputPath('canopy-dark-disabled-control.png'), animations: 'disabled' })
})
async function contrast(target: Locator) {
  return target.evaluate((element) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')!
    // Resolve modern color(srgb ...), color-mix and alpha through the browser,
    // rather than treating every serialized color as 0-255 rgb() channels.
    function rgba(value: string) {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = value
      context.fillRect(0, 0, 1, 1)
      return Array.from(context.getImageData(0, 0, 1, 1).data)
    }
    function background(node: Element | null): number[] {
      if (!node) return [255, 255, 255, 255]
      const color = rgba(getComputedStyle(node).backgroundColor)
      const parent = background(node.parentElement)
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
    const foreground = luminance(rgba(getComputedStyle(element).color))
    const back = luminance(background(element))
    return (Math.max(foreground, back) + 0.05) / (Math.min(foreground, back) + 0.05)
  })
}

// Fresh entry is different evidence from a retained, already-scrolled task.
test('Canopy narrow entry and explicit map keep a usable task', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await prepare(page, 'glass', false, false)
  await expect(page.getByRole('button', { name: 'Browse workspace' })).toBeVisible()
  expect((await page.locator('.workspace-context-rail').boundingBox())!.y).toBeGreaterThan(0)
  await expect(page.locator('#workspace-home')).toBeInViewport()
  await expect(page.getByRole('textbox', { name: 'Search knowledge' })).toBeInViewport()
  await page.screenshot({ path: info.outputPath('canopy-narrow-entry.png'), animations: 'disabled' })
  const skip = page.getByRole('button', { name: 'Skip to navigation', exact: true })
  await skip.focus()
  await page.keyboard.press('Enter')
  const filter = page.getByRole('searchbox', { name: 'Find a page or item' })
  await expect(filter).toBeFocused()
  await expect(filter).toBeInViewport()
  const map = page.getByRole('complementary', { name: 'Workspace map' })
  expect((await map.boundingBox())!.height).toBeLessThanOrEqual(223)
  await page.screenshot({ path: info.outputPath('canopy-narrow-map-expanded.png'), animations: 'disabled' })
  await page.getByRole('button', { name: 'Hide workspace navigation' }).click()
  const detail = page.getByRole('region', { name: 'Record details' })
  await page
    .getByRole('list', { name: 'Knowledge results' })
    .getByRole('link', { name: new RegExp(names[0]) })
    .click()
  await expect(detail.getByRole('heading', { level: 2 })).toBeFocused()
  await expect(detail.getByRole('heading', { level: 2 })).toBeInViewport()
  await page.screenshot({ path: info.outputPath('canopy-narrow-focused-detail.png'), animations: 'disabled' })
  await detail.getByRole('button', { name: 'Close record details' }).click()
  const search = page.getByRole('textbox', { name: 'Search knowledge' })
  await expect(search).toBeFocused()
  await expect(search).toBeInViewport()
  await expect(search).toHaveValue('project')
  await page.screenshot({ path: info.outputPath('canopy-narrow-returned-search.png'), animations: 'disabled' })
})

// spec: WEBUI-DESIGN-R005.4
// spec: WEBUI-DESIGN-R005.5
test('manual wallpaper settings retain the rendered workspace and bounded backing store', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const failures = await prepare(page, 'light')
  const canvas = page.locator('.workspace-wallpaper')
  await expect(canvas).toHaveCount(1)
  await expect(canvas).toHaveAttribute('aria-hidden', 'true')
  await expect(canvas).toHaveCSS('pointer-events', 'none')
  await page.locator('.workspace-appearance > summary').click()
  await expect(page.getByLabel('Wallpaper motion')).toHaveValue('off')
  await expect(page.getByText(/Manual weather only/)).toBeVisible()
  await page.getByLabel('Wallpaper scene').selectOption('tree')
  await page.getByLabel('Weather preview (manual)').selectOption('thunderstorm')
  const measurements = []
  for (const mode of ['off', 'subtle', 'expressive']) {
    await page.getByLabel('Wallpaper motion').selectOption(mode)
    const result = await canvas.evaluate(async (element) => {
      const node = element as HTMLCanvasElement
      const first = node.toDataURL()
      const frames: number[] = []
      const longTasks: number[] = []
      const memory = performance as Performance & { memory?: { usedJSHeapSize: number } }
      const heapBefore = memory.memory?.usedJSHeapSize ?? null
      const supportsLongTask = PerformanceObserver.supportedEntryTypes.includes('longtask')
      const observer = supportsLongTask
        ? new PerformanceObserver((list) => {
            longTasks.push(...list.getEntries().map((entry) => entry.duration))
          })
        : null
      observer?.observe({ type: 'longtask' })
      let previous = performance.now()
      const start = previous
      await new Promise<void>((resolve) => {
        function sample(now: number) {
          frames.push(now - previous)
          previous = now
          if (now - start >= 1000) resolve()
          else requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
      observer?.disconnect()
      return {
        longTasks: supportsLongTask ? longTasks : null,
        heapBefore,
        heapAfter: memory.memory?.usedJSHeapSize ?? null,
        width: node.width,
        height: node.height,
        changed: first !== node.toDataURL(),
        rafIntervals: frames,
        dpr: devicePixelRatio,
        userAgent: navigator.userAgent,
      }
    })
    expect(result.width * result.height).toBeLessThanOrEqual(800_000)
    expect(result.changed).toBe(mode !== 'off')
    // A trusted keyboard event to its next animation frame, not remote-driver latency.
    await page.evaluate(() => {
      delete document.documentElement.dataset.wallpaperInputSample
      document.addEventListener(
        'keydown',
        (event) => {
          const delivered = performance.now() - event.timeStamp
          requestAnimationFrame(() => {
            document.documentElement.dataset.wallpaperInputSample = JSON.stringify({
              trusted: event.isTrusted,
              deliveredMs: delivered,
              nextFrameMs: performance.now() - event.timeStamp,
            })
          })
        },
        { once: true },
      )
    })
    await page.keyboard.press('Tab')
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper-input-sample', /trusted/)
    const inputSample = await page.locator('html').getAttribute('data-wallpaper-input-sample')
    measurements.push({ mode, ...result, inputSample: JSON.parse(inputSample!) })
    await page.keyboard.press('Escape')
    await expect(page.locator('.workspace-appearance > summary')).toBeFocused()
    await page.screenshot({ path: info.outputPath(`wallpaper-${mode}.png`) })
    await page.locator('.workspace-appearance > summary').click()
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  // Let the browser deliver its media-query change before comparing static pixels.
  await page.waitForTimeout(100)
  const staticImage = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())
  await page.waitForTimeout(250)
  expect(await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())).toBe(staticImage)
  await page.getByLabel('Surfaces').selectOption('opaque')
  await expect(canvas).toBeHidden()
  await page.getByLabel('Surfaces').selectOption('glass')
  await expect(canvas).toBeVisible()
  await expect.poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).width)).toBeGreaterThan(1)
  const samplePath = info.outputPath('wallpaper-cadence-sample.json')
  await writeFile(
    samplePath,
    JSON.stringify({
      note: 'Synthetic fixture: one-second browser rAF/long-task samples, one trusted key-to-frame sample and optional Chromium JS heap snapshots. Not canvas FPS, total memory or long-run production acceptance.',
      measurements,
    }),
  )
  await info.attach('wallpaper-cadence-sample.json', { path: samplePath, contentType: 'application/json' })
  expect(failures).toEqual([])
})

// spec: WEBUI-DESIGN-R002.1.1
for (const palette of ['Green', 'Blue', 'Red', 'Purple', 'Pink', 'Orange', 'Yellow']) {
  test(`Canopy ${palette} palette native gallery and accessible states`, async ({ page }, info) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    const failures = await prepare(page, 'light')
    await page
      .getByRole('navigation', { name: 'Primary workspace contexts' })
      .getByRole('link', { name: 'Chat', exact: true })
      .click()
    const input = page.getByRole('textbox', { name: 'Message input' })
    await input.fill('Synthetic palette gallery draft — do not send')
    const appearance = page.locator('.workspace-appearance summary')
    const primary = page.getByRole('button', { name: 'Send message', exact: true })
    const neutral = page.getByRole('button', { name: 'Attach image files', exact: true })
    const evidence: object[] = []
    for (const theme of ['light', 'dark'] as const) {
      for (const material of ['glass', 'opaque', 'forced'] as const) {
        await page.emulateMedia({ colorScheme: theme, forcedColors: material === 'forced' ? 'active' : 'none' })
        await appearance.click()
        await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme)
        await page
          .getByRole('combobox', { name: 'Surfaces', exact: true })
          .selectOption(material === 'opaque' ? 'opaque' : 'glass')
        await page.getByRole('combobox', { name: 'Palette', exact: true }).selectOption({ label: palette })
        await page.keyboard.press('Escape')
        await expect(appearance).toBeFocused()
        await expect(input).toHaveValue('Synthetic palette gallery draft — do not send')
        await expect(primary).toBeEnabled()
        if (material !== 'glass') await expect(page.locator('.workspace-map')).toHaveCSS('backdrop-filter', 'none')
        for (const [name, control] of [
          ['primary', primary],
          ['neutral', neutral],
        ] as const) {
          await page.mouse.move(0, 0)
          const resting = await contrast(control)
          expect(resting).toBeGreaterThanOrEqual(4.5)
          await control.hover()
          const hover = await contrast(control)
          expect(hover).toBeGreaterThanOrEqual(4.5)
          await page.mouse.down()
          const pressed = await contrast(control)
          expect(pressed).toBeGreaterThanOrEqual(4.5)
          // Release away from the control: never submit a message or open a file dialog.
          await page.mouse.move(0, 0)
          await page.mouse.up()
          await control.focus()
          await page.keyboard.press('Tab')
          await page.keyboard.press('Shift+Tab')
          await expect(control).toBeFocused()
          await expect(control).toHaveCSS('outline-style', 'solid')
          expect(
            await control.evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth)),
          ).toBeGreaterThanOrEqual(2)
          const styles = await control.evaluate((element) => {
            const css = getComputedStyle(element)
            return { fill: css.backgroundColor, text: css.color, focus: css.outlineColor }
          })
          evidence.push({ theme, material, control: name, resting, hover, pressed, ...styles })
        }
        await page.screenshot({
          path: info.outputPath(`palette-${palette.toLowerCase()}-${theme}-${material}.png`),
          animations: 'disabled',
        })
      }
    }
    const evidencePath = info.outputPath('palette-computed-contrast.json')
    await writeFile(
      evidencePath,
      JSON.stringify(
        {
          note: 'Browser-resolved CSS ancestor compositing; screenshots separately require pixel review over the wallpaper.',
          evidence,
        },
        null,
        2,
      ),
    )
    await info.attach('palette-computed-contrast.json', { path: evidencePath, contentType: 'application/json' })
    expect(failures).toEqual([])
  })
}

// Chromium exposes reduced-transparency through CDP; assert support before claiming evidence.
test('Canopy palette follows supported system reduced transparency', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'Reduced-transparency emulation requires Chromium CDP')
  await prepare(page, 'light')
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
  })
  const supported = await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches)
  test.skip(!supported, 'Browser does not support reduced-transparency emulation')
  const appearance = page.locator('.workspace-appearance summary')
  for (const theme of ['light', 'dark']) {
    await appearance.click()
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme)
    await page.getByRole('combobox', { name: 'Palette', exact: true }).selectOption({ label: 'Purple' })
    await page.keyboard.press('Escape')
    await expect(page.locator('.workspace-map')).toHaveCSS('backdrop-filter', 'none')
    expect(await contrast(page.getByRole('button', { name: 'Search', exact: true }))).toBeGreaterThanOrEqual(4.5)
    await page.screenshot({
      path: info.outputPath(`palette-purple-${theme}-reduced-transparency.png`),
      animations: 'disabled',
    })
  }
  await session.detach()
})

// spec: WEBUI-DESIGN-R005.4
// Golden crop comes from the accepted #180 desktop capture (runtime 83d52c8).
// A text-free inspector region pins actual frost, not merely computed blur.
test('default wallpaper preserves accepted glass backdrop pixels', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await prepare(page, 'light')
  await expect(page.locator('.workspace-wallpaper')).toHaveAttribute('data-active', 'false')
  await expect(page.locator('.workspace-wallpaper')).toBeHidden()
  await expect(page.locator('.workspace-frame')).toHaveCSS('isolation', 'auto')
  // Direct clipped screenshots can change the browser's backdrop-filter rasterization.
  // Crop a completed full viewport capture instead, exactly as the accepted golden was made.
  const capture = await page.screenshot({ animations: 'disabled' })
  const region = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = 120
    canvas.height = 150
    canvas.getContext('2d')!.drawImage(bitmap, -1250, -600)
    bitmap.close()
    return canvas.toDataURL().split(',')[1]
  }, capture.toString('base64'))
  expect(Buffer.from(region, 'base64')).toMatchSnapshot('canopy-default-glass-region.png', {
    threshold: 0,
    maxDiffPixels: 0,
  })
})

// spec: WEBUI-DESIGN-R005.3, WEBUI-DESIGN-R005.3.1
test('Follow workspace resolves real page context without enabling motion and manual scenes override it', async ({
  page,
}, info) => {
  const failures = await prepare(page, 'light')
  const canvas = page.locator('.workspace-wallpaper')
  const contexts = page.getByRole('navigation', { name: 'Primary workspace contexts' })
  await page.locator('.workspace-appearance > summary').click()
  await page.getByLabel('Wallpaper scene').selectOption('context')
  await expect(page.getByLabel('Wallpaper motion')).toHaveValue('off')
  await expect(canvas).toHaveAttribute('data-scene', 'canopy')
  await page.locator('.workspace-appearance > summary').click()
  await contexts.getByRole('link', { name: 'Chat', exact: true }).click()
  await expect(canvas).toHaveAttribute('data-scene', 'tree')
  const input = page.getByRole('textbox', { name: 'Message input' })
  await input.fill('Synthetic context scene draft — do not send')
  await contexts.getByRole('link', { name: 'Tools', exact: true }).click()
  await expect(canvas).toHaveAttribute('data-scene', 'roots')
  await page.screenshot({ path: info.outputPath('wallpaper-context-tools.png') })
  await page.locator('.workspace-appearance > summary').click()
  await expect(page.getByLabel('Wallpaper motion')).toHaveValue('off')
  await page.getByLabel('Wallpaper scene').selectOption('fluid')
  await page.locator('.workspace-appearance > summary').click()
  await contexts.getByRole('link', { name: 'Chat', exact: true }).click()
  await expect(canvas).toHaveAttribute('data-scene', 'fluid')
  await expect(input).toHaveValue('Synthetic context scene draft — do not send')
  expect(failures).toEqual([])
})
