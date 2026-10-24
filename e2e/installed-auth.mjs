import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const directory = path.resolve(process.argv[2])
const mode = process.argv[3] ?? 'lifecycle'
const { origin, issuer } = JSON.parse(fs.readFileSync(path.join(directory, 'ready.json'), 'utf8'))
for (const endpoint of [origin, issuer]) {
  assert.equal(new URL(endpoint).hostname, '127.0.0.1')
  assert.equal(new URL(endpoint).protocol, 'http:')
}
const control = path.join(directory, 'control.json')
const setControl = async (page, offset = 0, reject_refresh = false) => {
  fs.writeFileSync(control, JSON.stringify({ offset, reject_refresh }))
  await page.waitForTimeout(150)
}
const browser = await chromium.launch({ headless: true })
const signed = (page) => page.getByRole('button', { name: /disposable-user/ })
async function login(context) {
  const page = await context.newPage()
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  if (page.url().startsWith(issuer)) await page.getByRole('link', { name: 'Continue as disposable user' }).click()
  await signed(page).waitFor()
  return page
}
async function lifecycle() {
  const context = await browser.newContext()
  const page = await login(context)
  const cookiesBefore = JSON.stringify(await context.cookies())
  await setControl(page, 400, false)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForFunction(async () => (await (await fetch('/auth/session')).json()).authenticated)
  await page.waitForTimeout(500)
  assert(JSON.stringify(await context.cookies()) !== cookiesBefore, 'renewal should replace the session cookie')
  assert(await signed(page).isVisible())
  console.log('PASS mounted successful renewal with replaced session cookie')
  await context.setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await signed(page).waitFor({ state: 'hidden' })
  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await signed(page).waitFor()
  console.log('PASS mounted offline authority retirement and reconnect recovery')
  await setControl(page, 800, true)
  assert.equal(await page.evaluate(async () => (await fetch('/api/lifecycle')).status), 401)
  await signed(page).waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(async () => (await (await fetch('/auth/session')).json()).authenticated), false)
  await page.screenshot({ path: path.join(directory, 'renewal-refused.png') })
  console.log('PASS API renewal refusal updates mounted identity without reload')
  await context.close()
  fs.writeFileSync(control, JSON.stringify({ offset: 0, reject_refresh: false }))
  const tabs = await browser.newContext()
  const first = await login(tabs)
  const second = await login(tabs)
  let release
  const gate = new Promise((resolve) => (release = resolve))
  let intercepted
  const entered = new Promise((resolve) => (intercepted = resolve))
  await first.route('**/auth/logout', async (route) => {
    intercepted()
    await gate
    await route.continue()
  })
  await signed(first).click()
  await first.getByRole('menuitem', { name: 'Log out', exact: true }).click({ noWaitAfter: true })
  await entered
  await second.evaluate(() => window.dispatchEvent(new Event('focus')))
  await second.waitForTimeout(500)
  assert(await signed(second).isVisible())
  console.log('PASS delayed logout does not claim completion before server response')
  release()
  await first.waitForURL((url) => url.href.startsWith(issuer + '/authorize'))
  await signed(second).waitFor({ state: 'hidden', timeout: 75000 })
  assert.equal(await second.evaluate(async () => (await (await fetch('/auth/session')).json()).authenticated), false)
  await second.screenshot({ path: path.join(directory, 'cross-tab-logout.png') })
  console.log('PASS actual second mounted tab reconciles completed redirect logout within bounded poll')
  await tabs.close()
}
async function diagnostic() {
  const context = await browser.newContext()
  const page = await login(context)
  if (mode === 'baseline') await setControl(page, 400, true)
  const observed = await page.evaluate(async () => ({
    status: (await fetch('/api/lifecycle')).status,
    authenticated: (await (await fetch('/auth/session')).json()).authenticated,
  }))
  observed.mountedUserStillVisible = await signed(page).isVisible()
  console.log(JSON.stringify(observed))
  fs.writeFileSync(path.join(directory, mode + '.json'), JSON.stringify(observed))
  await page.screenshot({ path: path.join(directory, mode + '.png') })
  await context.close()
}
try {
  if (mode === 'lifecycle') await lifecycle()
  else {
    assert(['baseline', 'smoke'].includes(mode))
    await diagnostic()
  }
} finally {
  fs.writeFileSync(control, JSON.stringify({ offset: 0, reject_refresh: false }))
  await browser.close()
}
