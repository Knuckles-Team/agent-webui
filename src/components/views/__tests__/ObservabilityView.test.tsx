import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import ObservabilityView from '@/components/views/ObservabilityView'
import { renderWithProviders } from '@/__tests__/fixtures'

/**
 * @file ObservabilityView.test.tsx
 * @description Phase D coverage: `runs` is not a separate `/api/runs` platform
 * (that dead surface — `CapabilityWorkbench`/`RunInspector`/`capabilities-api.ts`
 * — was removed) — it is rendered here, in the existing Observability tab, from
 * the canonical `POST /graph/traces` route (`graph_traces`,
 * CONCEPT:AU-KG.coordination.engine-message-broker). Every KG-native trace IS
 * one chat/agent-graph execution run; `action='waterfall'` returns that run's
 * flattened Span/Generation nodes with a `parentId` per node, which is the DAG.
 *
 * These tests pin:
 *   1. A real `action='search'` shape renders as a run list, and selecting one
 *      (the first is auto-selected) renders its DAG with real parent→child
 *      nesting (not just a flat event list).
 *   2. A 404/501 (route not activated) renders the "capability not activated"
 *      notice — distinct from a genuinely empty run list.
 *   3. A 200 with an empty result renders "No runs found" — never a blank
 *      panel indistinguishable from #2 or from a still-loading panel.
 */

const PROMQL_OK_BODY = { status: 'success', result: { surface: 'promql', action: 'instant', result: [] } }

function tracesSearchBody(rows: unknown[]) {
  return { status: 'success', result: { surface: 'traces', action: 'search', result: rows } }
}

function tracesWaterfallBody(result: unknown) {
  return { status: 'success', result: { surface: 'traces', action: 'waterfall', result } }
}

interface MockOptions {
  searchStatus?: number
  searchBody?: unknown
  waterfallBody?: unknown
}

function mockGatewayFetch({ searchStatus = 200, searchBody, waterfallBody }: MockOptions) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const respond = (body: unknown, status = 200) =>
        Promise.resolve({
          ok: status < 300,
          status,
          json: () => Promise.resolve(body),
          text: () => Promise.resolve(JSON.stringify(body)),
          headers: { get: () => 'application/json' },
        } as unknown as Response)

      if (url.includes('/promql')) return respond(PROMQL_OK_BODY)

      if (url.includes('/traces')) {
        const parsedBody: Record<string, unknown> = init?.body ? (JSON.parse(String(init.body)) as never) : {}
        if (parsedBody.action === 'waterfall') {
          return respond(waterfallBody ?? tracesWaterfallBody({ trace: {}, nodes: [] }))
        }
        return respond(searchBody ?? tracesSearchBody([]), searchStatus)
      }

      return respond({}, 404)
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ObservabilityView — Runs (Phase D: no /api/runs platform)', () => {
  it('renders a run list from graph_traces action=search and its execution DAG with real parent/child nesting', async () => {
    mockGatewayFetch({
      searchBody: tracesSearchBody([{ trace_id: 'trace-1', name: 'Chat run: fix the widget', status: 'ok', duration: 512 }]),
      waterfallBody: tracesWaterfallBody({
        // Deliberately a different display string than the run-list row's `name`
        // above, so the two panels' independent renders of "this run's name" are
        // distinguishable in the DOM instead of colliding on the same text.
        trace: { id: 'trace-1', name: 'trace-1 waterfall', status: 'ok', latencyMs: 512, toolCalls: 1 },
        nodes: [
          { id: 'span-1', parentId: 'trace-1', kind: 'span', name: 'agent_graph_execute', latencyMs: 512 },
          {
            id: 'gen-1',
            parentId: 'span-1',
            kind: 'generation',
            name: 'llm_call',
            latencyMs: 300,
            model: 'gpt-x',
            costUsd: 0.02,
          },
        ],
      }),
    })

    const { user } = renderWithProviders(<ObservabilityView />)

    await user.click(await screen.findByRole('tab', { name: /Runs/i }))
    expect(await screen.findByText('Chat run: fix the widget')).toBeInTheDocument()

    // The DAG auto-loads for the first (auto-selected) run.
    const rootRow = (await screen.findByText('agent_graph_execute')).closest('li')
    expect(rootRow).not.toBeNull()
    // The generation node is a genuine descendant of the span node's <li> —
    // i.e. rendered nested under it, not as a sibling in a flat list.
    expect(within(rootRow as HTMLElement).getByText('llm_call')).toBeInTheDocument()
  })

  it('shows the capability-not-activated notice (not "no runs") when the route 404s', async () => {
    mockGatewayFetch({ searchStatus: 404, searchBody: {} })

    const { user } = renderWithProviders(<ObservabilityView />)
    await user.click(await screen.findByRole('tab', { name: /Runs/i }))

    expect(await screen.findByText(/not activated on this backend/i)).toBeInTheDocument()
    expect(screen.queryByTestId('observability-runs-empty')).not.toBeInTheDocument()
  })

  it('shows "No runs found" (not the capability notice) when the route answers with zero runs', async () => {
    mockGatewayFetch({ searchBody: tracesSearchBody([]) })

    const { user } = renderWithProviders(<ObservabilityView />)
    await user.click(await screen.findByRole('tab', { name: /Runs/i }))

    expect(await screen.findByTestId('observability-runs-empty')).toHaveTextContent(/no runs found/i)
    expect(screen.queryByText(/not activated on this backend/i)).not.toBeInTheDocument()
  })
})
