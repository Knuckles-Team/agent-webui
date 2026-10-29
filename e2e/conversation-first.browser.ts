// spec: OVERSTORY-APPS-R005.4, OVERSTORY-APPS-R049.1.3, OVERSTORY-APPS-R049.2.1
// Synthetic rendered browser evidence only. No live provider or task execution claim.
import { expect, test } from '@playwright/test'
import { baseURL, responses } from './fixtures/documentation-screenshots.mjs'

test('default conversation stays reachable at desktop, narrow and short viewports', async ({ page }, info) => {
  const submissions: string[] = []
  await page.route('**/*', (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== baseURL) return route.abort('blockedbyclient')
    if (url.pathname === '/api/chats/messages' && request.method() !== 'GET') submissions.push(url.pathname)
    const response = responses[url.pathname as keyof typeof responses]
    if (response !== undefined) return route.fulfill({ json: response })
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/'))
      return route.fulfill({ status: 501, json: { detail: 'Unavailable in this synthetic fixture' } })
    return route.continue()
  })
  await page.routeWebSocket('**/*', (socket) => socket.close())
  await page.goto('/')
  const input = page.getByRole('textbox', { name: 'Message input' })
  await expect(input).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Chat & tasks' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Expand chat', exact: true })).toHaveCount(0)
  await expect(page.getByRole('complementary', { name: 'Privacy consent' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Privacy settings' })).toBeHidden()
  await page.getByRole('button', { name: 'Plan from notes' }).click()
  await expect(input).toHaveValue('Turn these notes into a three-step plan:\n\n')
  expect(submissions).toEqual([])
  await input.fill('Retain this unsent request')
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 320, height: 740 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    await input.scrollIntoViewIfNeeded()
    await expect(input).toBeInViewport()
    await input.click()
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('Retain this unsent request')
    expect(
      await page.locator('.workspace-chat-boundary').evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true)
    const assistant = page.getByRole('region', { name: 'Workspace assistant' })
    const options = assistant.getByRole('button', { name: 'Message options', exact: true })
    if (await options.isVisible()) await options.click()
    // No saved messages exist yet; export is covered by the seeded native-chat journey.
    for (const name of ['Attach image files']) {
      const control = assistant.getByRole('button', { name, exact: true })
      await control.scrollIntoViewIfNeeded()
      await expect(control).toBeInViewport()
    }
    if (await options.isVisible()) await options.click()
    await input.scrollIntoViewIfNeeded()
    await info.attach(`conversation-first-${viewport.width}x${viewport.height}.png`, {
      body: await page.screenshot({
        path: info.outputPath(`conversation-first-${viewport.width}x${viewport.height}.png`),
        animations: 'disabled',
      }),
      contentType: 'image/png',
    })
  }
  const nav = page.getByRole('navigation', { name: 'Primary workspace contexts' })
  await nav.getByRole('link', { name: 'Tools', exact: true }).click()
  await expect(input).toBeHidden()
  await nav.getByRole('link', { name: 'Chat', exact: true }).click()
  await expect(input).toBeVisible()
  await expect(input).toHaveValue('Retain this unsent request')
  await page.getByText('Settings', { exact: true }).click()
  await expect(page.getByRole('region', { name: 'Privacy settings' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('agent-webui.consent'))).toBeNull()
  expect(submissions).toEqual([])
})
