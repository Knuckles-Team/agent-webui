// Planned browser coverage for OVERSTORY-APPS-R049.1.2; not a completed acceptance receipt.
// Synthetic browser journey only. Served workflow effects remain unavailable and unqualified.
import { test, expect } from '@playwright/test'
import { operation, taskPage } from './fixtures/work-task-operations'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 320, height: 740 },
  { width: 844, height: 390 },
]) {
  test(`contextual workflow preview retains edits at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const writes: string[] = []
    await page.route('**/auth/session', (route) =>
      route.fulfill({
        json: {
          authenticated: true,
          subject: 'workflow-admin',
          tenant: 'synthetic',
          webui_role: 'admin',
          roles: ['kg:admin'],
          csrf_token: 'test_token',
        },
      }),
    )
    await page.route('**/api/**', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (path === '/api/configure') return route.fulfill({ json: { models: [], builtinTools: [] } })
      if (path === '/api/enhanced/models') return route.fulfill({ json: { models: [], default_id: '' } })
      if (path === '/api/chats') return route.fulfill({ json: [] })
      if (path === '/api/v1/ops/agents.tasks.list') return route.fulfill({ json: taskPage([{ id: 'task-a' }]) })
      if (path === '/api/v1/ops/agents.tasks.get')
        return route.fulfill({ json: operation({ id: 'task-a', status: { state: 'working' } }) })
      if (path === '/api/enhanced/workflows' && request.method() === 'GET')
        return route.fulfill({ json: [{ id: 'workflow:demo', name: 'Demo', steps: ['Check'], orchestrates: [] }] })
      if (path === '/api/enhanced/workflows/capabilities')
        return route.fulfill({ status: 501, json: { detail: 'Unavailable' } })
      if (path.startsWith('/api/enhanced/workflows') && request.method() !== 'GET') writes.push(path)
      return route.fulfill({ status: 501, json: { detail: 'Unavailable in synthetic fixture' } })
    })
    await page.addInitScript(() => localStorage.setItem('overstory.consent-dismissed', 'overstory-consent-v1'))
    await page.setViewportSize(viewport)
    await page.goto('/workspace/work?task=task-a&lens=workflows&workflow=workflow%3Ademo')
    const editor = page.getByRole('region', { name: 'Workflow plan editor' })
    await expect(editor.getByRole('textbox', { name: 'workflow name', exact: true })).toHaveValue('Demo')
    await editor.getByRole('textbox', { name: 'workflow name', exact: true }).fill('Unsaved browser plan')
    const add = editor.getByRole('button', { name: 'Add Step', exact: true })
    await add.focus()
    await page.keyboard.press('Enter')
    const label = editor.getByRole('textbox', { name: 'Node label', exact: true })
    await label.focus()
    await expect(label).toBeInViewport()
    await label.fill('Keyboard step')
    await expect(editor.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    await expect(editor.getByRole('button', { name: 'Run', exact: true })).toBeDisabled()
    await page.getByRole('link', { name: 'Inspect tasks and traces' }).click()
    await expect(page.getByRole('heading', { name: 'Task task-a', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Workflow plans', exact: true }).click()
    await expect(editor.getByRole('textbox', { name: 'workflow name', exact: true })).toHaveValue(
      'Unsaved browser plan',
    )
    await expect(editor.getByRole('textbox', { name: 'Node label', exact: true })).toHaveValue('Keyboard step')
    await expect(page).toHaveURL(/task=task-a/)
    expect(new URL(page.url()).searchParams.get('workflow')).toBe('workflow:demo')
    expect(writes).toEqual([])
    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect(horizontalOverflow).toBe(false)
    await editor.scrollIntoViewIfNeeded()
    await page.screenshot({
      path: test.info().outputPath(`workflows-${viewport.width}x${viewport.height}.png`),
      fullPage: true,
    })
  })
}
