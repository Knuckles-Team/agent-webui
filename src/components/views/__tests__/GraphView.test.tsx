import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import GraphView from '@/components/views/GraphView'
import { api } from '@/lib/api'
import { PageContextProvider } from '@/lib/page-context'
import {
  renderWithProviders,
  mockGraphStats,
  mockGraphNodes,
  mockGraphNodeTypes,
  mockGraphRelationships,
} from '@/__tests__/fixtures'

// D-WUI-6 (pre-existing, distinct from the hostile-payload update also filed
// under this id) — GraphView calls usePageContextPublisher, which throws
// synchronously without a PageContextProvider ancestor. This file's own
// render calls never supplied one, so all 10 tests here (+ TemporalGraphView's)
// crashed on mount regardless of fetch data. Wrapping locally here (not in
// the shared `renderWithProviders`, which ~35 other test files also use and
// whose components mostly don't touch page-context) is the surgical fix.
function renderGraphView(ui = <GraphView />) {
  return renderWithProviders(
    <PageContextProvider route="/graph" view="graph">
      {ui}
    </PageContextProvider>,
  )
}

// Mock API calls. The component imports the `api` instance from '@/lib/api',
// so the factory must expose an `api` object carrying the spied methods.
vi.mock('@/lib/api', () => ({
  api: {
    getGraphStats: vi.fn(() => Promise.resolve(mockGraphStats)),
    getGraphNodes: vi.fn(() => Promise.resolve(mockGraphNodes)),
    getGraphRelationships: vi.fn(() => Promise.resolve(mockGraphRelationships)),
  },
}))

// GraphView fetches /api/enhanced/graph/{stats,nodes,relationships} on mount.
// The default fetch shim in setup.ts serves those from the same fixtures.
// These tests assert against the live "Unified Graph Workspace" UI: summary
// badges (Nodes/Edges counts) and the Visual Canvas / Cypher Console / MAGMA
// Context tabs.
describe('GraphView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders graph statistics correctly', async () => {
    renderGraphView()

    await waitFor(() => {
      expect(screen.getByText(new RegExp(`^Nodes:\\s*${mockGraphStats.total_nodes}$`))).toBeInTheDocument()
      expect(screen.getByText(new RegExp(`^Edges:\\s*${mockGraphStats.total_relationships}$`))).toBeInTheDocument()
    })
  })

  it('renders the workspace header', async () => {
    renderGraphView()

    await waitFor(() => {
      expect(screen.getByText('Unified Graph Workspace')).toBeInTheDocument()
    })
  })

  it('renders the three workspace tabs', async () => {
    renderGraphView()

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /visual canvas/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /cypher console/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /magma context/i })).toBeInTheDocument()
    })
  })

  it('switches to the cypher console tab', async () => {
    const { user } = renderGraphView()

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /cypher console/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('tab', { name: /cypher console/i }))

    await waitFor(() => {
      expect(screen.getByText('Query Editor')).toBeInTheDocument()
      expect(screen.getByText('Execution Output')).toBeInTheDocument()
    })
  })

  it('switches to the MAGMA context tab', async () => {
    const { user } = renderGraphView()

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /magma context/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('tab', { name: /magma context/i }))

    await waitFor(() => {
      expect(screen.getByText('Retrieved Perspectives Context')).toBeInTheDocument()
    })
  })

  it('defaults to the visual canvas tab', async () => {
    renderGraphView()

    await waitFor(() => {
      const canvasTab = screen.getByRole('tab', { name: /visual canvas/i })
      expect(canvasTab).toHaveAttribute('data-state', 'active')
    })
  })

  it('handles refresh button click', async () => {
    const { user } = renderGraphView()

    const nodesBadge = new RegExp(`^Nodes:\\s*${mockGraphStats.total_nodes}$`)
    await waitFor(() => {
      expect(screen.getByText(nodesBadge)).toBeInTheDocument()
    })

    // The refresh control is the icon-only button carrying the lucide refresh icon.
    const refreshButton = screen.getAllByRole('button').find((btn) => btn.querySelector('svg.lucide-refresh-cw'))
    expect(refreshButton).toBeDefined()
    await user.click(refreshButton as HTMLElement)

    // Stats remain rendered after a refresh round-trip.
    await waitFor(() => {
      expect(screen.getByText(nodesBadge)).toBeInTheDocument()
    })
  })

  // Defect A: a failed stats fetch must never render as "0" — that's
  // indistinguishable from a genuinely empty (but connected) graph. These
  // cover the three failure kinds `fetchData` can classify (`degraded`,
  // `error`, `unavailable`) plus the precise case where stats itself
  // succeeded despite another route failing.
  function mockGraphRoute(handlers: {
    stats?: { ok?: boolean; status?: number; body?: unknown }
    nodes?: { ok?: boolean; status?: number; body?: unknown }
    relationships?: { ok?: boolean; status?: number; body?: unknown }
    nodeTypes?: { ok?: boolean; status?: number; body?: unknown }
  }) {
    const respond = (h?: { ok?: boolean; status?: number; body?: unknown }, fallbackBody: unknown = []) => {
      const status = h?.status ?? 200
      const ok = h?.ok ?? (status >= 200 && status < 300)
      const body = h?.body ?? fallbackBody
      return Promise.resolve({
        ok,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
      } as unknown as Response)
    }
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/graph/stats')) return respond(handlers.stats, mockGraphStats)
      // Checked before '/graph/nodes' for clarity even though the two paths do
      // not actually collide ('node-types' does not contain 'nodes').
      if (url.includes('/graph/node-types')) return respond(handlers.nodeTypes, mockGraphNodeTypes)
      if (url.includes('/graph/relationships')) return respond(handlers.relationships, mockGraphRelationships)
      if (url.includes('/graph/nodes')) return respond(handlers.nodes, mockGraphNodes)
      return respond(undefined, [])
    }) as unknown as typeof fetch
  }

  it('shows "—" (not 0) for both badges when the stats fetch fails but nodes/relationships succeed (degraded)', async () => {
    mockGraphRoute({ stats: { ok: false, status: 503, body: 'Service Unavailable' } })

    renderGraphView()

    await waitFor(() => {
      expect(screen.getByText(/^Nodes:\s*—$/)).toBeInTheDocument()
      expect(screen.getByText(/^Edges:\s*—$/)).toBeInTheDocument()
    })
    // Never renders the stale/initial 0 in place of the dash.
    expect(screen.queryByText(/^Nodes:\s*0$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Edges:\s*0$/)).not.toBeInTheDocument()
  })

  it('shows "—" for both badges when every graph request fails (error)', async () => {
    mockGraphRoute({
      stats: { ok: false, status: 503, body: 'Service Unavailable' },
      nodes: { ok: false, status: 503, body: 'Service Unavailable' },
      relationships: { ok: false, status: 503, body: 'Service Unavailable' },
    })

    renderGraphView()

    await waitFor(() => {
      expect(screen.getByText(/^Nodes:\s*—$/)).toBeInTheDocument()
      expect(screen.getByText(/^Edges:\s*—$/)).toBeInTheDocument()
    })
  })

  it('shows "—" for both badges when the backend honestly reports available: false (unavailable)', async () => {
    mockGraphRoute({
      stats: { body: { total_nodes: 0, total_relationships: 0, available: false } },
    })

    renderGraphView()

    await waitFor(() => {
      expect(screen.getByText(/^Nodes:\s*—$/)).toBeInTheDocument()
      expect(screen.getByText(/^Edges:\s*—$/)).toBeInTheDocument()
    })
  })

  it('still shows the real stats numbers when stats succeeds even though another request fails (degraded)', async () => {
    mockGraphRoute({ nodes: { ok: false, status: 503, body: 'Service Unavailable' } })

    renderGraphView()

    await waitFor(() => {
      expect(screen.getByText(new RegExp(`^Nodes:\\s*${mockGraphStats.total_nodes}$`))).toBeInTheDocument()
      expect(screen.getByText(new RegExp(`^Edges:\\s*${mockGraphStats.total_relationships}$`))).toBeInTheDocument()
    })
  })

  // ── The defect this lane exists for ────────────────────────────────────
  // The dashboard's "counts by type" was `GraphLegend` grouping the bounded
  // `/graph/nodes` page (256 rows) and rendering the result as if it described
  // the graph. Live, that produced six types summing to exactly 256 while the
  // three types that are 82% of the graph never appeared. These tests pin the
  // replacement: the distribution comes from a real aggregate endpoint, and it
  // is NOT derived from the nodes on the canvas.

  it('renders the type distribution from /graph/node-types, not from the node page', async () => {
    // The node page deliberately contains a type the aggregate does not, and
    // omits types the aggregate reports. If the panel were still grouping the
    // node page, `Article`/`Tool` could not appear and `Memory` would show 1.
    mockGraphRoute({
      nodes: { body: [{ id: 'n1', labels: ['Memory'], properties: { node_type: 'Memory' } }] },
    })

    renderGraphView()

    await waitFor(() => {
      expect(screen.getByTestId('node-type-breakdown')).toBeInTheDocument()
    })
    expect(screen.getByTestId('node-type-row-Memory')).toHaveTextContent('50')
    expect(screen.getByTestId('node-type-row-Article')).toHaveTextContent('30')
    expect(screen.getByTestId('node-type-row-Tool')).toHaveTextContent('20')
    // And it says how much it is describing, so it reads as an aggregate.
    expect(screen.getByText(/3 types · 100 nodes/)).toBeInTheDocument()
  })

  it('says so when the breakdown is partial instead of rendering it as authoritative', async () => {
    mockGraphRoute({
      nodeTypes: {
        body: { ...mockGraphNodeTypes, degraded_graphs: ['__commons__'], partial: true },
      },
    })

    renderGraphView()

    await waitFor(() => {
      expect(screen.getByTestId('node-type-breakdown-partial')).toHaveTextContent('__commons__')
    })
  })

  it('says so when the TOTALS are partial (the field the schema used to strip)', async () => {
    mockGraphRoute({
      stats: {
        body: { ...mockGraphStats, degraded_graphs: ['__commons__'], partial: true },
      },
    })

    renderGraphView()

    await waitFor(() => {
      expect(screen.getByTestId('graph-stats-partial')).toBeInTheDocument()
    })
  })

  it('labels the canvas as a bounded sample of the whole graph', async () => {
    renderGraphView()

    await waitFor(() => {
      expect(screen.getByTestId('graph-sample-notice')).toHaveTextContent(
        `of ${String(mockGraphStats.total_nodes)} nodes`,
      )
    })
  })

  it('drills the canvas down to one type when a type is selected', async () => {
    mockGraphRoute({})
    renderGraphView()

    await waitFor(() => {
      expect(screen.getByTestId('node-type-row-Article')).toBeInTheDocument()
    })
    screen.getByTestId('node-type-row-Article').click()

    await waitFor(() => {
      const requested = vi
        .mocked(global.fetch)
        .mock.calls.map((call) => String(call[0]))
        .some((url) => url.includes('/graph/nodes?node_type=Article'))
      expect(requested).toBe(true)
    })
  })

  it('renders empty graph data gracefully', async () => {
    // Drive the real data path: an empty backend yields zeroed summary badges.
    vi.mocked(api).getGraphStats.mockResolvedValueOnce({
      total_nodes: 0,
      total_relationships: 0,
    })
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.includes('/graph/stats')
        ? { total_nodes: 0, total_relationships: 0 }
        : url.includes('/graph/node-types')
          ? { ...mockGraphNodeTypes, by_type: {}, type_count: 0, total_typed_nodes: 0 }
          : [] // nodes + relationships are empty arrays
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      } as unknown as Response)
    }) as unknown as typeof fetch

    renderGraphView()

    await waitFor(() => {
      expect(screen.getByText(/^Nodes:\s*0$/)).toBeInTheDocument()
      expect(screen.getByText(/^Edges:\s*0$/)).toBeInTheDocument()
    })
  })
})
