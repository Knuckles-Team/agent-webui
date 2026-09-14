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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import McpAppsView from '@/components/views/McpAppsView'
import { MCPProvider } from '@/lib/mcp-context'
import { MAX_CATALOG_TOOLS, MCP_APP_RESOURCE_ROUTE, mcpServerToolsRoute } from '@/lib/mcp-client'

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
]

function mockFetch() {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input)
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    calls.push({ method: init?.method ?? 'GET', url, body })

    if (url === TOOLS_ROUTE) {
      // The backend's paginated envelope, with the TRUE total.
      return Promise.resolve(
        new Response(
          JSON.stringify({
            server: 'graph-os',
            tools: TOOL_INVENTORY,
            total: 37,
            offset: 0,
            limit: MAX_CATALOG_TOOLS,
            has_more: true,
          }),
          { status: 200 },
        ),
      )
    }
    if (url === MCP_APP_RESOURCE_ROUTE) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: 'success',
            result: { uri: (body?.uri as string) ?? '', html: APP_HTML, mimeType: 'text/html' },
          }),
          { status: 200 },
        ),
      )
    }
    return Promise.resolve(new Response('not found', { status: 404 }))
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

  it('is a renderable default export that mounts without throwing', () => {
    expect(typeof McpAppsView).toBe('function')
    expect(() => renderMcpAppsView()).not.toThrow()
  })
})
