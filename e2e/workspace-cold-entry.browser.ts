import { expect, test } from '@playwright/test'

for (const context of ['work', 'explore', 'operate'] as const) {
  test(`cold ${context} entry loads the production assets and survives reload`, async ({ page }) => {
    // Only identity/data are synthetic. HTML, JS, CSS, fonts and lazy imports
    // must cross real HTTP to the installed Arbora/WebUI static mount.
    await page.route('**/auth/session', (route) =>
      route.fulfill({
        json: {
          authenticated: true,
          subject: 'cold-entry-user',
          tenant: 'synthetic',
          webui_role: 'maintainer',
          roles: ['kg:read'],
        },
      }),
    )
    await page.route('**/api/**', (route) =>
      route.fulfill({ status: 501, json: { detail: 'Unavailable in the synthetic cold-entry fixture' } }),
    )
    await page.addInitScript(() => localStorage.setItem('agent-webui.consent-dismissed', 'agent-webui-consent-v1'))
    const failedAssets: string[] = []
    const loadedAssets: string[] = []
    page.on('response', (response) => {
      if (!new URL(response.url()).pathname.includes('/assets/')) return
      if (response.ok()) loadedAssets.push(response.url())
      else failedAssets.push(`${response.status()} ${response.url()}`)
    })
    page.on('requestfailed', (request) => {
      if (new URL(request.url()).pathname.includes('/assets/')) failedAssets.push(request.url())
    })
    const query = { work: 'conversation=synthetic', explore: 'entity=synthetic', operate: 'server=synthetic' }[context]
    const target = `/workspace/${context}?${query}`
    const response = await page.goto(target)
    expect(response?.status()).toBe(200)
    const title = context[0].toUpperCase() + context.slice(1)
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await expect(page.getByText(/destination.*invalid|invalid.*destination/i)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Find destination', exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    expect(new URL(page.url()).search).toBe(`?${query}`)
    expect(loadedAssets.some((url) => url.endsWith('.js'))).toBe(true)
    expect(loadedAssets.some((url) => url.endsWith('.css'))).toBe(true)
    expect(failedAssets).toEqual([])
  })
}
