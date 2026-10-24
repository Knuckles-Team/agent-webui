// spec: WEBUI-APPS-R049.1.13, WEBUI-API-R011.4
// Real Work route with synthetic producer data, not installed-provider qualification.
import { test, expect } from '@playwright/test'
import fixture from '../src/lib/__tests__/fixtures/execution-graph.json' with { type: 'json' }

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 320, height: 740 },
]) {
  test(`flat dependencies remain inspectable by keyboard at ${viewport.width}px`, async ({ page }) => {
    let refused = false
    const graphRequests: unknown[] = []
    await page.route('**/auth/session', (route) =>
      route.fulfill({
        json: {
          authenticated: true,
          subject: 'graph-reader',
          tenant: 'synthetic',
          webui_role: 'user',
          roles: ['kg:read'],
          csrf_token: 'graph-fixture',
        },
      }),
    )
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/configure') return route.fulfill({ json: { models: [], builtinTools: [] } })
      if (path === '/api/enhanced/models') return route.fulfill({ json: { models: [], default_id: '' } })
      if (path === '/api/chats') return route.fulfill({ json: [] })
      if (path === '/api/enhanced/sessions') return route.fulfill({ json: [{ id: fixture.task_id }] })
      if (decodeURIComponent(path) === `/api/enhanced/sessions/${fixture.task_id}`)
        return route.fulfill({ json: { id: fixture.task_id, metadata: { arbora: { runId: fixture.run_id } } } })
      if (path === '/api/v1/ops/runs.execution_graph') {
        graphRequests.push(route.request().postDataJSON())
        if (refused)
          return route.fulfill({
            status: 403,
            json: {
              ok: false,
              error: { code: 'FORBIDDEN', source: 'arbora', message: 'denied', retryable: false },
              meta: { registry_digest: 'test', api_version: 'v1' },
            },
          })
        return route.fulfill({
          json: { ok: true, result: { value: fixture }, meta: { registry_digest: 'test', api_version: 'v1' } },
        })
      }
      return route.fulfill({ status: 501, json: { detail: 'Unavailable in this read-only fixture' } })
    })
    await page.addInitScript(() => localStorage.setItem('agent-webui.consent-dismissed', 'agent-webui-consent-v1'))
    await page.setViewportSize(viewport)
    await page.goto(`/workspace/work?task=${encodeURIComponent(fixture.task_id)}`)
    const graph = page.getByRole('region', { name: 'Execution dependency graph', exact: true })
    await expect(graph.getByText('Complete declared topology · Incomplete lifecycle evidence')).toBeVisible()
    const refresh = graph.getByRole('button', { name: 'Refresh execution graph' })
    await refresh.focus()
    await page.keyboard.press('Tab')
    await expect(graph.getByRole('region', { name: /Scrollable dependency diagram/ })).toBeFocused()
    await page.keyboard.press('Tab')
    const first = graph.locator('summary').first()
    await expect(first).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(first.locator('..')).toHaveAttribute('open', '')
    const join = graph.locator('summary').filter({ hasText: 'join' })
    await join.focus()
    await page.keyboard.press('Enter')
    await expect(join.locator('..').getByText('left, right', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(graphRequests).toEqual([
      { schema_version: 'arbora-execution-graph-v1', run_id: fixture.run_id, task_id: fixture.task_id },
    ])
    await expect(graph.getByRole('button', { name: /Message active child|Continue completed child/ })).toHaveCount(0)
    // The graph is taller than its nested scroll viewport. Element screenshots
    // would include clipped/blank regions rather than what a person can see.
    for (const [name, target] of [
      ['diagram', graph.getByRole('region', { name: /Scrollable dependency diagram/ })],
      ['details', join.locator('..')],
    ] as const) {
      await target.evaluate((element) =>
        element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }),
      )
      await expect(target).toBeInViewport({ ratio: 1 })
      await page.screenshot({
        path: test.info().outputPath(`flat-execution-${name}-${viewport.width}.png`),
        animations: 'disabled',
        caret: 'hide',
      })
    }
    refused = true
    await refresh.click()
    await expect(graph.getByText('Execution graph access was denied.')).toBeVisible()
    await expect(graph.getByRole('list', { name: 'Execution step dependency list' })).toHaveCount(0)
    expect(graphRequests).toHaveLength(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
