import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import DefaultOverviewPanel from '@/components/views/DefaultOverviewPanel'

/** Route-aware fetch mock: pattern → { status, body } (body is the raw gateway envelope). */
function mockFetch(map: Record<string, { status?: number; body?: unknown }>) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    for (const [pattern, spec] of Object.entries(map)) {
      if (url.includes(pattern)) {
        const status = spec.status ?? 200
        return Promise.resolve({
          ok: status >= 200 && status < 300,
          status,
          json: () => Promise.resolve(spec.body ?? {}),
          text: () => Promise.resolve(''),
        }) as unknown as Promise<Response>
      }
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('not mocked'),
    }) as unknown as Promise<Response>
  })
}

describe('DefaultOverviewPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders real counts from every backing surface when all succeed', async () => {
    global.fetch = mockFetch({
      // W-10: the "System Prompts" tile reads the SAME store as the Prompts
      // Registry (`/api/enhanced/prompts`), not the separate KG-backed
      // `/api/enhanced/prompts/graph` collection.
      '/api/enhanced/prompts': { body: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] },
      '/api/enhanced/tools': {
        body: {
          mcp_tools: [{ name: 'x' }],
          builtin_tools: [{ name: 'y' }, { name: 'z' }, { name: 'w' }, { name: 'v' }],
          skills: [],
          skill_graphs: [],
          skill_workflows: [],
        },
      },
      '/api/enhanced/llm/models': { body: [{ id: 'gpt' }, { id: 'claude' }] },
      '/api/enhanced/graph/stats': { body: { total_nodes: 43579, total_relationships: 91000, by_type: {} } },
      // `checks` is an ARRAY of HealthCheck objects (the real
      // `agent_utilities.observability.runtime_health.HealthReport` shape,
      // W-12) — not a `name -> status` map.
      '/api/dashboard/health': {
        body: {
          status: 'ok',
          checks: [
            { name: 'engine', status: 'ok' },
            { name: 'kg', status: 'ok' },
          ],
        },
      },
    }) as unknown as typeof fetch

    render(<DefaultOverviewPanel />)

    await waitFor(() => {
      expect(screen.getByText('43,579')).toBeInTheDocument() // KG nodes
    })
    expect(screen.getByText('3')).toBeInTheDocument() // prompts
    expect(screen.getByText('5')).toBeInTheDocument() // 1 mcp + 4 builtin
    expect(screen.getByText('2')).toBeInTheDocument() // models
    expect(screen.getByText('ok')).toBeInTheDocument() // health status
    // No "unavailable" badge anywhere when every surface succeeded.
    expect(screen.queryByText('unavailable')).not.toBeInTheDocument()
  })

  it('marks a tile unavailable — never a fabricated zero — when its backend call fails', async () => {
    global.fetch = mockFetch({
      '/api/enhanced/prompts': { body: [] },
      '/api/enhanced/tools': {
        body: { mcp_tools: [], builtin_tools: [], skills: [], skill_graphs: [], skill_workflows: [] },
      },
      '/api/enhanced/llm/models': { body: [] },
      '/api/enhanced/graph/stats': { status: 503 }, // D-W6-10: a real backend failure
      '/api/dashboard/health': { body: { status: 'degraded', checks: [] } },
    }) as unknown as typeof fetch

    render(<DefaultOverviewPanel />)

    await waitFor(() => {
      expect(screen.getByText('unavailable')).toBeInTheDocument()
    })
    // The KG tile shows the unavailable badge, not a "0" that would be
    // indistinguishable from a genuinely empty graph.
    expect(screen.getAllByText('unavailable')).toHaveLength(1)
  })
})
