import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import GraphView from '@/components/views/GraphView'
import { api } from '@/lib/api'
import { PageContextProvider } from '@/lib/page-context'
import { renderWithProviders, mockGraphStats, mockGraphNodes, mockGraphRelationships } from '@/__tests__/fixtures'

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

  it('renders empty graph data gracefully', async () => {
    // Drive the real data path: an empty backend yields zeroed summary badges.
    vi.mocked(api).getGraphStats.mockResolvedValueOnce({
      total_nodes: 0,
      total_relationships: 0,
      by_type: {},
    })
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.includes('/graph/stats') ? { total_nodes: 0, total_relationships: 0, by_type: {} } : [] // nodes + relationships are empty arrays
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
