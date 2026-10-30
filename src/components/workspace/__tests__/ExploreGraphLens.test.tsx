// spec: OVERSTORY-APPS-R049.1.14
import { StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/__tests__/fixtures'
import { PageContextProvider, usePageContextEnvelope } from '@/lib/page-context'
import { api } from '@/lib/api'
import type { GraphNode } from '@/components/knowledge-graph/GraphAdapter'
import type { WebMcpToolDefinition } from '@/lib/webmcp/types'
import ExploreQueryWorkspace from '../ExploreQueryWorkspace'

const context = vi.hoisted(() => ({
  role: 'maintainer',
  owner: 'a',
  tools: new Map<string, WebMcpToolDefinition>(),
  canvasSelect: null as ((node: GraphNode | null) => void) | null,
}))
vi.mock('@/lib/auth', () => ({
  useIdentity: () => ({
    identity: { role: context.role, userKey: context.owner, needsSignIn: false, raw: { tenant: 'test' } },
    loading: false,
  }),
}))
vi.mock('@/lib/webmcp/provider', () => ({
  useWebMcpToolSet: (tools: WebMcpToolDefinition[]) => {
    for (const tool of tools) context.tools.set(tool.name, tool)
  },
}))
vi.mock('@/components/knowledge-graph/GraphCanvas', () => ({
  GraphCanvas: (props: {
    readOnly: boolean
    onUpdateNode?: unknown
    onSelectNode: (node: GraphNode | null) => void
  }) => {
    context.canvasSelect = props.onSelectNode
    return (
      <div data-testid="canvas-mode">
        {props.readOnly && !props.onUpdateNode ? 'Read-only canvas' : 'Editable canvas'}
      </div>
    )
  },
}))
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  api: {
    ontologySearch: vi.fn(async () => ({
      total: 2,
      objects: [
        { id: 'e1', title: 'Evidence one' },
        { id: 'e2', title: 'Evidence two' },
      ],
    })),
    getOntologyObject: vi.fn(async (id: string) => ({
      id,
      title: `Evidence ${id}`,
      properties: [],
      links: [
        {
          target_id: id === 'e1' ? 'e2' : 'e1',
          target_title: 'Neighbor evidence',
          direction: 'out',
          link_type: 'related',
        },
      ],
      history: [],
    })),
    runSparqlQuery: vi.fn(async () => ({
      status: 'success',
      head: { vars: ['value'] },
      results: { bindings: [{ value: { value: 'Retained answer' } }] },
    })),
    validateOntologyCandidate: vi.fn(),
  },
}))
const nodes = [
  { id: 'g1', labels: ['Person'], properties: { name: 'Node one', note: '<script>plain text</script>' } },
  { id: 'g2', labels: ['Person'], properties: { name: 'Node two' } },
]
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function graphResponse(path: string) {
  if (path.includes('/node-types'))
    return response({
      by_type: { Person: 2 },
      type_count: 1,
      total_typed_nodes: 2,
      truncated: false,
      available: true,
      source_graphs: ['test'],
      degraded_graphs: [],
      partial: false,
    })
  if (path.includes('/stats')) return response({ total_nodes: 50, total_relationships: 70, available: true })
  if (path.includes('/relationships'))
    return response([
      { source: 'g1', target: 'g2', type: 'knows' },
      { source: 'g1', target: 'outside', type: 'knows' },
    ])
  return response(nodes)
}
function Probe() {
  const value = usePageContextEnvelope()
  return <output aria-label="Published selection">{value.selection.map((item) => item.id).join(',')}</output>
}
let client: QueryClient
function surface() {
  return (
    <QueryClientProvider client={client}>
      <PageContextProvider route="/workspace/explore" view="workspace.explore-proof">
        <ExploreQueryWorkspace />
        <Probe />
      </PageContextProvider>
    </QueryClientProvider>
  )
}
beforeEach(() => {
  context.role = 'maintainer'
  context.owner = 'a'
  context.tools.clear()
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => graphResponse(path)),
  )
  window.history.replaceState({}, '', '/workspace/explore?q=retained&entity=e1&tool=history&lens=graph&graphNode=g1')
})
const invoke = (name: string, value: unknown = {}) =>
  context.tools.get(`overstory.explore.graph.${name}`)!.execute(value, { signal: new AbortController().signal })
function openAdvanced() {
  const summary = screen.getByText('Advanced')
  if (!summary.closest('details')!.open) fireEvent.click(summary)
}
async function ready() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh graph' })).toBeEnabled())
}

describe('native graph lens', () => {
  it('composes a read-only sample with accessible adjacency and independent inspector, without the old page shell', async () => {
    renderWithProviders(<StrictMode>{surface()}</StrictMode>)
    await ready()
    expect(screen.getByTestId('canvas-mode')).toHaveTextContent('Read-only canvas')
    expect(screen.queryByText('Unified Graph Workspace')).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Graph lens' })).getByRole('status')).toHaveTextContent(
      'bounded sample',
    )
    const inspector = screen.getByRole('region', { name: 'Graph inspector' })
    expect(inspector).toHaveTextContent('<script>plain text</script>')
    expect(inspector.querySelector('script')).toBeNull()
    fireEvent.click(
      within(screen.getByRole('list', { name: 'Sampled adjacency' })).getByRole('link', { name: 'Node two' }),
    )
    expect(window.location.search).toContain('graphNode=g2')
    expect(window.location.search).toContain('entity=e1&tool=history')
    expect(screen.getByLabelText('Published selection')).toHaveTextContent('g2')
    expect(screen.queryByRole('button', { name: /Add Node|Delete|Save/ })).not.toBeInTheDocument()
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
  })
  it('keeps the original canvas callback current across repeated selection without resetting its renderer', async () => {
    renderWithProviders(surface())
    await ready()
    const original = context.canvasSelect!
    act(() => {
      original(nodes[1])
    })
    expect(window.location.search).toContain('graphNode=g2')
    expect(context.canvasSelect).toBe(original)
    act(() => {
      original(nodes[0])
    })
    expect(window.location.search).toContain('graphNode=g1')
    openAdvanced()
    fireEvent.click(screen.getByRole('link', { name: 'Stored records' }))
    const before = window.location.href
    act(() => {
      original(nodes[1])
    })
    expect(window.location.href).toBe(before)
  })
  it('retains query results/drafts, evidence history and graph selection through neighbor and history navigation', async () => {
    renderWithProviders(surface())
    await ready()
    openAdvanced()
    fireEvent.click(screen.getByRole('link', { name: 'Query stored data (SPARQL)' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'SPARQL query' }), {
      target: { value: 'SELECT ?kept WHERE {}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run Query' }))
    await screen.findByText('Retained answer')
    openAdvanced()
    fireEvent.click(screen.getByRole('link', { name: 'Stored records' }))
    await screen.findByRole('heading', { name: 'Evidence e1' })
    fireEvent.click(screen.getByRole('button', { name: 'Related records' }))
    fireEvent.click(await screen.findByRole('button', { name: /Neighbor evidence/ }))
    await screen.findByRole('heading', { name: 'Evidence e2' })
    expect(window.location.search).toContain('graphNode=g1')
    const neighborHref = window.location.href
    fireEvent.click(screen.getByRole('button', { name: 'Change history' }))
    openAdvanced()
    fireEvent.click(screen.getByRole('link', { name: 'Query stored data (SPARQL)' }))
    expect(screen.getByRole('textbox', { name: 'SPARQL query' })).toHaveValue('SELECT ?kept WHERE {}')
    expect(screen.getByText('Retained answer')).toBeInTheDocument()
    act(() => {
      window.history.replaceState({}, '', neighborHref)
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await screen.findByRole('heading', { name: 'Evidence e2' })
    openAdvanced()
    fireEvent.click(screen.getByRole('link', { name: 'Sampled graph' }))
    await ready()
    expect(screen.getByRole('region', { name: 'Graph inspector' })).toHaveTextContent('Node one')
    expect(api.runSparqlQuery).toHaveBeenCalledTimes(1)
  })
  it('clears every old datum immediately on a denied refresh and ignores late sibling successes', async () => {
    renderWithProviders(surface())
    await ready()
    let finish!: (value: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string) =>
        path.includes('/nodes')
          ? Promise.resolve(response({ detail: 'denied' }, 403))
          : new Promise<Response>((resolve) => {
              finish = resolve
            }),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh graph' }))
    await screen.findByText(/Previously loaded graph data has been cleared/)
    expect(screen.queryByTestId('canvas-mode')).not.toBeInTheDocument()
    expect(screen.queryByText('Node one')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Published selection')).toBeEmptyDOMElement())
    await act(async () => {
      finish(graphResponse('/stats'))
    })
    expect(within(screen.getByRole('region', { name: 'Graph lens' })).getByRole('status')).toHaveTextContent(
      'Total nodes: unknown',
    )
  })
  it('fences type-refresh generations and retained tool handles including same-tick refresh', async () => {
    renderWithProviders(surface())
    await ready()
    const held = context.tools.get('overstory.explore.graph.select')!
    await act(async () => {
      await invoke('refresh')
      await expect(held.execute({ node: 'g2' }, { signal: new AbortController().signal })).rejects.toThrow('stale')
    })
    await ready()
    await expect(invoke('select', { node: 'not-loaded' })).rejects.toThrow('outside')
    const visible = context.tools.get('overstory.explore.graph.select')!
    openAdvanced()
    fireEvent.click(screen.getByRole('link', { name: 'Stored records' }))
    await expect(visible.execute({ node: 'g2' }, { signal: new AbortController().signal })).rejects.toThrow('stale')
  })
  it('withdraws a filtered sample and ignores a late response after returning to all types', async () => {
    renderWithProviders(surface())
    await ready()
    let obsolete!: (value: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string) =>
        path.includes('node_type=Person')
          ? new Promise<Response>((resolve) => {
              obsolete = resolve
            })
          : Promise.resolve(graphResponse(path)),
      ),
    )
    fireEvent.click(screen.getByTestId('node-type-row-Person'))
    expect(window.location.search).toContain('graphType=Person')
    expect(screen.queryByTestId('canvas-mode')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Published selection')).toBeEmptyDOMElement()
    fireEvent.click(await screen.findByRole('button', { name: 'All types' }))
    await ready()
    await act(async () => {
      obsolete(response([{ id: 'obsolete', labels: ['Person'], properties: { name: 'Obsolete graph response' } }]))
    })
    expect(screen.queryByText('Obsolete graph response')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Graph inspector' })).toHaveTextContent('Node one')
    expect(window.location.search).not.toContain('graphType')
  })
  it('retires graph data and callbacks when the owner changes during a pending read', async () => {
    let obsolete!: (value: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string) =>
        path.endsWith('/nodes')
          ? new Promise<Response>((resolve) => {
              obsolete = resolve
            })
          : Promise.resolve(graphResponse(path)),
      ),
    )
    const view = renderWithProviders(surface())
    const old = context.tools.get('overstory.explore.graph.select')!
    context.owner = 'b'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ detail: 'denied' }, 403)),
    )
    view.rerender(surface())
    await screen.findByText(/Previously loaded graph data has been cleared/)
    await act(async () => {
      obsolete(response(nodes))
    })
    expect(screen.queryByTestId('canvas-mode')).not.toBeInTheDocument()
    await expect(old.execute({ node: 'g1' }, { signal: new AbortController().signal })).rejects.toThrow('stale')
  })
  it('reports unavailable and partial aggregate provenance instead of silently showing an empty graph', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) =>
        path.includes('/stats')
          ? response({ total_nodes: 0, total_relationships: 0, available: false })
          : graphResponse(path),
      ),
    )
    renderWithProviders(surface())
    await ready()
    expect(screen.getByRole('alert')).toHaveTextContent('does not mean the sampled graph is empty')
    expect(screen.getByTestId('canvas-mode')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Graph lens' })).getByRole('status')).toHaveTextContent(
      'Total nodes: unknown',
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) =>
        path.includes('/stats')
          ? response({
              total_nodes: 3,
              total_relationships: 4,
              available: true,
              partial: true,
              degraded_graphs: ['missing partition'],
            })
          : graphResponse(path),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh graph' }))
    await ready()
    expect(screen.getByRole('alert')).toHaveTextContent('Partial totals exclude: missing partition')
  })
  it('keeps denied identities out and retires owner data and drafts', async () => {
    context.role = 'reader'
    const view = renderWithProviders(surface())
    expect(screen.getByRole('alert')).toHaveTextContent('not available')
    expect(fetch).not.toHaveBeenCalled()
    context.role = 'maintainer'
    view.rerender(surface())
    await ready()
    openAdvanced()
    fireEvent.click(screen.getByRole('link', { name: 'Query stored data (SPARQL)' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'SPARQL query' }), {
      target: { value: 'SELECT ?secret WHERE {}' },
    })
    context.owner = 'b'
    view.rerender(surface())
    expect(screen.getByRole('textbox', { name: 'SPARQL query' })).not.toHaveValue('SELECT ?secret WHERE {}')
  })
  it.each([
    { total_nodes: -1, total_relationships: 5 },
    { total_nodes: 2.5, total_relationships: 5 },
    { total_nodes: Number.MAX_VALUE, total_relationships: 5 },
  ])('rejects invalid totals rather than showing fabricated counts %j', async (stats) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => (path.includes('/stats') ? response(stats) : graphResponse(path))),
    )
    renderWithProviders(surface())
    await ready()
    expect(within(screen.getByRole('region', { name: 'Graph lens' })).getByRole('status')).toHaveTextContent(
      'Total nodes: unknown',
    )
    expect(screen.getByRole('alert')).toHaveTextContent('stats failed')
  })
  it('withdraws evidence cache during refresh, refuses a mismatched response and ignores an obsolete selected request', async () => {
    window.history.replaceState({}, '', '/workspace/explore?q=retained&entity=e1&lens=evidence&graphNode=g1')
    let old!: (value: Awaited<ReturnType<typeof api.getOntologyObject>>) => void
    vi.mocked(api.getOntologyObject).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          old = resolve
        }),
    )
    renderWithProviders(surface())
    fireEvent.click(await screen.findByRole('link', { name: /Evidence two/ }))
    await screen.findByRole('heading', { name: 'Evidence e2' })
    await act(async () => {
      old({
        id: 'e1',
        title: 'Obsolete private title',
        object_type: 'Note',
        derived: [],
        markings: [],
        properties: [],
        links: [],
        history: [],
      })
    })
    expect(screen.queryByText('Obsolete private title')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Published selection')).toHaveTextContent('e2')
    vi.mocked(api.getOntologyObject).mockResolvedValueOnce({
      id: 'other',
      title: 'Wrong owner object',
      object_type: 'Note',
      derived: [],
      markings: [],
      properties: [],
      links: [],
      history: [],
    })
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['explore-workspace-object'] })
    })
    expect(screen.queryByText('Wrong owner object')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Published selection')).toBeEmptyDOMElement())
  })
})
