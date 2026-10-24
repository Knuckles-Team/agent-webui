// spec: WEBUI-DESIGN-R004.2.1
import { expect, test } from '@playwright/test'

for (const simulatedKeyboard of [true, false]) {
  test(`query continuity with ${simulatedKeyboard ? 'simulated keyboard occlusion' : 'native viewport resize'}`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000)
    let finishQuery: () => void = () => undefined
    const pending = new Promise<void>((resolve) => {
      finishQuery = resolve
    })
    await page.route('**/auth/session', (route) =>
      route.fulfill({
        json: {
          authenticated: true,
          subject: 'viewport-user',
          tenant: 'viewport-tenant',
          webui_role: 'maintainer',
          roles: ['kg:read'],
        },
      }),
    )
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/sparql') {
        await pending
        return route.fulfill({
          json: {
            status: 'success',
            head: { vars: ['record'] },
            results: { bindings: [{ record: { type: 'literal', value: 'Retained result' } }] },
          },
        })
      }
      if (path.startsWith('/api/configure')) return route.fulfill({ json: { models: [], builtinTools: [] } })
      if (path === '/api/enhanced/models') return route.fulfill({ json: { models: [], default_id: '' } })
      if (path === '/api/chats') return route.fulfill({ json: [] })
      return route.fulfill({ status: 501, json: { detail: 'Unavailable in synthetic viewport fixture' } })
    })
    // Deterministic keyboard-like occlusion. This is not native soft-keyboard acceptance.
    await page.addInitScript((simulate) => {
      localStorage.setItem('agent-webui.consent-dismissed', 'agent-webui-consent-v1')
      if (!simulate) return
      const viewport = Object.assign(new EventTarget(), { height: 740, scale: 1 })
      Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
    }, simulatedKeyboard)
    await page.setViewportSize({ width: 320, height: 740 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/workspace/explore?lens=query')
    const draft = page.getByRole('textbox', { name: 'SPARQL query' })
    await draft.fill('SELECT ?record WHERE { ?record ?p ?o }')
    await draft.press('Control+Enter')
    await expect(page.getByText('Running query…', { exact: true })).toBeVisible()
    await draft.fill('SELECT ?record WHERE { ?record ?p ?o } LIMIT 7')
    if (simulatedKeyboard)
      await page.evaluate(() => {
        Object.assign(window.visualViewport!, { height: 280 })
        window.visualViewport!.dispatchEvent(new Event('resize'))
      })
    else await page.setViewportSize({ width: 320, height: 280 })
    await expect(page.locator('.workspace-viewport')).toHaveCSS('height', '280px')
    await expect(draft).toBeFocused()
    await expect(draft).toHaveValue(/LIMIT 7$/)
    await expect
      .poll(async () => {
        const box = (await draft.boundingBox())!
        return box.y + box.height
      })
      .toBeLessThanOrEqual(280)
    expect((await draft.boundingBox())!.y).toBeGreaterThanOrEqual(0)
    finishQuery()
    await expect(page.getByText('Query complete: 1 row(s).', { exact: true })).toBeVisible()
    for (const viewport of [
      { width: 740, height: 320 },
      { width: 320, height: 740 },
      { width: 640, height: 360 },
    ]) {
      await page.setViewportSize(viewport)
      if (simulatedKeyboard)
        await page.evaluate((height) => {
          Object.assign(window.visualViewport!, { height })
          window.visualViewport!.dispatchEvent(new Event('resize'))
        }, viewport.height)
      await expect(draft).toHaveValue(/LIMIT 7$/)
      const results = page.getByRole('button', { name: 'Results', exact: true })
      await results.focus()
      await results.press('Enter')
      await expect(page.getByRole('region', { name: 'SPARQL result table' })).toContainText('Retained result')
      const editor = page.getByRole('button', { name: 'Editor', exact: true })
      await editor.focus()
      await editor.press('Enter')
      await expect(draft).toHaveValue(/LIMIT 7$/)
      await draft.focus()
      await info.attach(`query-${viewport.width}x${viewport.height}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
  })
}
