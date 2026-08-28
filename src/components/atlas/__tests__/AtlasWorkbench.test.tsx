/**
 * The `/explore` workbench, wired to the real adapters over a stubbed transport.
 *
 * The load-bearing assertions here are the two "honest degradation" ones: the 3D
 * button is ENABLED for a modality whose result projects into a graph and DISABLED
 * with the adapter's own reason for one that does not. That is the whole design claim
 * — "3D for any modality that can project" — checked without a GPU.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { AtlasWorkbench } from '../AtlasWorkbench'

const graph3dBody = {
  nodes: [
    { id: 'n1', type: 'Service', name: 'alpha' },
    { id: 'n2', type: 'Host', name: 'beta' },
  ],
  edges: [{ s: 0, t: 1, r: 'RUNS_ON', w: 1 }],
  total_nodes: 2,
  total_relationships: 1,
  engine_total_nodes: 2,
  engine_total_relationships: 1,
  connected_nodes: 2,
  isolated_nodes: 0,
  truncated: false,
  source_graphs: ['__commons__'],
  degraded_graphs: [],
  available: true,
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

/** Route the two adapters' endpoints to fixtures; anything else is an explicit failure. */
function stubBackend(): void {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('node-types')) return Promise.resolve(jsonResponse({ by_type: { Service: 1 }, available: true }))
    if (url.includes('graph3d')) return Promise.resolve(jsonResponse(graph3dBody))
    if (url.includes('/api/sparql')) {
      return Promise.resolve(
        jsonResponse({
          status: 'success',
          head: { vars: ['a', 'b'] },
          results: { bindings: [{ a: { value: '1' }, b: { value: '2' } }] },
        }),
      )
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  }) as typeof fetch
}

function renderWorkbench() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AtlasWorkbench />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  stubBackend()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AtlasWorkbench', () => {
  it('offers every discovered modality', async () => {
    renderWorkbench()
    const picker = await screen.findByTestId('atlas-modality-picker')
    expect(within(picker).getByTestId('atlas-modality-graph')).toBeInTheDocument()
    expect(within(picker).getByTestId('atlas-modality-sparql')).toBeInTheDocument()
  })

  it('shows the compiled query read-only for a modality with no query language', async () => {
    renderWorkbench()
    const box = (await screen.findByLabelText('Query')) as HTMLTextAreaElement
    expect(box).toHaveAttribute('readonly')
    expect(box.value).toContain('nodes')
  })

  /** Run, then switch to the table — a graph-shaped result auto-selects the 2D canvas. */
  async function runAndTabulate(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
    await user.click(await screen.findByTestId('atlas-run'))
    await user.click(await screen.findByTestId('atlas-renderer-table'))
    return screen.findByTestId('atlas-table')
  }

  it('auto-selects the graph renderer for a graph-shaped result', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await user.click(await screen.findByTestId('atlas-run'))
    await waitFor(() => {
      expect(screen.getByTestId('atlas-renderer-graph2d')).toHaveAttribute('data-state', 'selected')
    })
  })

  it('runs a query and tabulates the result', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    const table = await runAndTabulate(user)
    expect(within(table).getByText('alpha')).toBeInTheDocument()
    expect(within(table).getByText('beta')).toBeInTheDocument()
  })

  it('enables the 2D and 3D renderers for a result that projects into a graph', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await runAndTabulate(user)
    expect(screen.getByTestId('atlas-renderer-graph3d')).toBeEnabled()
    expect(screen.getByTestId('atlas-renderer-graph2d')).toBeEnabled()
  })

  it('disables them, with the reason, for a result that does not', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await user.click(await screen.findByTestId('atlas-modality-sparql'))
    await user.click(await screen.findByTestId('atlas-run'))
    await screen.findByTestId('atlas-table')
    const graph3d = screen.getByTestId('atlas-renderer-graph3d')
    expect(graph3d).toBeDisabled()
    expect(graph3d).toHaveAttribute('title', expect.stringContaining('triple-shaped') as unknown as string)
  })

  it('gives the SPARQL modality an editable console', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await user.click(await screen.findByTestId('atlas-modality-sparql'))
    await waitFor(() => {
      expect(screen.getByLabelText('Query')).not.toHaveAttribute('readonly')
    })
  })

  it('publishes the client-side-filtering disclosure for the graph modality', async () => {
    renderWorkbench()
    expect(await screen.findByTestId('atlas-filter-note')).toHaveTextContent('applied in the browser')
  })

  it('inspects a row selected in the table', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    const table = await runAndTabulate(user)
    await user.click(within(table).getByText('alpha'))
    const inspector = await screen.findByTestId('atlas-inspector')
    // The row's label heads the panel and its id and type appear in the property list.
    expect(within(inspector).getAllByText('n1').length).toBeGreaterThan(0)
    expect(within(inspector).getAllByText('Service').length).toBeGreaterThan(0)
    expect(within(inspector).getByText('degree')).toBeInTheDocument()
  })

  it('states the union read rather than silently pinning a tenant graph', async () => {
    renderWorkbench()
    expect(await screen.findByText(/union read/)).toBeInTheDocument()
  })
})
