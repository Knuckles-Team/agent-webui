import { describe, expect, it, vi } from 'vitest'

import { CALL_TIMEOUT_MS, MAX_INFLIGHT_CALLS, MAX_MESSAGES_PER_SECOND, attachMcpAppBridge } from '../bridge'

/** A minimal stand-in for an iframe's `contentWindow`: only `postMessage`
 * is ever called on it by the bridge. */
function createFrameWindow() {
  const posted: unknown[] = []
  const frameWindow = {
    postMessage: vi.fn((message: unknown) => {
      posted.push(message)
    }),
  } as unknown as Window
  return { frameWindow, posted }
}

function dispatchFromFrame(frameWindow: Window, data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data, source: frameWindow }))
}

describe('attachMcpAppBridge', () => {
  it('responds to mcpapp/ready with mcpapp/init carrying the initial props', () => {
    const { frameWindow, posted } = createFrameWindow()
    const detach = attachMcpAppBridge({
      frameWindow,
      initProps: { jobId: 'orch-1' },
      policy: () => true,
      callTool: vi.fn(),
    })
    dispatchFromFrame(frameWindow, { type: 'mcpapp/ready' })
    expect(posted).toEqual([{ type: 'mcpapp/init', props: { jobId: 'orch-1' } }])
    detach()
  })

  it('executes an allowed tool call and posts back the result', async () => {
    const { frameWindow, posted } = createFrameWindow()
    const callTool = vi.fn().mockResolvedValue({ status: 'working' })
    const detach = attachMcpAppBridge({
      frameWindow,
      initProps: {},
      policy: (name) => name === 'graph_jobs',
      callTool,
    })
    dispatchFromFrame(frameWindow, {
      type: 'mcpapp/tool-call',
      id: 'call-1',
      name: 'graph_jobs',
      arguments: { action: 'status', job_id: 'orch-1' },
    })
    await vi.waitFor(() => {
      expect(posted).toContainEqual({
        type: 'mcpapp/tool-result',
        id: 'call-1',
        result: { status: 'working' },
      })
    })
    expect(callTool).toHaveBeenCalledWith('graph_jobs', { action: 'status', job_id: 'orch-1' })
    detach()
  })

  it('refuses a tool call the policy denies, without ever calling callTool', async () => {
    const { frameWindow, posted } = createFrameWindow()
    const callTool = vi.fn()
    const onRefused = vi.fn()
    const detach = attachMcpAppBridge({
      frameWindow,
      initProps: {},
      policy: () => false,
      callTool,
      onRefused,
    })
    dispatchFromFrame(frameWindow, {
      type: 'mcpapp/tool-call',
      id: 'call-2',
      name: 'delete_everything',
      arguments: {},
    })
    expect(callTool).not.toHaveBeenCalled()
    expect(posted).toEqual([
      {
        type: 'mcpapp/tool-error',
        id: 'call-2',
        error: { message: 'Tool "delete_everything" is not permitted for this app.' },
      },
    ])
    expect(onRefused).toHaveBeenCalledWith('denied by policy: delete_everything')
    detach()
  })

  it('posts a tool-error when callTool rejects', async () => {
    const { frameWindow, posted } = createFrameWindow()
    const callTool = vi.fn().mockRejectedValue(new Error('downstream failed'))
    const detach = attachMcpAppBridge({
      frameWindow,
      initProps: {},
      policy: () => true,
      callTool,
    })
    dispatchFromFrame(frameWindow, {
      type: 'mcpapp/tool-call',
      id: 'call-3',
      name: 'graph_jobs',
      arguments: {},
    })
    await vi.waitFor(() => {
      expect(posted).toContainEqual({
        type: 'mcpapp/tool-error',
        id: 'call-3',
        error: { message: 'downstream failed' },
      })
    })
    detach()
  })

  it('ignores messages that do not come from the bridged frame window', () => {
    const { frameWindow, posted } = createFrameWindow()
    const { frameWindow: otherWindow } = createFrameWindow()
    const callTool = vi.fn()
    const detach = attachMcpAppBridge({
      frameWindow,
      initProps: {},
      policy: () => true,
      callTool,
    })
    dispatchFromFrame(otherWindow, { type: 'mcpapp/ready' })
    expect(posted).toEqual([])
    detach()
  })

  it('ignores malformed messages and reports why', () => {
    const { frameWindow, posted } = createFrameWindow()
    const onRefused = vi.fn()
    const detach = attachMcpAppBridge({
      frameWindow,
      initProps: {},
      policy: () => true,
      callTool: vi.fn(),
      onRefused,
    })
    dispatchFromFrame(frameWindow, { type: 'mcpapp/tool-call', id: 1, name: 'x' })
    expect(posted).toEqual([])
    expect(onRefused).toHaveBeenCalledWith('malformed message')
    detach()
  })

  it('stops responding once detached', () => {
    const { frameWindow, posted } = createFrameWindow()
    const detach = attachMcpAppBridge({
      frameWindow,
      initProps: {},
      policy: () => true,
      callTool: vi.fn(),
    })
    detach()
    dispatchFromFrame(frameWindow, { type: 'mcpapp/ready' })
    expect(posted).toEqual([])
  })

  describe('resource bounds', () => {
    // A resolver-per-call MCP client that never settles on its own -- lets
    // these tests hold calls open to observe the in-flight cap and the
    // timeout, without a real backend.
    function createHangingCallTool() {
      const resolvers: ((result: unknown) => void)[] = []
      const callTool = vi.fn(() => new Promise((resolve) => resolvers.push(resolve as (r: unknown) => void)))
      return { callTool, resolvers }
    }

    it(`refuses a ${String(MAX_INFLIGHT_CALLS + 1)}th concurrent tool call while ${String(MAX_INFLIGHT_CALLS)} are outstanding`, () => {
      const { frameWindow, posted } = createFrameWindow()
      const { callTool } = createHangingCallTool()
      const onRefused = vi.fn()
      const detach = attachMcpAppBridge({
        frameWindow,
        initProps: {},
        policy: () => true,
        callTool,
        onRefused,
      })

      for (let i = 0; i < MAX_INFLIGHT_CALLS; i++) {
        dispatchFromFrame(frameWindow, {
          type: 'mcpapp/tool-call',
          id: `call-${String(i)}`,
          name: 'graph_jobs',
          arguments: {},
        })
      }
      expect(callTool).toHaveBeenCalledTimes(MAX_INFLIGHT_CALLS)
      expect(posted).toEqual([])

      dispatchFromFrame(frameWindow, {
        type: 'mcpapp/tool-call',
        id: 'call-overflow',
        name: 'graph_jobs',
        arguments: {},
      })

      expect(callTool).toHaveBeenCalledTimes(MAX_INFLIGHT_CALLS) // not called an 9th time
      expect(posted).toEqual([
        {
          type: 'mcpapp/tool-error',
          id: 'call-overflow',
          error: { message: `Too many tool calls in flight (max ${String(MAX_INFLIGHT_CALLS)}); try again shortly.` },
        },
      ])
      expect(onRefused).toHaveBeenCalledWith('too many in-flight calls: graph_jobs')
      detach()
    })

    it('refuses a call once the in-flight cap frees up... after a slot resolves, a new call is accepted again', async () => {
      const { frameWindow, posted } = createFrameWindow()
      const { callTool, resolvers } = createHangingCallTool()
      const detach = attachMcpAppBridge({ frameWindow, initProps: {}, policy: () => true, callTool })

      for (let i = 0; i < MAX_INFLIGHT_CALLS; i++) {
        dispatchFromFrame(frameWindow, { type: 'mcpapp/tool-call', id: `call-${String(i)}`, name: 'x', arguments: {} })
      }
      resolvers[0]({ ok: true }) // free one slot
      await vi.waitFor(() => {
        expect(posted).toContainEqual({ type: 'mcpapp/tool-result', id: 'call-0', result: { ok: true } })
      })

      dispatchFromFrame(frameWindow, { type: 'mcpapp/tool-call', id: 'call-next', name: 'x', arguments: {} })
      expect(callTool).toHaveBeenCalledTimes(MAX_INFLIGHT_CALLS + 1) // the freed slot let this one through
      detach()
    })

    it(`times out a call that never resolves within ${String(CALL_TIMEOUT_MS)}ms and frees its slot`, () => {
      vi.useFakeTimers()
      try {
        const { frameWindow, posted } = createFrameWindow()
        const { callTool } = createHangingCallTool()
        const detach = attachMcpAppBridge({ frameWindow, initProps: {}, policy: () => true, callTool })

        dispatchFromFrame(frameWindow, {
          type: 'mcpapp/tool-call',
          id: 'call-slow',
          name: 'graph_jobs',
          arguments: {},
        })
        expect(posted).toEqual([])

        vi.advanceTimersByTime(CALL_TIMEOUT_MS)

        expect(posted).toEqual([
          {
            type: 'mcpapp/tool-error',
            id: 'call-slow',
            error: { message: `Tool "graph_jobs" timed out after ${String(CALL_TIMEOUT_MS)}ms.` },
          },
        ])

        // The freed slot accepts a new call immediately -- the timeout did
        // not leave the in-flight accounting stuck.
        dispatchFromFrame(frameWindow, {
          type: 'mcpapp/tool-call',
          id: 'call-after',
          name: 'graph_jobs',
          arguments: {},
        })
        expect(callTool).toHaveBeenCalledTimes(2)
        detach()
      } finally {
        vi.useRealTimers()
      }
    })

    it('a real result arriving after the timeout is a no-op (no double post)', async () => {
      vi.useFakeTimers()
      try {
        const { frameWindow, posted } = createFrameWindow()
        const { callTool, resolvers } = createHangingCallTool()
        const detach = attachMcpAppBridge({ frameWindow, initProps: {}, policy: () => true, callTool })

        dispatchFromFrame(frameWindow, {
          type: 'mcpapp/tool-call',
          id: 'call-late',
          name: 'graph_jobs',
          arguments: {},
        })
        vi.advanceTimersByTime(CALL_TIMEOUT_MS)
        expect(posted).toHaveLength(1) // the timeout error

        resolvers[0]({ ignored: true }) // the real backend answers late
        vi.useRealTimers()
        await new Promise((resolve) => setTimeout(resolve, 0)) // flush the settled promise's microtask
        expect(posted).toHaveLength(1) // still just the timeout -- no late double post
        detach()
      } finally {
        vi.useRealTimers()
      }
    })

    it(`throttles a ${String(MAX_MESSAGES_PER_SECOND + 1)}th message within one second`, () => {
      const { frameWindow, posted } = createFrameWindow()
      const onRefused = vi.fn()
      const callTool = vi.fn().mockResolvedValue({})
      const detach = attachMcpAppBridge({ frameWindow, initProps: {}, policy: () => true, callTool, onRefused })

      for (let i = 0; i < MAX_MESSAGES_PER_SECOND; i++) {
        dispatchFromFrame(frameWindow, { type: 'mcpapp/ready' })
      }
      expect(posted).toHaveLength(MAX_MESSAGES_PER_SECOND)

      dispatchFromFrame(frameWindow, {
        type: 'mcpapp/tool-call',
        id: 'throttled-call',
        name: 'graph_jobs',
        arguments: {},
      })

      expect(posted).toHaveLength(MAX_MESSAGES_PER_SECOND + 1)
      expect(posted[MAX_MESSAGES_PER_SECOND]).toEqual({
        type: 'mcpapp/tool-error',
        id: 'throttled-call',
        error: { message: 'This app is sending requests too quickly and was throttled.' },
      })
      expect(callTool).not.toHaveBeenCalled()
      expect(onRefused).toHaveBeenCalledWith('rate limited: too many messages per second')
      detach()
    })
  })
})
