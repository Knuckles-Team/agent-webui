// spec: WEBUI-APPS-R049.1.3
// Native keyboard acceptance with synthetic reads, not installed-provider qualification.
import { expect, test } from '@playwright/test'

test('records Chromium native disabled-button focus behavior', async ({ page }, info) => {
  await page.setContent('<button id="refresh">Refresh</button>')
  const button = page.locator('#refresh')
  await button.evaluate((element) => {
    element.addEventListener('click', () => ((element as HTMLButtonElement).disabled = true))
  })
  await button.focus()
  await expect(button).toBeFocused()
  await page.keyboard.press('Enter')
  const evidence = await button.evaluate((element) => ({
    focusedAfterNativeDisable: document.activeElement === element,
    retainedNode: element.isConnected,
    disabled: (element as HTMLButtonElement).disabled,
  }))
  console.log('native-disabled-focus', JSON.stringify(evidence))
  await info.attach('native-disabled-focus.json', { body: JSON.stringify(evidence), contentType: 'application/json' })
  expect(evidence.disabled).toBe(true)
  expect(evidence.retainedNode).toBe(true)
})

for (const outcome of ['renewed', 'refused'] as const) {
  test(`Work deferred refresh preserves native keyboard focus and blocks duplicates: ${outcome}`, async ({ page }) => {
    let reads = 0
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/auth/session', (route) =>
      route.fulfill({
        json: {
          authenticated: true,
          subject: 'refresh-reader',
          tenant: 'synthetic',
          webui_role: 'user',
          roles: ['kg:read'],
          csrf_token: 'refresh-fixture',
        },
      }),
    )
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/configure') return route.fulfill({ json: { models: [], builtinTools: [] } })
      if (path === '/api/enhanced/models') return route.fulfill({ json: { models: [], default_id: '' } })
      if (path === '/api/chats') return route.fulfill({ json: [] })
      if (path === '/api/enhanced/sessions') return route.fulfill({ json: [{ id: 'refresh-task' }] })
      if (path === '/api/enhanced/sessions/refresh-task') {
        reads++
        if (reads > 1) {
          await pending
          if (outcome === 'refused') return route.fulfill({ status: 403, json: { detail: 'Denied' } })
        }
        return route.fulfill({
          json: {
            id: 'refresh-task',
            status: { state: 'working' },
            contextId: 'retained-context',
            artifacts: [
              { artifactId: 'reply', parts: [{ kind: 'text', text: reads === 1 ? 'Old output' : 'Renewed output' }] },
            ],
          },
        })
      }
      return route.fulfill({ status: 501, json: { detail: 'Unavailable in read-only fixture' } })
    })
    await page.goto('/workspace/work?task=refresh-task')
    await expect(page.getByText('Old output', { exact: true })).toBeVisible()
    const refresh = page.getByRole('button', { name: 'Refresh task', exact: true })
    const cancel = page.getByRole('button', { name: 'Cancel task…', exact: true })
    await refresh.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => reads).toBe(2)
    await expect(refresh).toHaveAttribute('aria-disabled', 'true')
    await expect(refresh).toBeFocused()
    await expect(cancel).toBeDisabled()
    await expect(page.getByText('Old output', { exact: true })).toHaveCount(0)
    await expect(page.getByText('retained-context', { exact: true })).toHaveCount(0)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Space')
    await refresh.evaluate((element) => {
      ;(element as HTMLButtonElement).click()
    })
    await expect(refresh).toBeFocused()
    expect(reads).toBe(2)
    release()
    if (outcome === 'renewed') {
      await expect(page.getByText('Renewed output', { exact: true })).toBeVisible()
      await expect(refresh).toHaveAttribute('aria-disabled', 'false')
      await expect(refresh).toBeFocused()
      await expect(cancel).toBeEnabled()
    } else {
      await expect(page.getByText('Task detail could not be loaded.', { exact: false })).toBeVisible()
      await expect(cancel).toHaveCount(0)
      await expect(page.getByText('Renewed output', { exact: true })).toHaveCount(0)
    }
    expect(reads).toBe(2)
  })
}
