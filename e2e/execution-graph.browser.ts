// spec: OVERSTORY-APPS-R049.1.13, OVERSTORY-API-R011.4
// spec: OVERSTORY-DESIGN-R004.1.1
// Real Work route with synthetic producer data, not installed-provider qualification.
import { test, expect } from '@playwright/test'
import { operation, taskPage } from './fixtures/work-task-operations'
import fixture from '../src/lib/__tests__/fixtures/execution-graph.json' with { type: 'json' }

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 320, height: 740 },
  { width: 844, height: 390 },
  { width: 320, height: 740, textScale: 2 },
]) {
  test(`flat dependencies remain inspectable by keyboard at ${viewport.width}x${viewport.height}px${'textScale' in viewport ? ' with 200% text' : ''}`, async ({
    page,
  }) => {
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
      if (path === '/api/v1/ops/agents.tasks.list') return route.fulfill({ json: taskPage([{ id: fixture.task_id }]) })
      if (path === '/api/v1/ops/agents.tasks.get')
        return route.fulfill({
          json: operation({ id: fixture.task_id, metadata: { arbora: { runId: fixture.run_id } } }),
        })
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
    await page.addInitScript(() => localStorage.setItem('overstory.consent-dismissed', 'overstory-consent-v1'))
    await page.setViewportSize(viewport)
    await page.goto(`/workspace/work?task=${encodeURIComponent(fixture.task_id)}`)
    const graph = page.getByRole('region', { name: 'Execution dependency graph', exact: true })
    await expect(graph.getByText('Complete declared topology · Incomplete lifecycle evidence')).toBeVisible()
    if ('textScale' in viewport)
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%'
      })
    const refresh = graph.getByRole('button', { name: 'Refresh execution graph' })
    await refresh.focus()
    await page.keyboard.press('Tab')
    const scrollport = graph.getByRole('region', { name: /Scrollable dependency diagram/ })
    await expect(scrollport).toBeFocused()
    const overflow = await scrollport.evaluate((el) => ({
      horizontal: el.scrollWidth > el.clientWidth,
      vertical: el.scrollHeight > el.clientHeight,
      left: el.scrollLeft,
      top: el.scrollTop,
    }))
    if (overflow.horizontal) {
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => scrollport.evaluate((el) => el.scrollLeft)).toBeGreaterThan(overflow.left)
    }
    if (overflow.vertical) {
      await page.keyboard.press('ArrowDown')
      await expect.poll(() => scrollport.evaluate((el) => el.scrollTop)).toBeGreaterThan(overflow.top)
    }
    await page.keyboard.press('Tab')
    const first = graph.locator('summary').first()
    await expect(first).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(first.locator('..')).toHaveAttribute('open', '')
    const join = graph.locator('summary').filter({ hasText: 'join' })
    await join.focus()
    await page.keyboard.press('Enter')
    await expect(join.locator('..').getByText('left, right', { exact: true })).toBeVisible()
    await expect(join).toBeInViewport({ ratio: 1 })
    // Read every expanded field with real keyboard scrolling, including text
    // enlargement where the full details card cannot fit in one viewport.
    for (const field of await join.locator('..').locator('dt, dd').all()) {
      for (let attempt = 0; attempt < 80; attempt++) {
        const direction = await field.evaluate((el) => {
          const rect = el.getBoundingClientRect()
          const port = el.closest('.workspace-route-content')!.getBoundingClientRect()
          if (rect.top < Math.max(0, port.top)) return 'ArrowUp'
          if (rect.bottom > Math.min(innerHeight, port.bottom)) return 'ArrowDown'
          return null
        })
        if (!direction) break
        await page.keyboard.press(direction)
        // Native keyboard scrolling animates independently of CSS motion.
        await page.waitForTimeout(120)
      }
      await expect(field).toBeInViewport({ ratio: 1 })
      await expect(join).toBeFocused()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(graphRequests).toEqual([
      { schema_version: 'arbora-execution-graph-v1', run_id: fixture.run_id, task_id: fixture.task_id },
    ])
    await expect(graph.getByRole('button', { name: /Message active child|Continue completed child/ })).toHaveCount(0)
    // The graph is taller than its nested scroll viewport. Element screenshots
    // would include clipped/blank regions rather than what a person can see.
    const diagram = graph.getByRole('region', { name: /Scrollable dependency diagram/ })
    await expect(page.locator('.workspace-route-content')).toHaveCSS('container-type', 'size')
    const task = page.locator('.workspace-route-content')
    const fallback = await task.evaluate((el) => {
      const previous = el.style.cssText
      el.style.blockSize = 'auto'
      el.style.flex = 'none'
      el.style.alignSelf = 'start'
      const height = el.clientHeight
      const minimum = 16 * parseFloat(getComputedStyle(document.documentElement).fontSize)
      el.style.cssText = previous
      return { height, minimum }
    })
    expect(fallback.height).toBeGreaterThanOrEqual(fallback.minimum)
    const taskHeight = await task.evaluate((el) => el.clientHeight)
    expect((await diagram.boundingBox())!.height).toBeLessThanOrEqual(taskHeight)
    for (const [name, target, focus] of [
      ['diagram', diagram, diagram],
      ['details', join.locator('..'), join],
    ] as const) {
      await focus.focus()
      // The workspace restores focused controls after two layout frames.
      // Capture that same target only after its normal focus handling settles.
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      )
      // Preserve native focus geometry separately from Playwright's reveal.
      // Ancestor rectangles make any clipped edge attributable, not guessed.
      for (const phase of ['native-focus', 'playwright-reveal'] as const) {
        if (phase === 'playwright-reveal') await target.scrollIntoViewIfNeeded()
        const geometry = await target.evaluate((el) => {
          const describe = (node: Element) => {
            const style = getComputedStyle(node)
            const rect = node.getBoundingClientRect()
            return {
              tag: node.tagName,
              class: node.className,
              rect: rect.toJSON() as Record<string, number>,
              client: [node.clientWidth, node.clientHeight, node.clientLeft, node.clientTop],
              scroll: [node.scrollWidth, node.scrollHeight, node.scrollLeft, node.scrollTop],
              overflow: [style.overflowX, style.overflowY],
              padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
              scrollPadding: style.scrollPadding,
              position: style.position,
              outline: [style.outlineWidth, style.outlineOffset],
            }
          }
          const ancestors = []
          for (let node = el.parentElement; node; node = node.parentElement) ancestors.push(describe(node))
          const header = document.querySelector('.workspace-context-rail')
          return {
            viewport: [innerWidth, innerHeight, scrollX, scrollY],
            target: describe(el),
            header: header ? describe(header) : null,
            ancestors,
          }
        })
        await test.info().attach(`${name}-${phase}-geometry`, {
          body: JSON.stringify(geometry, null, 2),
          contentType: 'application/json',
        })
        console.log(`${name}-${phase}-geometry ${JSON.stringify(geometry)}`)
        if (name === 'diagram' && phase === 'native-focus') {
          await expect(target).toBeInViewport({ ratio: 1 })
          const clip = geometry.ancestors.filter((el) => el.overflow[1] !== 'visible')
          const edge = geometry.target.outline.reduce((total, value) => total + parseFloat(value), 0)
          expect(geometry.target.rect.top - edge).toBeGreaterThanOrEqual(Math.max(0, ...clip.map((el) => el.rect.top)))
          expect(geometry.target.rect.bottom + edge).toBeLessThanOrEqual(
            Math.min(viewport.height, ...clip.map((el) => el.rect.bottom)),
          )
        }
      }
      await page.screenshot({
        path: test
          .info()
          .outputPath(
            `flat-execution-${name}-${viewport.width}x${viewport.height}${'textScale' in viewport ? '-text200' : ''}.png`,
          ),
        animations: 'disabled',
        caret: 'hide',
      })
      const fits = (await target.boundingBox())!.height <= taskHeight
      if (name === 'diagram' || fits || (viewport.height === 740 && !('textScale' in viewport)))
        await expect(target).toBeInViewport({ ratio: 1 })
      else {
        // Only added low-height/enlarged-text cases may exceed a whole viewport.
        // Their complete field-by-field keyboard reachability is proved above.
        expect(viewport.height === 390 || 'textScale' in viewport).toBe(true)
      }
    }
    refused = true
    await refresh.click()
    await expect(graph.getByText('Execution graph access was denied.')).toBeVisible()
    await expect(graph.getByRole('list', { name: 'Execution step dependency list' })).toHaveCount(0)
    expect(graphRequests).toHaveLength(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
