/**
 * Wiring tests for the MCP Apps host.
 *
 * These prove the whole path, not that a symbol exists: a mounted `McpAppHost`
 * really issues `resources/read` over HTTP, renders the returned HTML in the
 * sandboxed frame, and — when the app inside that frame asks for a tool — a
 * real `tools/call` HTTP request leaves the client with the right body and its
 * result is posted back into the frame. A denied tool never reaches the wire
 * at all.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { McpAppHost } from '../McpAppHost'
import { MCP_APP_RESOURCE_ROUTE, MCP_TOOL_CALL_ROUTE } from '@/lib/mcp-client'

const APP_URI = 'ui://graph-os/task-progress.html'
const APP_HTML = '<html><head></head><body><div id="jobId">-</div></body></html>'

interface RecordedCall {
  route: string
  body: Record<string, unknown>
}

const calls: RecordedCall[] = []
let toolResult: unknown = { status: 'working', jobId: 'orch-1' }

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

/** A faithful stand-in for the two governed backend routes. */
function mcpFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const route = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
  calls.push({ route, body })
  if (route === MCP_APP_RESOURCE_ROUTE) {
    return Promise.resolve(
      jsonResponse({
        status: 'success',
        result: { uri: body.uri, html: APP_HTML, mimeType: 'text/html' },
      }),
    )
  }
  if (route === MCP_TOOL_CALL_ROUTE) {
    return Promise.resolve(jsonResponse({ status: 'success', result: toolResult }))
  }
  return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('no route') } as unknown as Response)
}

/** Send a message AS the app's iframe (exact window identity, as the bridge requires). */
function postFromApp(frame: HTMLIFrameElement, data: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source: frame.contentWindow }))
  })
}

async function mountApp(allowedTools: string[]): Promise<HTMLIFrameElement> {
  render(
    <McpAppHost
      meta={{ resourceUri: APP_URI }}
      initProps={{ jobId: 'orch-1' }}
      allowedTools={allowedTools}
      title="Task Progress"
    />,
  )
  await waitFor(() => {
    expect(screen.getByTitle('Task Progress')).toBeInTheDocument()
  })
  return screen.getByTitle('Task Progress') as HTMLIFrameElement
}

describe('McpAppHost (wiring)', () => {
  beforeEach(() => {
    calls.length = 0
    toolResult = { status: 'working', jobId: 'orch-1' }
    global.fetch = vi.fn(mcpFetch) as unknown as typeof fetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches the ui:// resource over HTTP and renders the returned HTML sandboxed', async () => {
    const frame = await mountApp(['graph_jobs'])

    expect(calls[0].route).toBe(MCP_APP_RESOURCE_ROUTE)
    expect(calls[0].body).toEqual({ server: 'graph-os', uri: APP_URI })
    expect(frame.srcdoc).toContain('id="jobId"')
    // The HTML that came off the wire is rendered only inside the sandbox.
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(frame.srcdoc).toContain('Content-Security-Policy')
  })

  it('turns an app tool-call into a real tools/call request and returns its result', async () => {
    const frame = await mountApp(['graph_jobs'])
    const contentWindow = frame.contentWindow
    expect(contentWindow).not.toBeNull()
    const posted = vi.spyOn(contentWindow as Window, 'postMessage')

    postFromApp(frame, { type: 'mcpapp/ready' })
    expect(posted).toHaveBeenCalledWith({ type: 'mcpapp/init', props: { jobId: 'orch-1' } }, '*')

    postFromApp(frame, {
      type: 'mcpapp/tool-call',
      id: 'call-1',
      name: 'graph_jobs',
      arguments: { action: 'status', job_id: 'orch-1' },
    })

    await waitFor(() => {
      expect(calls.some((call) => call.route === MCP_TOOL_CALL_ROUTE)).toBe(true)
    })
    const toolCall = calls.find((call) => call.route === MCP_TOOL_CALL_ROUTE)
    expect(toolCall?.body).toEqual({
      server: 'graph-os',
      tool: 'graph_jobs',
      arguments: { action: 'status', job_id: 'orch-1' },
    })

    await waitFor(() => {
      expect(posted).toHaveBeenCalledWith(
        { type: 'mcpapp/tool-result', id: 'call-1', result: { status: 'working', jobId: 'orch-1' } },
        '*',
      )
    })
  })

  it('never puts a tool the host did not allow on the wire', async () => {
    const frame = await mountApp(['graph_jobs'])
    const contentWindow = frame.contentWindow
    const posted = vi.spyOn(contentWindow as Window, 'postMessage')

    postFromApp(frame, {
      type: 'mcpapp/tool-call',
      id: 'call-2',
      name: 'graph_write',
      arguments: { action: 'node' },
    })

    await waitFor(() => {
      expect(posted).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'mcpapp/tool-error', id: 'call-2' }),
        '*',
      )
    })
    expect(calls.some((call) => call.route === MCP_TOOL_CALL_ROUTE)).toBe(false)
    expect(await screen.findByText(/denied by policy: graph_write/)).toBeInTheDocument()
  })

  it('surfaces a backend failure to the app as a tool-error rather than a silent null', async () => {
    const frame = await mountApp(['graph_jobs'])
    const posted = vi.spyOn(frame.contentWindow as Window, 'postMessage')
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 501,
        text: () => Promise.resolve('Governed MCP delegation is not configured'),
      } as unknown as Response),
    ) as unknown as typeof fetch

    postFromApp(frame, {
      type: 'mcpapp/tool-call',
      id: 'call-3',
      name: 'graph_jobs',
      arguments: {},
    })

    await waitFor(() => {
      expect(posted).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mcpapp/tool-error',
          id: 'call-3',
          error: expect.objectContaining({
            message: expect.stringContaining('Governed MCP delegation is not configured'),
          }),
        }),
        '*',
      )
    })
  })

  it('reports an unreachable resource instead of rendering an empty frame', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 502, text: () => Promise.resolve('boom') } as unknown as Response),
    ) as unknown as typeof fetch

    render(<McpAppHost meta={{ resourceUri: APP_URI }} allowedTools={['graph_jobs']} title="Task Progress" />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load MCP app/)
    expect(screen.queryByTitle('Task Progress')).toBeNull()
  })
})
