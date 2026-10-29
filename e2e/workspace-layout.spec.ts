// spec: OVERSTORY-APPS-R049.1.5
import { test, expect } from '@playwright/test'

test('response task remains pointer-reachable after transcript scroll and low-height resize', async ({
  page,
}, info) => {
  const response = {
    id: 'layout-response',
    role: 'assistant',
    parts: [{ type: 'text', text: 'Recorded response. '.repeat(80) }],
    metadata: {
      arbora_run: { conversation_context: 'webui:/layout', task_id: 'layout-task', context_id: 'opaque-context' },
    },
  }
  await page.route('**/auth/session', (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        subject: 'layout-user',
        tenant: 'layout-tenant',
        webui_role: 'user',
        roles: ['kg:read'],
      },
    }),
  )
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.startsWith('/api/configure')) return route.fulfill({ json: { models: [], builtinTools: [] } })
    if (path === '/api/enhanced/models') return route.fulfill({ json: { models: [], default_id: '' } })
    if (path === '/api/chats') return route.fulfill({ json: [] })
    if (path.startsWith('/api/chats/')) return route.fulfill({ json: { messages: [response] } })
    return route.fulfill({ status: 501, json: { detail: 'Unavailable in this layout fixture' } })
  })
  await page.addInitScript((message) => {
    localStorage.setItem('agent-webui.consent-dismissed', 'agent-webui-consent-v1')
    localStorage.setItem('chat:["owner-v1","layout-tenant","layout-user"]:messages:/layout', JSON.stringify([message]))
  }, response)
  await page.setViewportSize({ width: 740, height: 320 })
  await page.goto('/workspace/work?conversation=%2Flayout')
  const panel = page.locator('#workspace-assistant')
  const transcript = panel.locator('[role="log"]')
  const expand = page
    .locator('#workspace-assistant-entry-slot')
    .getByRole('button', { name: 'Expand chat', exact: true })
  await expect(panel).toBeHidden()
  await expect(transcript).toHaveCount(1)
  await expect(transcript).toBeHidden()
  await transcript.evaluate((element) => element.setAttribute('data-retention-probe', 'original'))
  expect(await panel.evaluate((element) => element.getBoundingClientRect().height)).toBe(0)
  await expect(expand).toHaveAttribute('aria-expanded', 'false')
  await expand.click()
  const link = page.getByRole('link', { name: 'Inspect response task' })
  for (const viewport of [
    { width: 740, height: 320 },
    { width: 320, height: 740 },
    { width: 740, height: 320 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(link).toBeVisible()
    await link.scrollIntoViewIfNeeded()
    const geometry = await link.evaluate((element) => {
      const box = element.getBoundingClientRect()
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        hit: element.contains(document.elementFromPoint(x, y)),
        fullTarget: [box.x + 2, x, box.right - 2].every((pointX) =>
          [box.y + 2, y, box.bottom - 2].every((pointY) =>
            element.contains(document.elementFromPoint(pointX, pointY)),
          ),
        ),
        inViewport: box.x >= 0 && box.y >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
        logHeight: document.querySelector('[role="log"]')?.getBoundingClientRect().height ?? 0,
      }
    })
    await info.attach(`task-link-${viewport.width}x${viewport.height}.json`, {
      body: JSON.stringify(geometry),
      contentType: 'application/json',
    })
    expect(geometry.logHeight).toBeGreaterThan(0)
    expect(geometry.height).toBeGreaterThanOrEqual(44)
    expect(geometry.width).toBeGreaterThanOrEqual(44)
    expect(geometry.inViewport).toBe(true)
    expect(geometry.hit).toBe(true)
    expect(geometry.fullTarget).toBe(true)
    await link.click()
    await expect(page).toHaveURL(/task=layout-task/)
    await page.goBack()
    await expect(page).not.toHaveURL(/task=layout-task/)
  }
  await page.locator('#chat-message-input').press('Escape')
  await expect(expand).toBeFocused()
  await expect(panel).toBeHidden()
  await expect(transcript).toHaveAttribute('data-retention-probe', 'original')
  await expand.click()
  await expect(transcript).toBeVisible()
  await expect(transcript).toHaveAttribute('data-retention-probe', 'original')
  await expect(link).toBeVisible()
})
