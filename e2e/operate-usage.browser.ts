// spec: OVERSTORY-APPS-R049.2.1
import { expect, test, type Locator, type Page } from '@playwright/test'

// Browser qualification for OVERSTORY-APPS-R049.1.16; not a local verification receipt.
// Synthetic source qualification only, not installed analytics producers.
test.use({ trace: 'retain-on-failure', hasTouch: true })
async function tabTo(page: Page, target: Locator) {
  for (let index = 0; index < 100; index++) {
    await page.keyboard.press('Tab')
    if (await target.evaluate((element) => element === document.activeElement)) return
  }
  throw new Error('Usage action was not reachable through native Tab navigation')
}
for (const viewport of [
  { width: 320, height: 640 },
  { width: 740, height: 320 },
  { width: 1440, height: 900 },
]) {
  test(`usage context, keyboard, touch and history at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport)
    let denied = false
    const sessionToken = crypto.randomUUID()
    await page.route('**/auth/session', (route) =>
      route.fulfill({
        json: {
          authenticated: true,
          subject: 'usage-user',
          tenant: 'synthetic',
          webui_role: 'user',
          roles: ['usage:read'],
          csrf_token: sessionToken,
        },
      }),
    )
    const session = {
      id: 'session-one',
      project: 'Usage fixture project',
      agent: 'synthetic-agent',
      message_count: 1,
      total_output_tokens: 2,
      cost_usd: 0,
      outcome: 'complete',
      origin: 'runtime',
    }
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname
      if (path.startsWith('/api/observability/')) {
        if (denied) return route.fulfill({ status: 403, json: { detail: 'denied' } })
        if (path.endsWith('/summary'))
          return route.fulfill({
            json: {
              session_count: 1,
              totals: {
                input_tokens: 1,
                output_tokens: 2,
                cache_creation_tokens: 0,
                cache_read_tokens: 0,
                reasoning_tokens: 0,
                cost_usd: 0,
              },
              cache_hit_rate: 0,
            },
          })
        if (path.endsWith('/top-sessions')) return route.fulfill({ json: [session] })
        if (path.endsWith('/sessions/session-one'))
          return route.fulfill({
            json: {
              session,
              messages: [
                {
                  ordinal: 0,
                  role: 'user',
                  content: 'Synthetic timeline evidence',
                  model: 'synthetic-model',
                  context_tokens: 1,
                  output_tokens: 2,
                  has_tool_use: false,
                },
              ],
              tool_calls: [],
              usage_events: [],
            },
          })
        if (path.endsWith('/traces')) return route.fulfill({ json: { enabled: false, host: '', traces: [] } })
        return route.fulfill({ json: [] })
      }
      if (path.startsWith('/api/v1/ops/fleet.'))
        return route.fulfill({
          json: {
            ok: true,
            result: { value: path.endsWith('fleet.status') ? { children: {} } : { items: [], next_cursor: null } },
            meta: { registry_digest: 'synthetic', api_version: '1' },
          },
        })
      if (path === '/api/enhanced/tools')
        return route.fulfill({ json: { source: 'epistemic_graph', servers: [], components: [] } })
      if (path.startsWith('/api/configure')) return route.fulfill({ json: { models: [], builtinTools: [] } })
      if (path === '/api/enhanced/models') return route.fulfill({ json: { models: [], default_id: '' } })
      if (path === '/api/chats') return route.fulfill({ json: [] })
      return route.fulfill({ status: 501, json: { detail: 'Not available in synthetic usage fixture' } })
    })
    await page.addInitScript(() => localStorage.setItem('agent-webui.consent-dismissed', 'agent-webui-consent-v1'))
    await page.goto('/workspace/operate?lens=usage&usagePanel=sessions&usageProject=retained-project')
    const usage = page.getByRole('region', { name: 'Usage analysis', exact: true })
    await expect(usage.getByText('$0.00', { exact: true }).first()).toBeVisible()
    const appearance = page.locator('.workspace-appearance summary')
    await appearance.click()
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light')
    await page.getByRole('combobox', { name: 'Motion', exact: true }).selectOption('reduce')
    await page.getByRole('combobox', { name: 'Surfaces', exact: true }).selectOption('glass')
    await page.keyboard.press('Escape')
    await expect(usage).toHaveCSS('backdrop-filter', 'blur(16px) saturate(1.15)')
    const refresh = usage.getByRole('button', { name: 'Refresh usage' })
    await expect(refresh).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
    await expect(refresh).toHaveCSS('background-color', 'rgba(184, 207, 185, 0.64)')
    await refresh.focus()
    await expect(refresh).toHaveCSS('outline-style', 'solid')

    const open = usage.getByRole('button', { name: 'Open session Usage fixture project' })
    await tabTo(page, open)
    await expect(open).toBeFocused()
    expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await page.keyboard.press('Enter')
    await expect(usage.getByRole('article', { name: 'Usage session detail' })).toBeVisible()
    await usage.getByRole('button', { name: 'Session timeline' }).tap()
    await expect(usage.getByText('Synthetic timeline evidence')).toBeVisible()
    await page.goBack()
    await expect(usage.getByRole('article', { name: 'Usage session detail' })).toBeVisible()
    await page.goForward()
    await expect(usage.getByRole('article', { name: 'Session timeline' })).toBeVisible()
    await page.getByRole('navigation', { name: 'Operate lenses' }).getByRole('link', { name: 'Health' }).tap()
    await page.getByRole('navigation', { name: 'Operate lenses' }).getByRole('link', { name: 'Services' }).tap()
    await page
      .getByRole('navigation', { name: 'Operate lenses' })
      .getByRole('link', { name: 'Usage', exact: true })
      .tap()
    await expect(usage.getByText('Synthetic timeline evidence')).toBeVisible()
    await expect(page).toHaveURL(/usageProject=retained-project/)
    expect(await usage.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const path = info.outputPath(`usage-${viewport.width}x${viewport.height}.png`)
    await page.screenshot({ path, animations: 'disabled' })
    await info.attach('Contextual usage', { path, contentType: 'image/png' })
    if (viewport.width === 1440) {
      await appearance.click()
      await page.getByRole('combobox', { name: 'Palette', exact: true }).selectOption({ label: 'Purple' })
      await page.keyboard.press('Escape')
      await page.screenshot({ path: info.outputPath('usage-purple.png'), animations: 'disabled' })
      await appearance.click()
      await page.getByRole('combobox', { name: 'Surfaces', exact: true }).selectOption('opaque')
      await page.keyboard.press('Escape')
      await expect(usage).toHaveCSS('backdrop-filter', 'none')
      await page.screenshot({ path: info.outputPath('usage-opaque.png'), animations: 'disabled' })
      await page.emulateMedia({ forcedColors: 'active' })
      await expect(usage).toHaveCSS('backdrop-filter', 'none')
      await expect(usage).toHaveCSS('box-shadow', 'none')
      await page.emulateMedia({ forcedColors: 'none' })
      await expect(usage.getByText('Synthetic timeline evidence')).toBeVisible()
    }
    denied = true
    await usage.getByRole('button', { name: 'Refresh usage' }).tap()
    await expect(usage.getByRole('alert')).toContainText('Usage access was denied')
    await expect(usage.getByText('Synthetic timeline evidence')).toHaveCount(0)
  })
}
