// spec: WEBUI-DESIGN-R011
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { baseURL, captures, fixedTime, fixture, responses, theme } from './fixtures/documentation-screenshots.mjs'

for (const capture of captures) {
  test(`${capture.name}-${capture.viewport.name}`, async ({ page, browser }, info) => {
    const blocked: string[] = []
    const failures: string[] = []
    page.on('pageerror', (error) => failures.push(error.message))
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== baseURL) {
        blocked.push(`${route.request().method()} ${url.origin}${url.pathname}`)
        return route.abort('blockedbyclient')
      }
      const json = responses[url.pathname as keyof typeof responses]
      if (json !== undefined) return route.fulfill({ json })
      if (
        url.pathname.startsWith('/api/') ||
        url.pathname.startsWith('/auth/') ||
        ['fetch', 'xhr', 'eventsource', 'ping'].includes(route.request().resourceType())
      ) {
        blocked.push(`${route.request().method()} ${url.pathname}`)
        return route.fulfill({ status: 501, json: { detail: 'Not in documentation fixture' } })
      }
      return route.continue()
    })
    // No backend websocket, session reuse, browser control or external service.
    await page.routeWebSocket('**/*', (socket) => socket.close())
    await page.clock.setFixedTime(new Date(fixedTime))
    await page.addInitScript((value) => {
      localStorage.clear()
      sessionStorage.clear()
      localStorage.setItem('agent-webui.consent-dismissed', 'agent-webui-consent-v1')
      localStorage.setItem('pydantic-chat-ui-theme', value)
    }, theme)
    await page.setViewportSize(capture.viewport)
    await page.goto(capture.path)
    const workspace = page.getByRole('region', { name: new RegExp(`^${capture.name} workspace$`, 'i') })
    await expect(workspace.getByText(capture.ready, { exact: true })).toBeVisible()
    if (capture.name === 'explore')
      await expect(
        workspace.getByText('A synthetic evidence record for documentation.', { exact: true }),
      ).toBeVisible()
    if (capture.name === 'operate')
      await expect(workspace.getByText('Showing 1 of 1 catalog connectors.', { exact: true })).toBeVisible()
    if (capture.name === 'work')
      await page
        .getByRole('textbox', { name: 'Message input' })
        .fill('Summarize the research brief and cite the source notes.')
    await expect(workspace.getByRole('status').filter({ hasText: /Loading|Searching|Probing|Checking/ })).toHaveCount(
      0,
    )
    await expect(workspace.getByRole('alert')).toHaveCount(0)
    await expect(page.locator('html')).toHaveClass(/\blight\b/)
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all(Array.from(document.images, (image) => image.decode()))
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(blocked, 'Unexpected requests must not reach a real backend or account').toEqual([])
    expect(failures, 'Rendered app errors').toEqual([])
    const directory = info.project.outputDir
    await mkdir(directory, { recursive: true })
    const image = await page.screenshot({ path: join(directory, capture.file), animations: 'disabled', caret: 'hide' })
    const record = {
      file: capture.file,
      path: capture.path,
      viewport: { width: capture.viewport.width, height: capture.viewport.height },
      theme,
      fixture,
      fixedTime,
      sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      sourceDirty:
        execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim().length > 0,
      browser: `Chromium ${browser.version()}`,
      platform: process.platform,
      deviceScaleFactor: 1,
      sha256: createHash('sha256').update(image).digest('hex'),
    }
    await writeFile(join(directory, capture.file.replace('.png', '.json')), `${JSON.stringify(record, null, 2)}\n`)
    await info.attach(capture.file, { path: join(directory, capture.file), contentType: 'image/png' })
  })
}
