import { expect, test } from '@playwright/test'

// Synthetic responses only; keep browser evidence when the journey fails.
test.use({ trace: 'retain-on-failure' })
test.beforeEach(({ page }) => {
  let count = 0
  page.on('pageerror', (error) => {
    if (count++ < 10) console.error('Catalog fixture page error:', error.message.slice(0, 1000))
  })
})
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus)
    console.error('Catalog fixture DOM:', (await page.locator('body').innerText()).slice(0, 8000))
})

// spec: WEBUI-APPS-R046.2.2
// spec: WEBUI-APPS-R049.1.2
test('catalog definitions share deep links, keyboard search and native history across viewport changes', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  let withdrawn = false
  const sessionToken = crypto.randomUUID()
  await page.route('**/auth/session', (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        subject: 'catalog-reader',
        tenant: 'synthetic',
        webui_role: 'reader',
        roles: ['kg:read'],
        csrf_token: sessionToken,
      },
    }),
  )
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/dashboard/readiness')
      return route.fulfill({
        json: {
          schema_version: 'arbora.readiness.v1',
          snapshot_id: 'synthetic-tools-snapshot',
          observed_at: '2026-01-15T12:00:00Z',
          overall: 'ready',
          checks: { catalog: { state: 'ready' } },
          required_failures: [],
          degraded_reasons: [],
        },
      })
    if (path === '/api/enhanced/tools')
      return route.fulfill({
        json: {
          source: 'epistemic_graph',
          servers: [{ server_id: 'srv:records', name: 'records', status: 'available', tool_count: 1 }],
          components: withdrawn
            ? []
            : ['Lookup', 'Summarize'].map((name) => ({
                id: `tool:${name}`,
                name,
                kind: 'tool',
                server_name: 'records',
                description: `Synthetic ${name} definition`,
                status: 'active',
                authority: 'agent_component',
                revision: 1,
              })),
        },
      })
    if (path.startsWith('/api/v1/ops/fleet.'))
      return route.fulfill({
        json: {
          ok: true,
          result: { value: path.endsWith('fleet.status') ? { children: {} } : { items: [], next_cursor: null } },
          meta: { registry_digest: 'synthetic', api_version: '1' },
        },
      })
    if (path.startsWith('/api/configure')) return route.fulfill({ json: { models: [], builtinTools: [] } })
    if (path === '/api/enhanced/models') return route.fulfill({ json: { models: [], default_id: '' } })
    if (path === '/api/chats') return route.fulfill({ json: [] })
    return route.fulfill({ status: 501, json: { detail: 'Unavailable in synthetic catalog fixture' } })
  })
  await page.addInitScript(() => localStorage.setItem('agent-webui.consent-dismissed', 'agent-webui-consent-v1'))
  await page.goto('/workspace/operate?connector=srv%3Arecords&definition=tool%3ALookup')
  const catalog = page.getByRole('region', { name: 'Connector catalog', exact: true })
  const detail = catalog.getByRole('region', { name: 'Selected catalog definition' })
  await expect(detail).toContainText('Synthetic Lookup definition')
  // spec: WEBUI-APPS-R049.2.1 — shared materials do not change catalog state.
  await page.setViewportSize({ width: 1440, height: 900 })
  const appearance = page.locator('.workspace-appearance summary')
  await appearance.click()
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light')
  await page.getByRole('combobox', { name: 'Motion', exact: true }).selectOption('reduce')
  await page.getByRole('combobox', { name: 'Surfaces', exact: true }).selectOption('glass')
  await page.keyboard.press('Escape')
  await expect(catalog).toHaveCSS('backdrop-filter', 'blur(16px) saturate(1.15)')
  const inspect = catalog.getByRole('link', { name: 'tool: Summarize' })
  await expect(inspect).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
  await expect(inspect).toHaveCSS('background-color', 'rgba(184, 207, 185, 0.64)')
  await expect(page.getByText('Backend readiness: ready')).toBeVisible()
  await page.screenshot({ path: info.outputPath('tools-desktop.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: info.outputPath('tools-mobile.png'), animations: 'disabled' })
  await page.locator('.workspace-route-content').evaluate((element) => {
    element.scrollTop = 0
  })
  await page.screenshot({ path: info.outputPath('tools-health-mobile.png'), animations: 'disabled' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: info.outputPath('tools-health-desktop.png'), animations: 'disabled' })
  await catalog.scrollIntoViewIfNeeded()
  await appearance.click()
  await page.getByRole('combobox', { name: 'Palette', exact: true }).selectOption({ label: 'Purple' })
  await page.keyboard.press('Escape')
  await expect(inspect).not.toHaveCSS('background-color', 'rgba(184, 207, 185, 0.64)')
  await page.screenshot({ path: info.outputPath('tools-purple.png'), animations: 'disabled' })
  await appearance.click()
  await page.getByRole('combobox', { name: 'Surfaces', exact: true }).selectOption('opaque')
  await page.keyboard.press('Escape')
  await expect(catalog).toHaveCSS('backdrop-filter', 'none')
  await page.screenshot({ path: info.outputPath('tools-opaque.png'), animations: 'disabled' })
  await page.emulateMedia({ forcedColors: 'active' })
  await expect(catalog).toHaveCSS('backdrop-filter', 'none')
  await expect(catalog).toHaveCSS('box-shadow', 'none')
  await page.emulateMedia({ forcedColors: 'none' })
  await appearance.click()
  await page.getByRole('combobox', { name: 'Palette', exact: true }).selectOption({ label: 'Green' })
  await page.getByRole('combobox', { name: 'Surfaces', exact: true }).selectOption('glass')
  await page.keyboard.press('Escape')
  await expect(detail).toContainText('Synthetic Lookup definition')
  await catalog.getByRole('link', { name: 'tool: Summarize' }).focus()
  await page.keyboard.press('Enter')
  await expect(detail).toContainText('Synthetic Summarize definition')
  await expect(catalog.getByRole('heading', { name: 'Catalog tools and skills' })).toBeFocused()
  await page.goBack()
  await expect(detail).toContainText('Synthetic Lookup definition')
  await page.goForward()
  await expect(detail).toContainText('Synthetic Summarize definition')
  await page.reload()
  await expect(detail).toContainText('Synthetic Summarize definition')
  await catalog.getByRole('textbox', { name: 'Filter catalog connectors' }).fill('unmatched')
  await expect(detail).toBeVisible()
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 740, height: 320 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
    { width: 2560, height: 720 },
    { width: 587, height: 913 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(detail).toContainText('Synthetic Summarize definition')
    expect(await catalog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    const action = catalog.getByRole('link', { name: 'tool: Lookup' })
    await action.focus()
    await expect(action).toBeFocused()
    expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await info.attach(`catalog-${viewport.width}x${viewport.height}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  }
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Search destinations' }).fill('Lookup')
  await dialog.getByRole('link', { name: 'tool: Lookup (records)' }).focus()
  await page.keyboard.press('Enter')
  await expect(dialog).not.toBeVisible()
  await expect(detail).toContainText('Synthetic Lookup definition')
  await expect(catalog.getByRole('textbox')).toHaveValue('unmatched')
  withdrawn = true
  await catalog.getByRole('button', { name: 'Refresh connector catalog' }).click()
  await expect(catalog.getByRole('alert')).toHaveText('This definition is not in the current connector catalog.')
  await expect(detail).toHaveCount(0)
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === '/workspace/operate' &&
      url.searchParams.get('connector') === 'srv:records' &&
      url.searchParams.get('definition') === 'tool:Lookup' &&
      url.searchParams.get('lens') === 'services',
  )
})
