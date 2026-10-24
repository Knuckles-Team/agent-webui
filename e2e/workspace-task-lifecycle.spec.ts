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

// spec: WEBUI-APPS-R049.1.3
for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
  { width: 740, height: 320 },
]) {
  test(`conversation task output journey at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    let denyTask = false
    let sends = 0
    await page.route('**/auth/session', (route) =>
      route.fulfill({
        json: {
          authenticated: true,
          subject: 'journey-user',
          tenant: 'journey-tenant',
          webui_role: 'user',
          roles: ['kg:read'],
        },
      }),
    )
    await page.route('**/api/**', async function serveWorkJourney(route) {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/chats/messages') {
        const body = route.request().postDataJSON() as { id: string }
        expect(body.id).toMatch(/^\/.+/)
        sends++
        const events = [
          {
            type: 'start',
            messageId: 'journey-response',
            messageMetadata: {
              arbora_run: {
                conversation_context: `webui:${body.id}`,
                task_id: 'task-a',
                context_id: 'opaque-context',
              },
            },
          },
          { type: 'text-start', id: 'reply-text' },
          { type: 'text-delta', id: 'reply-text', delta: 'The recorded task output is ready for inspection.' },
          { type: 'text-end', id: 'reply-text' },
          { type: 'finish' },
        ]
        return route.fulfill({
          body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
          headers: {
            'content-type': 'text/event-stream',
            'x-vercel-ai-ui-message-stream': 'v1',
          },
        })
      }
      if (path === '/api/enhanced/sessions/task-a') {
        if (denyTask) return route.fulfill({ status: 403, json: { detail: 'Denied' } })
        return route.fulfill({
          json: {
            id: 'task-a',
            status: { state: 'completed' },
            contextId: 'opaque-context',
            metadata: { arbora: { runId: 'producer-run', runTraceRef: 'urn:trace:opaque' } },
            artifacts: [
              {
                artifactId: 'artifact-a',
                name: 'Recorded answer',
                parts: [{ kind: 'text', text: 'Task output: investigated the synthetic issue.' }],
              },
            ],
          },
        })
      }
      if (path.endsWith('/traces')) {
        const body = route.request().postDataJSON() as { action: string }
        const result =
          body.action === 'search'
            ? [{ id: 'independent-trace', name: 'Independent trace' }]
            : {
                trace: { id: 'independent-trace' },
                nodes: [{ id: 'node-a', name: 'Recorded node' }],
              }
        return route.fulfill({
          json: { status: 'success', result: { surface: 'traces', action: body.action, result } },
        })
      }
      const fixtures: Record<string, unknown> = {
        '/api/configure': {
          models: [{ id: 'fixture-model', name: 'Fixture model', builtinTools: [] }],
          builtinTools: [],
        },
        '/api/enhanced/models': { models: [], default_id: '' },
        '/api/chats': [],
        '/api/chats/journey': { messages: [] },
        '/api/enhanced/sessions': [{ id: 'task-a', status: { state: 'completed' } }],
      }
      if (path in fixtures) return route.fulfill({ json: fixtures[path] })
      return route.fulfill({ status: 501, json: { detail: 'Unavailable in the journey fixture' } })
    })
    await page.addInitScript(() => localStorage.setItem('agent-webui.consent-dismissed', 'agent-webui-consent-v1'))
    await page.setViewportSize(viewport)
    await page.goto('/workspace/work')
    const composer = page.getByRole('textbox', { name: 'Message input' })
    await composer.fill('Investigate the synthetic issue')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await page.getByRole('link', { name: 'Inspect response task' }).click()
    await expect(page).toHaveURL(/conversation=.*&task=task-a$/)
    await expect(page.getByText('Task output: investigated the synthetic issue.', { exact: true })).toBeVisible()
    await composer.fill('Keep this follow-up draft')
    await expect(page.getByRole('textbox', { name: 'Message input' })).toHaveCount(1)
    await expect(page.getByRole('link', { name: 'urn:trace:opaque' })).toHaveCount(0)
    await page.getByRole('region', { name: 'Task output and references' }).scrollIntoViewIfNeeded()
    await info.attach('task-output.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    await page.getByRole('link', { name: 'Independent trace', exact: true }).click()
    await page.getByRole('button', { name: 'Recorded node', exact: true }).click()
    await expect(composer).toHaveValue('Keep this follow-up draft')
    await expect(page.getByText(/Conversation-to-run association is unavailable/)).toBeVisible()
    await page.goBack()
    await expect(page).not.toHaveURL(/node=/)
    denyTask = true
    await page.getByRole('button', { name: 'Refresh task', exact: true }).click()
    await expect(page.getByText(/Task detail could not be loaded/)).toBeVisible()
    await expect(page.getByRole('region', { name: 'Task output and references' })).toHaveCount(0)
    denyTask = false
    await page.getByRole('button', { name: 'Retry task', exact: true }).click()
    await expect(page.getByText('Task output: investigated the synthetic issue.', { exact: true })).toBeVisible()
    await expect(composer).toHaveValue('Keep this follow-up draft')
    expect(sends).toBe(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const retainedScreenshot = info.outputPath('retained-work-journey.png')
    await page.screenshot({ fullPage: true, path: retainedScreenshot })
    await info.attach('retained-work-journey.png', { path: retainedScreenshot, contentType: 'image/png' })
  })
}
