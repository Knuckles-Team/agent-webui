import { describe, expect, it, vi } from 'vitest'

import { attachMcpAppBridge } from '../bridge'

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
})
