// spec: WEBUI-APPS-R005.4, WEBUI-APPS-R049.1.3
// spec: WEBUI-DESIGN-R004.2.1
// Rendered synthetic app evidence only, not native WebMCP or live provider acceptance.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { baseURL, responses } from './fixtures/documentation-screenshots.mjs'

test.use({ hasTouch: true })

const transcript = [
  { id: 'native-reply', role: 'assistant', parts: [{ type: 'text', text: 'Retained assistant evidence.' }] },
]

async function prepare(
  page: Page,
  messages: unknown[] = transcript,
  path = '/workspace/work?conversation=%2Fnative-dock',
) {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== baseURL) return route.abort('blockedbyclient')
    if (url.pathname.startsWith('/api/chats/')) return route.fulfill({ json: { messages } })
    const json = responses[url.pathname as keyof typeof responses]
    if (json !== undefined) return route.fulfill({ json })
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/'))
      return route.fulfill({ status: 501, json: { detail: 'Unavailable in this synthetic layout fixture' } })
    return route.continue()
  })
  await page.addInitScript((messages) => {
    localStorage.setItem('agent-webui.consent-dismissed', 'agent-webui-consent-v1')
    localStorage.setItem('pydantic-chat-ui-theme', 'light')
    localStorage.setItem(
      'chat:["owner-v1","synthetic","documentation-demo"]:messages:/native-dock',
      JSON.stringify(messages),
    )
  }, messages)
  await page.goto(path)
  await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible()
}

async function hitTarget(control: Locator, reveal = true) {
  if (reveal) await control.scrollIntoViewIfNeeded()
  await expect(control).toBeInViewport()
  await expect
    .poll(() =>
      control.evaluate((element) => {
        const box = element.getBoundingClientRect()
        // Stay inside the painted rounded corners, as the identity journey does.
        const xInset = Math.min(8, box.width / 4)
        const yInset = Math.min(8, box.height / 4)
        return [box.left + xInset, box.right - xInset].every((x) =>
          [box.top + yInset, box.bottom - yInset].every((y) => element.contains(document.elementFromPoint(x, y))),
        )
      }),
    )
    .toBe(true)
}

async function reachComposerByWheel(page: Page, input: Locator) {
  const visible = () =>
    input.evaluate((element) => {
      const box = element.getBoundingClientRect()
      return (
        box.top >= 0 &&
        box.bottom <= innerHeight &&
        element.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2))
      )
    })
  // Ordinary scrolling must work too: programmatic reveal can scroll overflow:hidden.
  for (let attempt = 0; attempt < 12 && !(await visible()); attempt += 1) {
    const size = page.viewportSize()!
    const direction = await input.evaluate((element) => (element.getBoundingClientRect().top < 0 ? -1 : 1))
    await page.mouse.move(size.width * 0.7, size.height - 24)
    await page.mouse.wheel(0, (direction * size.height) / 2)
    await page.waitForTimeout(50)
  }
  expect(await visible()).toBe(true)
}

test('one native assistant retains draft, controls and context through navigation and constrained resizing', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await prepare(page)
  const panel = page.getByRole('region', { name: 'Workspace assistant' })
  const input = page.getByRole('textbox', { name: 'Message input' })
  await input.fill('Unsent question carried through the workspace')
  await input.evaluate((element) => element.setAttribute('data-retained-composer', 'true'))
  const navigation = page.getByRole('navigation', { name: 'Primary workspace contexts' })
  for (const context of ['explore', 'operate', 'work', 'explore']) {
    await navigation.getByRole('link', { name: context, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/workspace/${context}`))
    await expect(input).toHaveValue('Unsent question carried through the workspace')
    await expect(input).toHaveAttribute('data-retained-composer', 'true')
    await expect(panel.locator('header')).toContainText(new RegExp(context, 'i'))
    await expect(page.locator('#chat-panel-toggle, #agent-chat-drawer')).toHaveCount(0)
    await expect(input).toHaveCount(1)
  }
  await page.goBack()
  await expect(page).toHaveURL(/\/workspace\/work/)
  await page.goForward()
  await expect(page).toHaveURL(/\/workspace\/explore/)
  await expect(input).toHaveValue('Unsent question carried through the workspace')

  for (const size of [
    { width: 1440, height: 900 },
    { width: 320, height: 740 },
    { width: 740, height: 320 },
    { width: 1024, height: 600 },
    { width: 2560, height: 1080 },
  ]) {
    await page.setViewportSize(size)
    await expect(panel).toBeVisible()
    await expect(input).toHaveAttribute('data-retained-composer', 'true')
    expect(await panel.evaluate((element) => getComputedStyle(element).position)).toBe('static')
    expect(
      await page.locator('.workspace-chat-boundary').evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true)
    const taskBox = await page.locator('.workspace-context-content').boundingBox()
    const chatBox = await panel.boundingBox()
    if (size.width >= 1440) {
      expect(taskBox!.width).toBeGreaterThan(chatBox!.width)
      expect(chatBox!.x).toBeGreaterThanOrEqual(taskBox!.x + taskBox!.width - 1)
    } else if (size.width === 320) {
      expect(chatBox!.height).toBeLessThanOrEqual(224)
      await expect(panel.locator('.chat-compact-status')).toBeVisible()
      await expect(panel.getByRole('log')).toHaveCount(0)
      expect(chatBox!.y).toBeGreaterThanOrEqual(taskBox!.y + taskBox!.height - 1)
    }
    const expand = page.getByRole('button', { name: 'Expand chat', exact: true })
    await hitTarget(expand)
    await expand.tap()
    await expect(page.getByRole('button', { name: 'Restore chat size', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await reachComposerByWheel(page, input)
    await page.getByRole('button', { name: 'Focus message input' }).click()
    await expect(input).toBeFocused()
    await hitTarget(input)
    await page.keyboard.press('Escape')
    await expect(input).toBeFocused()
    await expect(expand).toHaveAttribute('aria-pressed', 'false')
    await expect(input).toHaveValue('Unsent question carried through the workspace')
    const options = panel.getByRole('button', { name: 'Message options' })
    if (await options.isVisible()) await options.click()
    for (const name of ['Attach image files', 'Export conversation']) {
      const control = panel.getByRole('button', { name, exact: true })
      await hitTarget(control)
    }
    if (await options.isVisible()) await options.click()
    await hitTarget(input)
    await info.attach(`native-chat-${size.width}x${size.height}.png`, {
      body: await page.screenshot({
        path: info.outputPath(`native-chat-${size.width}x${size.height}.png`),
        animations: 'disabled',
      }),
      contentType: 'image/png',
    })
  }
})

test('retained legacy private routes keep the native dock reachable at short and narrow sizes', async ({ page }) => {
  await prepare(page)
  for (const path of ['/overview', '/files']) {
    await page.goto(path)
    for (const size of [
      { width: 740, height: 320 },
      { width: 320, height: 740 },
    ]) {
      await page.setViewportSize(size)
      const input = page.getByRole('textbox', { name: 'Message input' })
      await expect(input).toBeVisible()
      await hitTarget(input)
      await input.fill('Legacy private route draft')
      const options = page.getByRole('button', { name: 'Message options' })
      if ((await options.isVisible()) && (await options.getAttribute('aria-expanded')) === 'false')
        await options.click()
      await hitTarget(page.getByRole('button', { name: 'Attach image files' }))
      await page.getByRole('button', { name: 'Focus message input' }).click()
      await expect(input).toBeFocused()
      await expect(input).toHaveValue('Legacy private route draft')
      await expect(page.locator('#chat-panel-toggle')).toHaveCount(0)
    }
  }
})

test('retained long transcript keeps its real scrolling child and scroll-to-latest action', async ({ page }) => {
  const messages = Array.from({ length: 30 }, (_, index) => ({
    id: `large-${index}`,
    role: 'assistant',
    parts: [
      {
        type: 'text',
        text: `Evidence message ${index}. [Read evidence](/workspace/explore). ${'Retained source context. '.repeat(30)}`,
      },
    ],
  }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await prepare(page, messages)
  const panel = page.getByRole('region', { name: 'Workspace assistant' })
  const transcriptElement = panel.locator('.chat-transcript')
  await transcriptElement.evaluate((element) => element.setAttribute('data-retained-transcript', 'true'))
  const input = page.getByRole('textbox', { name: 'Message input' })
  await input.fill('Retained alongside a long transcript')
  for (const size of [
    { width: 1440, height: 900 },
    { width: 320, height: 740 },
  ]) {
    await page.setViewportSize(size)
    if (size.width === 320) {
      await expect(panel.getByRole('log')).toHaveCount(0)
      await expect(input).toBeFocused()
      await page.getByRole('button', { name: 'Expand chat', exact: true }).click()
    }
    await expect(transcriptElement).toHaveAttribute('data-retained-transcript', 'true')
    await expect(input).toHaveValue('Retained alongside a long transcript')
    const scroller = transcriptElement.locator(':scope > div').first()
    await scroller.scrollIntoViewIfNeeded()
    expect(await scroller.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    const latest = panel.getByRole('button', { name: 'Scroll to latest message' })
    if (await latest.isVisible()) await latest.click()
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
      .toBeLessThan(3)
    await scroller.hover()
    await page.mouse.wheel(0, -(await scroller.evaluate((element) => element.scrollHeight)))
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeLessThan(50)
    await latest.click()
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
      .toBeLessThan(3)
    await transcriptElement.getByRole('button', { name: 'Read evidence', exact: true }).first().focus()
    if (size.width === 320) {
      await page.keyboard.press('Escape')
      await expect(input).toBeFocused()
      await expect(panel.getByRole('log')).toHaveCount(0)
    }
  }
})

test('compact view keeps execution mode and live SWE stop visible without Options', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await prepare(page)
  let actions = 0
  let stops = 0
  await page.route('**/api/runtime/sessions**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/events'))
      return route.fulfill({ contentType: 'text/event-stream', body: ': synthetic fixture\n\n' })
    if (path.endsWith('/act')) {
      actions += 1
      return route.fulfill({ json: { ok: true } })
    }
    if (route.request().method() === 'DELETE') {
      stops += 1
      return route.fulfill({ json: { ok: true } })
    }
    return route.fulfill({ json: { session_id: 'synthetic-session', backend: 'synthetic', workdir: '/synthetic' } })
  })
  await page.getByRole('combobox', { name: 'Agent mode' }).click()
  await page.getByRole('option', { name: 'Code', exact: true }).click()
  await page.getByRole('button', { name: 'Toggle SWE mode' }).click()
  await page.getByRole('textbox', { name: 'Message input' }).fill('synthetic command')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop SWE session' })).toBeVisible()
  await page.setViewportSize({ width: 320, height: 740 })
  await expect(page.getByRole('button', { name: 'Message options' })).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByText('Developer workspace mode', { exact: true })).toBeVisible()
  await expect(page.getByText('Developer workspace session active.', { exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Agent mode' })).toHaveText('Code')
  const stop = page.getByRole('button', { name: 'Stop SWE session' })
  await hitTarget(stop)
  await stop.click()
  await expect.poll(() => stops).toBe(1)
  expect(actions).toBe(1)
  await expect(stop).toHaveCount(0)
  await expect(page.getByText('Developer workspace mode enabled.', { exact: true })).toBeVisible()
})

test('compact approval cue follows the existing review arrival, disclosure and decision', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await prepare(page)
  const review = page.getByRole('button', { name: 'Review required approval' })
  await expect(review).toHaveCount(0)
  await page.evaluate(() => {
    localStorage.setItem(
      'chat:["owner-v1","synthetic","documentation-demo"]:messages:/pending-review',
      JSON.stringify([
        {
          id: 'pending',
          role: 'assistant',
          parts: [
            {
              type: 'tool-agent_tool',
              toolCallId: 'review-1',
              state: 'input-available',
              input: { target: 'synthetic' },
            },
          ],
          annotations: [{ event: 'approval_required', data: { tool_call_id: 'review-1', tool_name: 'synthetic' } }],
        },
      ]),
    )
    history.pushState({}, '', '/workspace/work?conversation=%2Fpending-review')
    window.dispatchEvent(new Event('history-state-changed'))
  })
  await expect(review).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
  await review.click()
  await expect(page.getByRole('group', { name: 'Required approval' })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('textbox', { name: 'Message input' })).toBeFocused()
  await expect(review).toBeVisible()
  await review.click()
  await page.getByRole('button', { name: 'Reject', exact: true }).click()
  await expect(review).toHaveCount(0)
  await expect(page.getByText('synthetic — Rejected', { exact: true })).toBeVisible()
})

test('fresh secondary workspace entries do not autofocus or scroll down to the composer', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await prepare(page, transcript, '/workspace/explore')
  for (const path of ['/workspace/explore', '/workspace/operate']) {
    await page.goto(path)
    const input = page.getByRole('textbox', { name: 'Message input' })
    await expect(input).toBeVisible()
    await expect(input).not.toBeFocused()
    expect(await page.locator('.workspace-viewport').evaluate((element) => element.scrollTop)).toBe(0)
    await info.attach(`native-chat-fresh-${path.split('/').at(-1)}.png`, {
      body: await page.screenshot({
        path: info.outputPath(`native-chat-fresh-${path.split('/').at(-1)}.png`),
        animations: 'disabled',
      }),
      contentType: 'image/png',
    })
  }
  await page.getByRole('button', { name: 'Focus message input' }).click()
  await expect(page.getByRole('textbox', { name: 'Message input' })).toBeFocused()
})

test('native composer and task remain reachable with enlarged text at narrow and low height', async ({
  page,
}, info) => {
  await prepare(page, transcript, '/workspace/operate')
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  for (const size of [
    { width: 320, height: 740 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size)
    const context = page.locator('.workspace-context-content')
    const input = page.getByRole('textbox', { name: 'Message input' })
    await context.scrollIntoViewIfNeeded()
    expect((await context.boundingBox())!.height).toBeGreaterThanOrEqual(200)
    await expect
      .poll(() =>
        page
          .locator('.workspace-assistant-content, .workspace-assistant .chat-flow')
          .evaluateAll((elements) => elements.every((element) => element.scrollHeight <= element.clientHeight + 1)),
      )
      .toBe(true)
    await reachComposerByWheel(page, input)
    await input.fill('Enlarged text draft')
    await hitTarget(input)
    const mode = page.getByRole('combobox', { name: 'Agent mode' })
    const expand = page.getByRole('button', { name: 'Expand chat', exact: true })
    for (const [control, key] of [
      [mode, 'Tab'],
      [expand, 'Shift+Tab'],
    ] as const) {
      for (let attempt = 0; attempt < 32; attempt += 1) {
        if (await control.evaluate((element) => element === document.activeElement)) break
        await page.keyboard.press(key)
      }
      await expect(control).toBeFocused()
      await hitTarget(control, false)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await info.attach(`native-chat-large-text-${size.width}x${size.height}.png`, {
      body: await page.screenshot({
        path: info.outputPath(`native-chat-large-text-${size.width}x${size.height}.png`),
        animations: 'disabled',
      }),
      contentType: 'image/png',
    })
  }
})
