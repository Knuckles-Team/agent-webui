import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { Identity } from '@/lib/auth'
import { PageContextProvider } from '@/lib/page-context'
import { WebMcpProvider, useWebMcpToolSet } from '../provider'
import { makeTool } from '../tools'
import type { WebMcpToolDefinition } from '../types'

const IDENTITY: Identity = {
  userKey: 'reader-1',
  role: 'reader',
  ssoConfigured: false,
  needsSignIn: false,
  raw: null,
}
const OUTPUT = z.object({ outcome: z.enum(['cancelled', 'completed']) }).strict()
let registered: WebMcpToolDefinition[] = []

function pendingTool() {
  const signals: AbortSignal[] = []
  const finish: (() => void)[] = []
  const tool = makeTool({
    name: 'overstory.pending-read',
    title: 'Pending read',
    description: 'Cooperative local test read',
    inputSchema: z.object({}).strict(),
    outputSchema: OUTPUT,
    jsonSchema: { type: 'object' },
    readOnly: true,
    execute: (_input, { signal }) =>
      new Promise<z.infer<typeof OUTPUT>>((resolve) => {
        signals.push(signal)
        signal.addEventListener(
          'abort',
          () => {
            resolve({ outcome: 'cancelled' })
          },
          { once: true },
        )
        finish.push(() => {
          resolve({ outcome: 'completed' })
        })
      }),
  })
  return { tool, signals, finish }
}

function Child({ tool }: { tool: WebMcpToolDefinition }) {
  useWebMcpToolSet([tool])
  return <main>Manual content</main>
}

function Surface({
  tool,
  route = '/graph',
  identity = IDENTITY,
}: {
  tool: WebMcpToolDefinition
  route?: string
  identity?: Identity
}) {
  return (
    <PageContextProvider route={route} view="graph">
      <WebMcpProvider identity={identity}>
        <Child tool={tool} />
      </WebMcpProvider>
    </PageContextProvider>
  )
}

beforeEach(() => {
  registered = []
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  Object.defineProperty(document, 'modelContext', {
    configurable: true,
    value: {
      registerTool: (tool: WebMcpToolDefinition) => {
        registered.push(tool)
        return Promise.resolve()
      },
    },
  })
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(document, 'modelContext')
})

async function activeCallback(): Promise<WebMcpToolDefinition> {
  await waitFor(() => {
    expect(registered.some((tool) => tool.name.startsWith('overstory.pending-read__'))).toBe(true)
  })
  // Let the structural document API's registration acknowledgement settle.
  await act(async () => {
    await Promise.resolve()
  })
  const tool = registered.find((entry) => entry.name.startsWith('overstory.pending-read__'))
  if (!tool) throw new Error('missing test tool')
  return tool
}

describe('registration-bound cooperative execution (document API fixture)', () => {
  it.each(['route', 'identity', 'hidden', 'unmount'] as const)(
    'propagates %s retirement to an in-flight child call',
    async (reason) => {
      const pending = pendingTool()
      const view = render(<Surface tool={pending.tool} />)
      const callback = await activeCallback()
      const result = callback.execute({}, { signal: new AbortController().signal })
      expect(pending.signals).toHaveLength(1)
      act(() => {
        if (reason === 'route') view.rerender(<Surface tool={pending.tool} route="/explore" />)
        if (reason === 'identity')
          view.rerender(<Surface tool={pending.tool} identity={{ ...IDENTITY, userKey: 'reader-2' }} />)
        if (reason === 'hidden') {
          Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
          document.dispatchEvent(new Event('visibilitychange'))
        }
        if (reason === 'unmount') view.unmount()
      })
      expect(pending.signals[0].aborted).toBe(true)
      await expect(result).resolves.toEqual({ outcome: 'cancelled' })
      await expect(callback.execute({}, { signal: new AbortController().signal })).rejects.toThrow('not active')
    },
  )

  it('cancels one caller without cancelling another call or its registration', async () => {
    const pending = pendingTool()
    render(<Surface tool={pending.tool} />)
    const callback = await activeCallback()
    const caller = new AbortController()
    const first = callback.execute({}, { signal: caller.signal })
    const second = callback.execute({}, { signal: new AbortController().signal })
    caller.abort()
    await expect(first).resolves.toEqual({ outcome: 'cancelled' })
    expect(pending.signals[1].aborted).toBe(false)
    pending.finish[1]()
    await expect(second).resolves.toEqual({ outcome: 'completed' })
  })

  it('detaches settled calls from later caller and registration cancellation', async () => {
    const pending = pendingTool()
    const view = render(<Surface tool={pending.tool} />)
    const callback = await activeCallback()
    const caller = new AbortController()
    const result = callback.execute({}, { signal: caller.signal })
    pending.finish[0]()
    await expect(result).resolves.toEqual({ outcome: 'completed' })
    caller.abort()
    view.unmount()
    expect(pending.signals[0].aborted).toBe(false)
  })

  it('does not dispatch pre-cancelled work or rewrite an already returned outcome', async () => {
    const pending = pendingTool()
    const view = render(<Surface tool={pending.tool} />)
    const callback = await activeCallback()
    const caller = new AbortController()
    caller.abort()
    await expect(callback.execute({}, { signal: caller.signal })).rejects.toThrow('cancelled')
    expect(pending.signals).toHaveLength(0)
    const completed = callback.execute({}, { signal: new AbortController().signal })
    pending.finish[0]()
    view.unmount()
    await expect(completed).resolves.toEqual({ outcome: 'completed' })
  })
})
