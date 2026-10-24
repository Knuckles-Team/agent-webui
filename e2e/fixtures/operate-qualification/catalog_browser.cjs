const path = require('node:path')
const outputDir = process.env.OPERATE_QUALIFICATION_DIR
if (!outputDir) throw new Error('Set OPERATE_QUALIFICATION_DIR to a private temporary directory')
const artifact = (name) => path.join(outputDir, name)
const { chromium, expect } = require('@playwright/test')
const fs = require('node:fs')
;(async () => {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    extraHTTPHeaders: { Authorization: 'Bearer ' + fs.readFileSync(artifact('operate-catalog-served-token'), 'utf8') },
  })
  await context.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
  )
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const response = await context.request.get('http://127.0.0.1:18765/api/enhanced/tools')
  if (response.status() !== 200) throw Error('catalog HTTP ' + response.status())
  const payload = await response.json()
  await page.goto('http://127.0.0.1:18765/')
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    history.pushState({}, '', '/workspace/operate')
    window.dispatchEvent(new Event('history-state-changed'))
  })
  const panel = page.getByRole('region', { name: 'Connector catalog', exact: true })
  await expect(panel.getByRole('article')).toHaveCount(2)
  await expect(
    panel.getByRole('article', { name: 'Catalog connector catalog-registered', exact: true }),
  ).toContainText('Registration: available')
  await expect(
    panel.getByRole('article', { name: 'Catalog connector catalog-unregistered', exact: true }),
  ).toContainText('Registration: unavailable')
  await expect(panel.getByText('Provider connection: not reported by this catalog.')).toHaveCount(2)
  await expect(panel).not.toContainText('synthetic.invalid')
  await panel.getByRole('button', { name: 'Inspect catalog-registered', exact: true }).click()
  await expect(panel.getByText('MCP runtime: not reported')).toBeVisible()
  await panel.getByRole('button', { name: 'tool: shared-name', exact: true }).click()
  await expect(panel.getByRole('region', { name: 'Selected catalog definition' })).toContainText(
    'tool:catalog-registered',
  )
  await panel.getByRole('button', { name: 'skill: shared-name', exact: true }).click()
  await expect(panel.getByRole('region', { name: 'Selected catalog definition' })).toContainText(
    'skill:catalog-registered',
  )
  await panel.getByRole('button', { name: 'Inspect catalog-unregistered', exact: true }).click()
  await expect(panel.getByRole('region', { name: 'Selected catalog definition' })).toHaveCount(0)
  await panel.getByRole('button', { name: 'tool: shared-name', exact: true }).click()
  await expect(panel.getByRole('region', { name: 'Selected catalog definition' })).toContainText(
    'tool:catalog-unregistered',
  )
  await panel.getByRole('textbox').fill('unregistered')
  await expect(panel.getByRole('article')).toHaveCount(1)
  await panel.getByRole('textbox').fill('')
  fs.writeFileSync(artifact('operate-catalog-refuse'), 'synthetic authority refusal')
  await panel.getByRole('button', { name: 'Refresh connector catalog' }).click()
  await expect(panel.getByRole('alert')).toContainText('not available')
  await expect(panel.getByRole('article')).toHaveCount(0)
  fs.unlinkSync(artifact('operate-catalog-refuse'))
  await panel.getByRole('button', { name: 'Refresh connector catalog' }).click()
  await expect(panel.getByRole('article')).toHaveCount(2)
  await page.screenshot({ path: artifact('operate-catalog-served.png'), fullPage: true })
  const storage = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }))
  const evidence = {
    httpStatus: response.status(),
    servers: payload.servers.map(({ server_id, name, status, tool_count }) => ({
      server_id,
      name,
      status,
      tool_count,
    })),
    checks: [
      'real catalog HTTP',
      'built Operate mount',
      'registration labels',
      'no URL rendering',
      'filter',
      '503 withdrawal',
      'recovery',
      'real component projection',
      'selected tool and skill identities',
      'connector switch retirement',
      'unknown runtime',
    ],
    pageErrors: errors,
    storage,
  }
  fs.writeFileSync(artifact('operate-catalog-served-evidence.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence, null, 2))
  await browser.close()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
