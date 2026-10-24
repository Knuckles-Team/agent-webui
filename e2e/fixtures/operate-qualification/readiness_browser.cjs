const path = require('node:path')
const outputDir = process.env.OPERATE_QUALIFICATION_DIR
if (!outputDir) throw new Error('Set OPERATE_QUALIFICATION_DIR to a private temporary directory')
const artifact = (name) => path.join(outputDir, name)
const { chromium, expect } = require('@playwright/test')
const fs = require('node:fs')
;(async () => {
  const browser = await chromium.launch({ headless: true })
  const token = fs.readFileSync(artifact('operate-readiness-served-token'), 'utf8')
  const results = []
  for (const viewport of [
    { width: 1366, height: 900 },
    { width: 375, height: 812 },
  ]) {
    fs.rmSync(artifact('operate-readiness-recovered'), { force: true })
    const context = await browser.newContext({
      viewport,
      hasTouch: viewport.width === 375,
      extraHTTPHeaders: { Authorization: 'Bearer ' + token },
    })
    await context.route('**/*', (route) =>
      new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
    )
    const response = await context.request.get('http://127.0.0.1:18766/api/dashboard/readiness')
    expect(response.status()).toBe(503)
    const initial = await response.json()
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('http://127.0.0.1:18766/')
    await page.waitForTimeout(1000)
    const dismiss = page.getByRole('button', { name: 'Dismiss', exact: true })
    if (await dismiss.isVisible()) await dismiss.click()
    await page.evaluate(() => {
      history.pushState({}, '', '/workspace/operate')
      window.dispatchEvent(new Event('history-state-changed'))
    })
    const panel = page.getByRole('region', { name: 'Readiness diagnosis', exact: true })
    await expect(panel.getByText('Backend readiness: degraded', { exact: true })).toBeVisible()
    const select = panel.getByRole('button', { name: 'synthetic_dependency: degraded', exact: true })
    await select.focus()
    await page.keyboard.press('Enter')
    const detail = panel.getByRole('region', { name: 'Readiness check synthetic_dependency', exact: true })
    await expect(detail).toContainText('synthetic durable receipt')
    await expect(detail).toContainText('"pending": 3')
    fs.writeFileSync(artifact('operate-readiness-recovered'), 'synthetic recovered probe')
    const reprobe = panel.getByRole('button', { name: 'Reprobe readiness', exact: true })
    if (viewport.width === 375) await reprobe.tap()
    else await reprobe.click()
    await expect(panel.getByText('Backend readiness: ready', { exact: true })).toBeVisible()
    await expect(detail).toHaveCount(0)
    await context.setExtraHTTPHeaders({ Authorization: 'Bearer invalid-synthetic-token' })
    await reprobe.click()
    await expect(panel.getByRole('alert')).toContainText('could not be retrieved')
    await expect(panel.getByText('Backend readiness: ready', { exact: true })).toHaveCount(0)
    await context.setExtraHTTPHeaders({ Authorization: 'Bearer ' + token })
    await reprobe.click()
    await expect(panel.getByText('Backend readiness: ready', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: 'engine: ready', exact: true }).click()
    await expect(panel.getByRole('region', { name: 'Readiness check engine', exact: true })).toContainText(
      'synthetic engine authority',
    )
    const final = await context.request.get('http://127.0.0.1:18766/api/dashboard/readiness')
    expect(final.status()).toBe(200)
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    expect(fits).toBe(true)
    expect(errors).toEqual([])
    await page.screenshot({ path: `${outputDir}/operate-readiness-${viewport.width}.png`, fullPage: true })
    results.push({
      viewport,
      initialHttp: response.status(),
      initialChecks: Object.keys(initial.checks),
      finalHttp: final.status(),
      checks: [
        'keyboard check selection',
        'full returned evidence',
        'explicit reprobe',
        'retired selection',
        'real 401 withdrawal',
        'recovery',
        'no horizontal overflow',
      ],
      pageErrors: errors,
    })
    await context.close()
  }
  await browser.close()
  fs.writeFileSync(artifact('operate-readiness-served-evidence.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
