const path = require('node:path')
const outputDir = process.env.OPERATE_QUALIFICATION_DIR
if (!outputDir) throw new Error('Set OPERATE_QUALIFICATION_DIR to a private temporary directory')
const artifact = (name) => path.join(outputDir, name)
const { chromium, expect } = require('@playwright/test')
const fs = require('node:fs')
;(async () => {
  const browser = await chromium.launch({ headless: true })
  const token = fs.readFileSync(artifact('operate-migration-served-token'), 'utf8')
  const results = []
  for (const viewport of [
    { width: 1366, height: 900 },
    { width: 375, height: 812 },
  ]) {
    fs.rmSync(artifact('operate-migration-recovered'), { force: true })
    const context = await browser.newContext({
      viewport,
      hasTouch: viewport.width === 375,
      extraHTTPHeaders: { Authorization: 'Bearer ' + token },
    })
    await context.route('**/*', (route) =>
      new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
    )
    const response = await context.request.get('http://127.0.0.1:18767/api/dashboard/readiness')
    expect(response.status()).toBe(503)
    const initial = await response.json()
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('http://127.0.0.1:18767/')
    await page.waitForTimeout(1000)
    const dismiss = page.getByRole('button', { name: 'Dismiss', exact: true })
    if (await dismiss.isVisible()) await dismiss.click()
    await page.goto('http://127.0.0.1:18767/arbora-readiness')
    await expect(page).toHaveURL('http://127.0.0.1:18767/workspace/operate')
    await expect(page.getByRole('heading', { name: 'Readiness diagnosis', exact: true })).toBeFocused()
    const panel = page.getByRole('region', { name: 'Readiness diagnosis', exact: true })
    await expect(panel.getByText('Backend readiness: degraded', { exact: true })).toBeVisible()
    const select = panel.getByRole('button', { name: 'synthetic_dependency: degraded', exact: true })
    await select.focus()
    await page.keyboard.press('Enter')
    const detail = panel.getByRole('region', { name: 'Readiness check synthetic_dependency', exact: true })
    await expect(detail).toContainText('synthetic durable receipt')
    await expect(detail).toContainText('"pending": 3')
    fs.writeFileSync(artifact('operate-migration-recovered'), 'synthetic recovered probe')
    const reprobe = panel.getByRole('button', { name: 'Reprobe readiness', exact: true })
    if (viewport.width === 375) await reprobe.tap()
    else await reprobe.click()
    await expect(panel.getByText('Backend readiness: ready', { exact: true })).toBeVisible()
    await expect(detail).toHaveCount(0)
    await context.setExtraHTTPHeaders({ Authorization: 'Bearer invalid-synthetic-token' })
    await reprobe.click()
    await expect(panel.getByRole('alert')).toContainText('access was denied')
    await expect(panel.getByText('Backend readiness: ready', { exact: true })).toHaveCount(0)
    await context.setExtraHTTPHeaders({ Authorization: 'Bearer ' + token })
    await reprobe.click()
    await expect(panel.getByText('Backend readiness: ready', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: 'engine: ready', exact: true }).click()
    await expect(panel.getByRole('region', { name: 'Readiness check engine', exact: true })).toContainText(
      'synthetic engine authority',
    )
    const catalog = page.getByRole('region', { name: 'Connector catalog', exact: true })
    await expect(catalog.getByRole('article')).toHaveCount(2)
    await catalog.getByRole('button', { name: 'Inspect catalog-registered', exact: true }).click()
    await catalog.getByRole('button', { name: 'tool: shared-name', exact: true }).click()
    await expect(catalog.getByRole('region', { name: 'Selected catalog definition' })).toContainText(
      'tool:catalog-registered',
    )
    await catalog.getByRole('button', { name: 'skill: shared-name', exact: true }).click()
    await expect(catalog.getByRole('region', { name: 'Selected catalog definition' })).toContainText(
      'skill:catalog-registered',
    )
    await catalog.getByRole('textbox').fill('unregistered')
    await expect(catalog.getByRole('article')).toHaveCount(1)
    await catalog.getByRole('textbox').fill('')
    await catalog.getByRole('button', { name: 'Refresh connector catalog' }).click()
    await expect(catalog.getByRole('article')).toHaveCount(2)
    await page.evaluate(() => {
      history.pushState({}, '', '/')
      window.dispatchEvent(new Event('history-state-changed'))
    })
    await page.goBack()
    await expect(page).toHaveURL('http://127.0.0.1:18767/workspace/operate')
    await expect(page.getByRole('heading', { name: 'Readiness diagnosis', exact: true })).toBeFocused()
    await page.goForward()
    await expect(page).toHaveURL('http://127.0.0.1:18767/')
    await page.goBack()
    await expect(page).toHaveURL('http://127.0.0.1:18767/workspace/operate')
    const final = await context.request.get('http://127.0.0.1:18767/api/dashboard/readiness')
    expect(final.status()).toBe(200)
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    expect(fits).toBe(true)
    expect(errors).toEqual([])
    await page.screenshot({ path: `${outputDir}/operate-migration-${viewport.width}.png`, fullPage: true })
    results.push({
      viewport,
      initialHttp: response.status(),
      initialChecks: Object.keys(initial.checks),
      finalHttp: final.status(),
      checks: [
        'cold compatibility entry',
        'replacement Back/Forward',
        'heading focus',
        'catalog filter and tool/skill selection and refresh',
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
  fs.writeFileSync(artifact('operate-migration-served-evidence.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
