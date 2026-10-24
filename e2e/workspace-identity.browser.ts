import { expect, test } from '@playwright/test'

for (const theme of ['light', 'dark', 'glass']) {
  test(`Arbora shell identity and contrast in ${theme}`, async ({ page }, info) => {
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
      await selected.focus()
      await expect(selected).toBeInViewport()
      expect(await page.locator('.workspace-frame').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
      await page.locator('.workspace-context-rail nav a[aria-current]').hover()
      const contrast = await page
        .locator(
          '.workspace-context-rail nav a[aria-current], .workspace-map-node, .workspace-map-context p, .workspace-frame-eyebrow, .workspace-frame-actions button',
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
              ratio: (Math.max(foreground, back) + 0.05) / (Math.min(foreground, back) + 0.05),
            }
          })
        })
      for (const result of contrast) expect(result.ratio, `${theme}: ${result.label}`).toBeGreaterThanOrEqual(4.5)
      await selected.focus()
      await page.screenshot({ path: info.outputPath(`identity-${theme}-${size.width}x${size.height}.png`) })
    }
  })
}
