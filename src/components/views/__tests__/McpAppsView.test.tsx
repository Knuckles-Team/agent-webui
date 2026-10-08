/**
 * Wiring tests for the MCP Apps production launcher route (GOC-26-W04).
 *
 * These prove the whole discovery -> launch path, not that the component
 * exists: the view fetches the REAL tool-inventory route
 * (`GET /api/enhanced/mcp/servers/{server}/tools`), filters to tools
 * carrying a usable `meta.ui.resourceUri`, and only THEN can a card be
 * clicked to mount the real `McpAppHost`, which performs its own real
 * `resources/read` fetch (proven end-to-end by `McpAppHost.test.tsx`; this
 * file's job is proving the launcher wires that same seam to a
 * server-discovered tool rather than a hardcoded URI).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import McpAppsView from '@/components/views/McpAppsView'
import { MCPProvider } from '@/lib/mcp-context'
import { MAX_CATALOG_TOOLS, MCP_APP_RESOURCE_ROUTE, MCP_TOOL_CALL_ROUTE, mcpServerToolsRoute } from '@/lib/mcp-client'

// The route is paginated; the client asks for its whole documented budget
// in one page so MCP Apps discovery is never narrowed to the
// alphabetically-first slice of a large server's catalog.
const TOOLS_ROUTE = mcpServerToolsRoute('graph-os', undefined, MAX_CATALOG_TOOLS)
const APP_URI = 'ui://graph-os/task-progress.html'
const APP_HTML = '<html><head></head><body><div id="jobId">-</div></body></html>'

interface FetchCall {
  method: string
  url: string
  body: Record<string, unknown> | undefined
}

let calls: FetchCall[] = []

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/** A tool WITH a usable `meta.ui.resourceUri` (BUG-071 wire shape) and a
 * plain tool WITHOUT one -- the known-good / known-bad pair this suite
 * proves against. `graph_jobs` also carries a server-declared `csp` domain
 * on an (invalid, no-op) `meta.ui` to prove it is never honored, since only
 * `graph_task_progress_app` actually declares a `resourceUri`. */
const TOOL_INVENTORY = [
  {
    name: 'graph_task_progress_app',
    description: 'Launch a live task-progress MCP App for a durable job.',
    input_schema: {},
    enabled: true,
    meta: {
      ui: {
        resourceUri: APP_URI,
        visibility: ['model'],
        csp: { connectDomains: ['https://evil.example'] },
      },
    },
  },
  {
    name: 'graph_jobs',
    description: 'Dispatch, query, and approve durable jobs.',
    input_schema: {},
    enabled: true,
  },
  // agent-utilities PR #54's condensed contract: `ask`/`act` are themselves
  // listed catalog tools (with real schemas) once the server adopts it, so
  // `collectAllowedToolSchemas` picks them up like any other discovered tool.
  {
    name: 'ask',
    description: 'Read-oriented intent tool (find/query/explain).',
    input_schema: { type: 'object', properties: { action: { type: 'string' }, params: { type: 'object' } } },
    enabled: true,
  },
  {
    name: 'act',
    description: 'Write/execute-oriented intent tool, reaches graph_jobs/graph_traces operations.',
    input_schema: { type: 'object', properties: { action: { type: 'string' }, params: { type: 'object' } } },
    enabled: true,
  },
]

/** The backend's paginated tool-inventory envelope, with the TRUE total. */
function toolsRouteResponse(): Response {
  return new Response(
    JSON.stringify({
      server: 'graph-os',
      tools: TOOL_INVENTORY,
      total: 37,
      offset: 0,
      limit: MAX_CATALOG_TOOLS,
      has_more: true,
    }),
    { status: 200 },
  )
}

function resourceRouteResponse(body: Record<string, unknown> | undefined): Response {
  return new Response(
    JSON.stringify({
      status: 'success',
      result: { uri: (body?.uri as string) ?? '', html: APP_HTML, mimeType: 'text/html' },
    }),
    { status: 200 },
  )
}

function toolCallRouteResponse(): Response {
  return new Response(JSON.stringify({ status: 'success', result: { status: 'working', jobId: 'orch-1' } }), {
    status: 200,
  })
}

/** Route -> handler dispatch table (each route's own response shape stays a
 * flat, independently readable function instead of a growing if/else chain). */
const ROUTE_HANDLERS: Record<string, (body: Record<string, unknown> | undefined) => Response> = {
  [TOOLS_ROUTE]: toolsRouteResponse,
  [MCP_APP_RESOURCE_ROUTE]: resourceRouteResponse,
  [MCP_TOOL_CALL_ROUTE]: toolCallRouteResponse,
}

function mockFetch() {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input)
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    calls.push({ method: init?.method ?? 'GET', url, body })
    const handler = ROUTE_HANDLERS[url]
    return Promise.resolve(handler ? handler(body) : new Response('not found', { status: 404 }))
  })
}

interface PostedMessage {
  message: unknown
  targetOrigin: unknown
}

const postMessageRestorers: (() => void)[] = []

/** Capture what the bridge posts INTO a launched app's frame (mirrors
 * `McpAppHost.test.tsx`'s `recordPosts`): the bridge holds the frame's
 * `Window` and calls `postMessage` on it directly, so the recorder replaces
 * that method on the very window the bridge bound to. */
function recordPosts(frame: HTMLIFrameElement): PostedMessage[] {
  const win = frame.contentWindow as Window & { postMessage: (...args: unknown[]) => void }
  const original = win.postMessage
  const posted: PostedMessage[] = []
  win.postMessage = (message: unknown, targetOrigin: unknown) => {
    posted.push({ message, targetOrigin })
  }
  postMessageRestorers.push(() => {
    win.postMessage = original
  })
  return posted
}

/** Send a message AS the app's iframe (exact window identity, as the bridge requires). */
function postFromApp(frame: HTMLIFrameElement, data: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source: frame.contentWindow }))
  })
}

function renderMcpAppsView(props: { allowedDomains?: string[] } = {}) {
  return render(
    <MCPProvider>
      <McpAppsView {...props} />
    </MCPProvider>,
  )
}

describe('McpAppsView (wiring)', () => {
  beforeEach(() => {
    calls = []
    vi.stubGlobal('fetch', mockFetch())
  })

  afterEach(() => {
    while (postMessageRestorers.length > 0) postMessageRestorers.pop()?.()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('fetches the real tool inventory on mount', async () => {
    renderMcpAppsView()
    await waitFor(() => {
      expect(calls.some((c) => c.url === TOOLS_ROUTE && c.method === 'GET')).toBe(true)
    })
  })

  it('offers a tool WITH meta.ui.resourceUri as a launchable app', async () => {
    renderMcpAppsView()
    expect(await screen.findByTestId('mcp-app-card-graph_task_progress_app')).toBeInTheDocument()
    expect(screen.getByText(/1 of 37 graph-os tools/)).toBeInTheDocument()
  })

  it('never offers a tool WITHOUT meta.ui.resourceUri as launchable (known-bad proof)', async () => {
    renderMcpAppsView()
    // Wait for the fetch to resolve and the launchable list to render...
    await screen.findByTestId('mcp-app-card-graph_task_progress_app')
    // ...then assert the tool with no app binding never got a card, even
    // though it was present in the exact same inventory response.
    expect(screen.queryByTestId('mcp-app-card-graph_jobs')).toBeNull()
    expect(screen.queryByText('graph_jobs')).toBeNull()
  })

  /** The launched app's iframe and its card both legitimately carry a
   * `title`/`title`-attribute of the tool name (the card's is a truncation
   * tooltip, matching `CatalogueView`'s convention) -- `screen.findByTitle`
   * cannot disambiguate the two, so locate the iframe by tag directly. */
  async function findLaunchedFrame(): Promise<HTMLIFrameElement> {
    return waitFor(() => {
      const frame = document.querySelector('iframe[title="graph_task_progress_app"]')
      if (!frame) throw new Error('app frame not mounted yet')
      return frame as HTMLIFrameElement
    })
  }

  it('launching a discovered app performs a real resources/read for ITS OWN resourceUri, not a hardcoded one', async () => {
    renderMcpAppsView()
    const card = await screen.findByTestId('mcp-app-card-graph_task_progress_app')
    card.click()

    await waitFor(() => {
      const resourceCall = calls.find((c) => c.url === MCP_APP_RESOURCE_ROUTE)
      expect(resourceCall).toBeDefined()
      expect(resourceCall?.body).toEqual({ server: 'graph-os', uri: APP_URI, timeout_ms: 10000 })
    })

    const frame = await findLaunchedFrame()
    expect(frame).toBeInTheDocument()
  })

  it('sandboxes the launched frame and never honors a server-declared CSP domain the host did not independently allow', async () => {
    renderMcpAppsView()
    const card = await screen.findByTestId('mcp-app-card-graph_task_progress_app')
    card.click()

    const frame = await findLaunchedFrame()
    // No ambient privilege: scripts only, explicitly never same-origin.
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
    // The resolved CSP is present and 'none'-sourced for connect-src even
    // though the tool's own meta.ui.csp declared `evil.example` -- this view
    // grants no `allowedDomains`, so the declared domain is never honored.
    expect(frame.srcdoc).toContain('Content-Security-Policy')
    expect(frame.srcdoc).toContain("connect-src 'none'")
    expect(frame.srcdoc).not.toContain('evil.example')
  })

  it('passes only the independently configured host ceiling to the app frame', async () => {
    renderMcpAppsView({ allowedDomains: ['https://evil.example'] })
    const card = await screen.findByTestId('mcp-app-card-graph_task_progress_app')
    card.click()

    const frame = await findLaunchedFrame()
    expect(frame.srcdoc).toContain('connect-src https://evil.example')
  })

  it('keeps the last valid initial props when the editor receives invalid JSON', async () => {
    renderMcpAppsView()
    const card = await screen.findByTestId('mcp-app-card-graph_task_progress_app')
    card.click()

    const textarea = await screen.findByLabelText(/Initial props \(JSON\)/i)
    fireEvent.change(textarea, { target: { value: '{"jobId":"valid"}' } })
    fireEvent.change(textarea, { target: { value: '{"jobId":' } })

    expect(screen.getByRole('alert')).toHaveTextContent('Invalid JSON; using the last valid props.')
  })

  it('surfaces an unavailable inventory honestly rather than an empty confirmed list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('boom', { status: 503 }))),
    )
    renderMcpAppsView()
    expect(await screen.findByText(/could not be fetched/i)).toBeInTheDocument()
  })

  /** agent-utilities PR #54 condenses the served MCP contract to
   * `ask`/`find`/`write`/`act`/`manage`/`why`; `graph_jobs`/`graph_traces`
   * become operations reached through `ask`/`act` rather than listed tools.
   * This host's allow-list for `graph_task_progress_app` must honor `ask`
   * and `act` end-to-end -- not merely list them -- so a call for either
   * reaches the real `tools/call` wire instead of being denied by policy. */
  it.each(['ask', 'act'])('allows the condensed intent tool %s through to the real tools/call wire', async (name) => {
    renderMcpAppsView()
    const card = await screen.findByTestId('mcp-app-card-graph_task_progress_app')
    card.click()
    const frame = await findLaunchedFrame()
    await waitFor(() => {
      expect(frame).toHaveAttribute('data-mcp-app-attached', 'true')
    })

    const posted = recordPosts(frame)
    postFromApp(frame, { type: 'mcpapp/ready' })
    postFromApp(frame, { type: 'mcpapp/tool-call', id: 'call-1', name, arguments: { action: 'status' } })

    await waitFor(() => {
      expect(calls.some((c) => c.url === MCP_TOOL_CALL_ROUTE && c.body?.tool === name)).toBe(true)
    })
    await waitFor(() => {
      expect(posted).toContainEqual(
        expect.objectContaining({ message: expect.objectContaining({ type: 'mcpapp/tool-result', id: 'call-1' }) }),
      )
    })
  })

  it('is a renderable default export that mounts without throwing', () => {
    expect(typeof McpAppsView).toBe('function')
    expect(() => renderMcpAppsView()).not.toThrow()
  })
})
