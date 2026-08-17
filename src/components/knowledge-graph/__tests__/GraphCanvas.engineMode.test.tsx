import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { GraphCanvas } from '@/components/knowledge-graph/GraphCanvas'
import { GRAPH_ENGINE_RENDER_NODE_THRESHOLD } from '@/components/knowledge-graph/engineGraphRender'
import type { GraphNode } from '@/components/knowledge-graph/GraphAdapter'

// Covers the dual-mode renderer seam added for the GOC-88 KG-view adoption:
// GraphCanvas stays sigma-interactive by default, recommends (never silently
// switches to) the engine's at-scale node-position preview above
// GRAPH_ENGINE_RENDER_NODE_THRESHOLD, exposes a manual override, and — since
// the engine's Graph-mark render surface cannot yet accept caller-supplied
// edges (see engineGraphRender.ts) — never renders that preview as if it were
// a complete graph: three honest, visually distinct states (route
// unavailable / no data / error) plus an explicitly-captioned success image.

function makeNodes(n: number): GraphNode[] {
  return Array.from({ length: n }, (_, i) => ({ id: `n${String(i)}`, labels: ['Test'], properties: {} }))
}

const noop = () => {
  /* no-op */
}

function renderCanvas(nodes: GraphNode[]) {
  return render(
    <GraphCanvas
      nodes={nodes}
      relationships={[]}
      onUpdateNode={noop}
      onDeleteNode={noop}
      onAddNode={noop}
      onSelectNode={noop}
    />,
  )
}

/** Build a `graph_viz(action='export_chart')` REST response body matching the
 * REAL `{surface, action, result: {...}}` envelope (no `status` key — see
 * `agent_utilities/mcp/tools/engine_surface_tools.py::_render_chart`), so
 * `gateway.ts`'s envelope unwrap does NOT strip an extra layer. */
function vizResultBody(result: Record<string, unknown>) {
  return { surface: 'viz', action: 'export_chart', result }
}

function mockFetchOnce(res: { ok: boolean; status: number; body?: unknown; text?: string }) {
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: res.ok,
      status: res.status,
      json: () => Promise.resolve(res.body ?? {}),
      text: () => Promise.resolve(res.text ?? ''),
    } as unknown as Response),
  ) as unknown as typeof fetch
}

describe('GraphCanvas renderer-mode seam', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('defaults to interactive mode for a small graph and never shows the preview action', () => {
    renderCanvas(makeNodes(5))
    expect(screen.getByTestId('graph-render-mode-badge')).toHaveTextContent('Interactive (sigma)')
    expect(screen.queryByTestId('graph-engine-preview-run')).not.toBeInTheDocument()
  })

  it('recommends at-scale engine mode above the node threshold without auto-calling the engine', () => {
    renderCanvas(makeNodes(GRAPH_ENGINE_RENDER_NODE_THRESHOLD + 1))
    expect(screen.getByTestId('graph-render-mode-badge')).toHaveTextContent('At-scale (engine)')
    // Honest-states rule: a large graph never triggers an engine call on
    // mount — rendering a nodes-only image by default would read as a
    // complete graph. The preview stays an explicit user action.
    expect(screen.getByTestId('graph-engine-preview-run')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('lets the user manually override the recommended mode, and labels it manual', () => {
    // Deliberately a SMALL graph here (not one above the threshold): forcing
    // *interactive* mode on a huge graph legitimately runs a 150-iteration
    // forceAtlas2 layout over thousands of disconnected nodes — exactly the
    // client-side cost this seam exists to avoid by default — so exercising
    // the override in the opposite direction (small graph -> forced
    // engine-preview) proves the same toggle logic without paying that cost
    // in a unit test.
    renderCanvas(makeNodes(5))
    fireEvent.click(screen.getByTestId('graph-render-mode-toggle'))
    const badge = screen.getByTestId('graph-render-mode-badge')
    expect(badge).toHaveTextContent('At-scale (engine)')
    expect(badge).toHaveTextContent('manual')
    expect(screen.getByTestId('graph-engine-preview-run')).toBeInTheDocument()
  })

  it('shows the route-unavailable honest state distinctly (HTTP 404)', async () => {
    mockFetchOnce({ ok: false, status: 404 })
    renderCanvas(makeNodes(GRAPH_ENGINE_RENDER_NODE_THRESHOLD + 1))
    fireEvent.click(screen.getByTestId('graph-engine-preview-run'))
    await waitFor(() => {
      expect(screen.getByTestId('graph-engine-preview-unavailable')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('graph-engine-preview-error')).not.toBeInTheDocument()
    expect(screen.queryByTestId('graph-engine-preview-no-data')).not.toBeInTheDocument()
  })

  it('shows the no-data honest state distinctly on a zero-row render — never a blank image', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      body: vizResultBody({
        // A real zero-row render still comes back as a small-but-nonempty
        // valid PNG (an empty canvas, not zero bytes) — `row_count: 0` in
        // `view_result` is the actual no-data signal, not an empty `bytes`
        // field (which `adaptVizResult` would instead treat as "no
        // recognisable image" / an error, matching real backend behaviour).
        bytes: { __bytes_b64__: 'Zm9v' },
        content_type: 'image/png',
        format: 'png',
        view_result: { row_count: 0, exact: true, lod_tier: 'direct' },
      }),
    })
    renderCanvas(makeNodes(GRAPH_ENGINE_RENDER_NODE_THRESHOLD + 1))
    fireEvent.click(screen.getByTestId('graph-engine-preview-run'))
    await waitFor(() => {
      expect(screen.getByTestId('graph-engine-preview-no-data')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('graph-engine-preview-image')).not.toBeInTheDocument()
  })

  it('shows the error honest state distinctly (HTTP 500)', async () => {
    mockFetchOnce({ ok: false, status: 500, text: 'boom' })
    renderCanvas(makeNodes(GRAPH_ENGINE_RENDER_NODE_THRESHOLD + 1))
    fireEvent.click(screen.getByTestId('graph-engine-preview-run'))
    await waitFor(() => {
      expect(screen.getByTestId('graph-engine-preview-error')).toBeInTheDocument()
    })
  })

  it('renders the engine preview image on success, captioned as nodes-only', async () => {
    const rowCount = GRAPH_ENGINE_RENDER_NODE_THRESHOLD + 1
    mockFetchOnce({
      ok: true,
      status: 200,
      body: vizResultBody({
        bytes: { __bytes_b64__: 'Zm9v' },
        content_type: 'image/png',
        format: 'png',
        view_result: { row_count: rowCount, exact: true, lod_tier: 'density' },
      }),
    })
    renderCanvas(makeNodes(rowCount))
    fireEvent.click(screen.getByTestId('graph-engine-preview-run'))
    await waitFor(() => {
      expect(screen.getByTestId('graph-engine-preview-image')).toBeInTheDocument()
    })
    expect(screen.getByText(/edges omitted/i)).toBeInTheDocument()
  })
})
