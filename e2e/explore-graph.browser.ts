// spec: OVERSTORY-APPS-R049.1.14
// Synthetic rendered acceptance fixture; installed-provider parity is separate.
import { expect, test } from '@playwright/test'
import { baseURL, responses } from './fixtures/documentation-screenshots.mjs'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 320, height: 740 },
  { width: 844, height: 390 },
]) {
  test(`native graph continuity ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport)
    let denied = false
    const writes: string[] = []
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== baseURL) return route.abort('blockedbyclient')
      if (url.pathname.startsWith('/api/enhanced/graph/')) {
        if (route.request().method() !== 'GET') writes.push(url.pathname)
        if (denied) return route.fulfill({ status: 403, json: { detail: 'Synthetic denial' } })
        if (url.pathname.endsWith('/nodes'))
          return route.fulfill({
            json: [
              {
                id: 'graph-a',
                labels: ['Person'],
                properties: { name: 'Graph Alpha', note: '<script>plain text</script>' },
              },
              { id: 'graph-b', labels: ['Person'], properties: { name: 'Graph Beta' } },
            ],
          })
        if (url.pathname.endsWith('/relationships'))
          return route.fulfill({ json: [{ source: 'graph-a', target: 'graph-b', type: 'knows' }] })
        if (url.pathname.endsWith('/stats'))
          return route.fulfill({ json: { total_nodes: 20, total_relationships: 30, available: true } })
        if (url.pathname.endsWith('/node-types'))
          return route.fulfill({
            json: {
              by_type: { Person: 20 },
              type_count: 1,
              total_typed_nodes: 20,
              available: true,
              truncated: false,
              partial: false,
              source_graphs: ['synthetic'],
              degraded_graphs: [],
            },
          })
      }
      if (url.pathname === '/api/enhanced/ontology/object-set/search')
        return route.fulfill({
          json: { count: 1, rows: [{ id: 'evidence-a', title: 'Evidence Alpha', type: 'Note' }] },
        })
      if (url.pathname.startsWith('/api/enhanced/ontology/object/'))
        return route.fulfill({
          json: {
            id: 'evidence-a',
            object_type: 'Note',
            properties: { title: 'Evidence Alpha' },
            links: {},
            history: [],
          },
        })
      const json = responses[url.pathname as keyof typeof responses]
      if (json !== undefined) return route.fulfill({ json })
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/'))
        return route.fulfill({ status: 501, json: { detail: 'Not in fixture' } })
      return route.continue()
    })
    await page.routeWebSocket('**/*', (socket) => socket.close())
    await page.addInitScript(() => {
      localStorage.clear()
      sessionStorage.clear()
      localStorage.setItem('pydantic-chat-ui-theme', 'light')
      localStorage.setItem('agent-webui.consent-dismissed', 'agent-webui-consent-v1')
    })
    await page.goto('/workspace/explore?q=retained&entity=evidence-a&tool=history&lens=graph&graphNode=graph-a')
    const lens = page.getByRole('region', { name: 'Graph lens' })
    await expect(lens.getByRole('button', { name: 'Refresh graph' })).toBeEnabled()
    await expect(lens.getByRole('status')).toContainText('bounded sample')
    const neighbor = page.getByRole('list', { name: 'Sampled adjacency' }).getByRole('link', { name: 'Graph Beta' })
    await neighbor.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/graphNode=graph-b/)
    await page.goBack()
    await expect(page).toHaveURL(/graphNode=graph-a/)
    await page.goForward()
    await expect(page).toHaveURL(/graphNode=graph-b/)
    await page
      .getByRole('navigation', { name: 'Advanced knowledge tools' })
      .getByRole('link', { name: 'Stored records', exact: true })
      .click()
    await expect(page.getByRole('region', { name: 'Record details' })).toContainText('Evidence Alpha')
    await expect(page).toHaveURL(/tool=history.*graphNode=graph-b/)
    await page.getByText('Advanced', { exact: true }).click()
    await page
      .getByRole('navigation', { name: 'Advanced knowledge tools' })
      .getByRole('link', { name: 'Sampled graph', exact: true })
      .click()
    await expect(page.getByRole('region', { name: 'Graph inspector' })).toContainText('Graph Beta')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`graph-${viewport.width}x${viewport.height}.png`), fullPage: true })
    denied = true
    await lens.getByRole('button', { name: 'Refresh graph' }).click()
    await expect(lens.getByRole('alert')).toContainText('Previously loaded graph data has been cleared')
    await expect(lens.getByRole('link', { name: 'Graph Beta' })).toHaveCount(0)
    expect(writes).toEqual([])
    expect(errors).toEqual([])
  })
}
