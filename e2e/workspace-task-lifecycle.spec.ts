// spec: WEBUI-APPS-R049.1.3
import { test, expect } from '@playwright/test'

for (const viewport of [
  { width: 320, height: 740 },
  { width: 740, height: 320 },
]) {
  test(`task cancellation requires attended review and authoritative refresh at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    let cancellations = 0
    let taskState = 'working'
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/auth/session', (route) =>
      route.fulfill({
        json: {
          authenticated: true,
          subject: 'task-user',
          tenant: 'task-tenant',
          webui_role: 'user',
          roles: ['kg:read'],
        },
      }),
    )
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path.startsWith('/api/configure')) return route.fulfill({ json: { models: [], builtinTools: [] } })
      if (path === '/api/enhanced/models') return route.fulfill({ json: { models: [], default_id: '' } })
      if (path === '/api/chats') return route.fulfill({ json: [] })
      if (path === '/api/enhanced/sessions')
        return route.fulfill({ json: [{ id: 'task-a', status: { state: taskState } }] })
      if (path === '/api/enhanced/sessions/task-a')
        return route.fulfill({ json: { id: 'task-a', status: { state: taskState } } })
      if (path === '/api/enhanced/sessions/task-a/cancel') {
        expect(route.request().method()).toBe('POST')
        cancellations++
        await pending
        taskState = 'completed'
        return route.fulfill({ json: { status: 'cancelled', task: { id: 'task-a' } } })
      }
      return route.fulfill({ status: 501, json: { detail: 'Unavailable in this task fixture' } })
    })
    await page.addInitScript(() => {
      localStorage.setItem('agent-webui.consent-dismissed', 'agent-webui-consent-v1')
    })
    await page.setViewportSize(viewport)
    await page.goto('/workspace/work?task=task-a')
    await expect(page.getByText('Status: working', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel task…' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Task: task-a')
    const confirmation = dialog.getByRole('button', { name: 'Confirm task cancellation' })
    await confirmation.evaluate((button) => (button as HTMLButtonElement).click())
    await expect(dialog.getByRole('alert')).toContainText('browser interaction')
    expect(cancellations).toBe(0)
    await confirmation.click()
    await expect.poll(() => cancellations).toBe(1)
    await expect(page.getByRole('button', { name: 'Cancel task…' })).toBeDisabled()
    await expect(page.getByRole('region', { name: 'Task lifecycle' })).toBeFocused()
    release()
    await expect(page.getByText(/Cancellation requested for task task-a/)).toBeVisible()
    await expect(page.getByText('Status: working', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Refresh task', exact: true }).click()
    await expect(page.getByText('Status: completed', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel task…' })).toBeDisabled()
    expect(cancellations).toBe(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('trace inspection preserves Work context through parent, history and refresh', async ({ page }) => {
  let refuseDetail = false
  await page.route('**/auth/session', (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        subject: 'trace-user',
        tenant: 'trace-tenant',
        webui_role: 'user',
        roles: ['kg:read'],
      },
    }),
  )
  await page.route('**/api/**', async function serveTraceFixture(route) {
    const path = new URL(route.request().url()).pathname
    if (path.startsWith('/api/configure')) return route.fulfill({ json: { models: [], builtinTools: [] } })
    if (path === '/api/enhanced/models') return route.fulfill({ json: { models: [], default_id: '' } })
    if (path === '/api/chats') return route.fulfill({ json: [] })
    if (path === '/api/enhanced/sessions') return route.fulfill({ json: [{ id: 'task-a' }] })
    if (path === '/api/enhanced/sessions/task-a')
      return route.fulfill({ json: { id: 'task-a', status: { state: 'completed' } } })
    if (path.endsWith('/traces')) {
      const body = route.request().postDataJSON() as { action: string }
      if (body.action === 'waterfall' && refuseDetail)
        return route.fulfill({ status: 403, json: { detail: 'Denied' } })
      const result =
        body.action === 'search'
          ? [{ id: 'trace-a', name: 'Recorded trace' }]
          : {
              trace: { id: 'trace-a' },
              nodes: [
                { id: 'child', parentId: 'parent', name: 'Child' },
                { id: 'parent', name: 'Parent' },
              ],
            }
      return route.fulfill({ json: { status: 'success', result: { surface: 'traces', action: body.action, result } } })
    }
    return route.fulfill({ status: 501, json: { detail: 'Unavailable in this trace fixture' } })
  })
  await page.addInitScript(() => localStorage.setItem('agent-webui.consent-dismissed', 'agent-webui-consent-v1'))
  await page.goto('/workspace/work?task=task-a&run=trace-a&node=child')
  await page.getByRole('button', { name: 'Inspect recorded parent' }).click()
  await expect(page).toHaveURL(/task=task-a&run=trace-a&node=parent$/)
  await page.goBack()
  await expect(page).toHaveURL(/node=child$/)
  await expect(page.getByRole('button', { name: 'Inspect recorded parent' })).toBeVisible()
  await page.getByRole('button', { name: 'Back to trace' }).click()
  await expect(page).toHaveURL(/task=task-a&run=trace-a$/)
  refuseDetail = true
  await page.getByRole('button', { name: 'Refresh selected trace' }).click()
  await expect(page.getByText(/Selected trace could not be loaded/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Child', exact: true })).toHaveCount(0)
  refuseDetail = false
  await page.getByRole('button', { name: 'Retry detail' }).click()
  await expect(page.getByRole('button', { name: 'Child', exact: true })).toBeVisible()
  await expect(page.getByText('Status: completed', { exact: true })).toBeVisible()
})
