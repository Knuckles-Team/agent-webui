// spec: WEBUI-DESIGN-R002.1
import { expect, test } from '@playwright/test'

test('workspace panes use available width and keep collection drafts through disclosure and resize', async ({
  page,
}, info) => {
  test.setTimeout(120_000)
  await page.route('**/auth/session', (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        subject: 'density-user',
        tenant: 'density-tenant',
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
    return route.fulfill({ status: 501, json: { detail: 'Unavailable in this synthetic layout fixture' } })
  })
  await page.addInitScript(() => localStorage.setItem('agent-webui.consent-dismissed', 'agent-webui-consent-v1'))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/workspace/explore')
  const surface = page.getByRole('region', { name: 'Explore workspace', exact: true })
  const draft = surface.getByRole('textbox', { name: 'Find evidence' })
  await draft.fill('Unsent collection query')
  const disclosure = surface.locator('summary')
  await disclosure.focus()
  await page.keyboard.press('Enter')
  await expect(draft).not.toBeVisible()
  await expect(disclosure).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(draft).toHaveValue('Unsent collection query')
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 740, height: 320 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
    { width: 2560, height: 720 },
    { width: 587, height: 913 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(draft).toHaveValue('Unsent collection query')
    const geometry = await surface.evaluate((element) => {
      const panels = element.querySelector('.workspace-panels')!
      const children = [...panels.children].map((child) => child.getBoundingClientRect())
      return {
        width: element.getBoundingClientRect().width,
        columns: getComputedStyle(panels).gridTemplateColumns.split(' ').length,
        overflow: element.scrollWidth > element.clientWidth,
        sameRow: Math.abs(children[0].top - children[1].top) < 1,
        fontSize: getComputedStyle(element.querySelector('input')!).fontSize,
      }
    })
    expect(geometry.overflow).toBe(false)
    expect(geometry.width).toBeLessThanOrEqual(1600)
    expect(geometry.columns).toBe(geometry.width >= 832 ? 2 : 1)
    expect(geometry.sameRow).toBe(geometry.width >= 832)
    await info.attach(`density-${viewport.width}x${viewport.height}`, {
      body: JSON.stringify(geometry),
      contentType: 'application/json',
    })
    await info.attach(`workspace-${viewport.width}x${viewport.height}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  }
  // A narrow workspace on a wide screen must not inherit viewport-based columns.
  await page.setViewportSize({ width: 1440, height: 900 })
  await surface.evaluate((element) => {
    element.style.width = '480px'
  })
  await expect(surface.locator('.workspace-panels')).toHaveCSS('grid-template-columns', '480px')
  await expect(draft).toHaveValue('Unsent collection query')
  await disclosure.click()
  await expect(draft).not.toBeVisible()
  await surface.getByRole('button', { name: 'Evidence collection', exact: true }).click()
  await expect(draft).toBeVisible()
  await expect(draft).toBeFocused()
  await expect(draft).toHaveValue('Unsent collection query')
})
