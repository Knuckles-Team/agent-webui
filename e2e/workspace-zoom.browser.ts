// spec: OVERSTORY-DESIGN-R004.2.1
import { chromium, expect, test, type Locator, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

async function tabTo(page: Page, target: Locator, key = 'Tab') {
  for (let count = 0; count < 60; count++) {
    if (await target.evaluate((element) => element === document.activeElement)) return
    await page.keyboard.press(key)
  }
  throw new Error('Destination was not reachable by keyboard')
}

async function expectUnobscured(target: Locator) {
  await expect
    .poll(() =>
      target.evaluate((element) => {
        const box = element.getBoundingClientRect()
        const x = box.x + box.width / 2
        const y = box.y + box.height / 2
        return [
          [x, y],
          [box.x + 6, y],
          [box.right - 6, y],
          [x, box.y + 6],
          [x, box.bottom - 6],
        ].every(([px, py]) => element.contains(document.elementFromPoint(px, py)))
      }),
    )
    .toBe(true)
}

for (const width of [1280, 640, 740]) {
  test(`keyboard query journey at actual 200% browser zoom in a ${width}px window`, async ({}, info) => {
    test.setTimeout(120_000)
    const profile = await mkdtemp(join(tmpdir(), 'workspace-zoom-'))
    const extension = fileURLToPath(new URL('fixtures/zoom', import.meta.url))
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      viewport: null,
      args: [
        `--window-size=${width},900`,
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    })
    try {
      const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'))
      const page = context.pages()[0]
      const queries: string[] = []
      await page.route('**/auth/session', (route) =>
        route.fulfill({
          json: {
            authenticated: true,
            subject: 'zoom-user',
            tenant: 'zoom-tenant',
            webui_role: 'maintainer',
            roles: ['kg:read'],
          },
        }),
      )
      await page.route('**/api/**', (route) => {
        const path = new URL(route.request().url()).pathname
        if (path === '/api/sparql') {
          queries.push(route.request().postDataJSON().query)
          return route.fulfill({
            json: {
              status: 'success',
              head: { vars: ['record'] },
              results: { bindings: [{ record: { type: 'literal', value: 'Keyboard result' } }] },
            },
          })
        }
        if (path.startsWith('/api/configure')) return route.fulfill({ json: { models: [], builtinTools: [] } })
        if (path === '/api/enhanced/models') return route.fulfill({ json: { models: [], default_id: '' } })
        if (path === '/api/chats') return route.fulfill({ json: [] })
        return route.fulfill({ status: 501, json: { detail: 'Unavailable in synthetic zoom fixture' } })
      })
      await page.addInitScript(() => localStorage.setItem('agent-webui.consent-dismissed', 'agent-webui-consent-v1'))
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto('http://127.0.0.1:5199/workspace/explore?lens=query')
      const draft = page.getByRole('textbox', { name: 'SPARQL query' })
      await expect(draft).toBeVisible()
      const before = await page.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio }))
      // Native browser zoom via a permission-free extension in a fresh test profile.
      const zoom = await worker.evaluate(`(async () => {
        const [tab] = await chrome.tabs.query({ active: true });
        await chrome.tabs.setZoom(tab.id, 2);
        return chrome.tabs.getZoom(tab.id);
      })()`)
      expect(zoom).toBe(2)
      await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(before.dpr * 2)
      const after = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        scale: visualViewport!.scale,
      }))
      expect(Math.abs(after.width * 2 - before.width)).toBeLessThanOrEqual(1)
      expect(after.scale).toBe(1)
      await tabTo(page, draft)
      await page.keyboard.press('Control+A')
      await page.keyboard.type('SELECT ?record WHERE { ?record ?p ?o }')
      await page.keyboard.press('Control+Enter')
      await expect(page.getByText('Query complete: 1 row(s).', { exact: true })).toBeVisible()
      await page.keyboard.press('End')
      await page.keyboard.type(' LIMIT 7')
      const run = page.getByRole('button', { name: 'Run Query', exact: true })
      await tabTo(page, run)
      await expectUnobscured(run)
      await page.keyboard.press('Enter')
      await expect.poll(() => queries.length).toBe(2)
      expect(queries[1]).toBe('SELECT ?record WHERE { ?record ?p ?o } LIMIT 7')
      const results = page.getByRole('button', { name: 'Results', exact: true })
      await tabTo(page, results, 'Shift+Tab')
      await expectUnobscured(results)
      await page.keyboard.press('Space')
      await expect(page.getByRole('region', { name: 'SPARQL result table' })).toContainText('Keyboard result')
      const editor = page.getByRole('button', { name: 'Editor', exact: true })
      await tabTo(page, editor, 'Shift+Tab')
      await page.keyboard.press('Space')
      await tabTo(page, draft)
      await expect(draft).toHaveValue(queries[1])
      await expectUnobscured(draft)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await info.attach('native-zoom-geometry', {
        body: JSON.stringify({ zoom, before, after }),
        contentType: 'application/json',
      })
      // Capture the browser surface directly: a CSS-sized screenshot clip can
      // truncate the physical viewport when native browser zoom is active.
      const session = await context.newCDPSession(page)
      const screenshot = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      await info.attach('keyboard-query-at-200-percent', {
        body: Buffer.from(screenshot.data, 'base64'),
        contentType: 'image/png',
      })
    } finally {
      await context.close()
      await rm(profile, { recursive: true, force: true })
    }
  })
}
