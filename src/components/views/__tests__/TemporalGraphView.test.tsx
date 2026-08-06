import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import TemporalGraphView, { withAsOf, computeExpiredEdges } from '@/components/views/TemporalGraphView'
import { PageContextProvider } from '@/lib/page-context'
import { renderWithProviders } from '@/__tests__/fixtures'

// D-WUI-6 (pre-existing, distinct from the hostile-payload update also filed
// under this id) — see GraphView.test.tsx's identical helper for the full
// rationale: usePageContextPublisher throws without a PageContextProvider
// ancestor, which neither render call here supplied.
function renderTemporalGraphView() {
  return renderWithProviders(
    <PageContextProvider route="/temporal-graph" view="temporalgraph">
      <TemporalGraphView />
    </PageContextProvider>,
  )
}

describe('TemporalGraphView helpers', () => {
  it('withAsOf appends the bi-temporal operator', () => {
    expect(withAsOf('MATCH (n) RETURN n', '2026-06-01T00:00:00.000Z')).toBe(
      'MATCH (n) RETURN n |> AS OF @2026-06-01T00:00:00.000Z',
    )
  })

  it('computeExpiredEdges greys edges absent from the live AS OF result', () => {
    const all = [
      { source: 'a', type: 'R', target: 'b' },
      { source: 'b', type: 'R', target: 'c' },
    ]
    // Only a->b is live at ts; b->c is expired.
    const live = [{ source: 'a', target: 'b' }]
    const expired = computeExpiredEdges(all, live, '2026-06-01T00:00:00.000Z')
    expect(expired.has('a|b')).toBe(false)
    expect(expired.has('b|c')).toBe(true)
    expect(expired.size).toBe(1)
  })

  it('computeExpiredEdges honors an explicit valid_until <= ts', () => {
    const all = [{ source: 'a', type: 'R', target: 'b' }]
    const live = [{ source: 'a', target: 'b', valid_until: '2026-05-01T00:00:00.000Z' }]
    const expired = computeExpiredEdges(all, live, '2026-06-01T00:00:00.000Z')
    expect(expired.has('a|b')).toBe(true)
  })
})

describe('TemporalGraphView component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the temporal scrubber header and slider', async () => {
    renderTemporalGraphView()
    await waitFor(() => {
      expect(screen.getByText('Temporal Graph')).toBeInTheDocument()
      expect(screen.getByRole('slider', { name: 'temporal-scrubber' })).toBeInTheDocument()
    })
  })

  it('appends |> AS OF @<ts> to the graph query when scrubbed', async () => {
    const bodies: string[] = []
    // Override the default shim to capture the POST body to /graph/query while
    // still answering the nodes/relationships loads with non-empty fixtures.
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/graph/query')) {
        bodies.push(String(init?.body ?? ''))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ source: 'node1', target: 'node2' }]),
          text: () => Promise.resolve('[]'),
        } as unknown as Response)
      }
      const body = url.includes('/graph/nodes')
        ? [
            { id: 'node1', labels: ['Memory'], properties: { name: 'n1' } },
            { id: 'node2', labels: ['Article'], properties: { name: 'n2' } },
          ]
        : url.includes('/graph/relationships')
          ? [
              { source: 'node1', type: 'R', target: 'node2' },
              { source: 'node2', type: 'R', target: 'node3' },
            ]
          : []
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      } as unknown as Response)
    }) as unknown as typeof fetch

    renderTemporalGraphView()

    const slider = await screen.findByRole('slider', { name: 'temporal-scrubber' })
    // Move the scrubber back in time; this re-issues the AS OF query.
    fireEvent.change(slider, { target: { value: '50' } })

    await waitFor(() => {
      expect(bodies.some((b) => b.includes('|> AS OF @'))).toBe(true)
    })

    // Edge node2->node3 is not in the live AS OF result, so it is expired.
    await waitFor(() => {
      expect(screen.getByText(/^Expired:\s*1$/)).toBeInTheDocument()
    })
  })
})
