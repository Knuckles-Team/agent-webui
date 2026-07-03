import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import AdminView from '@/components/views/AdminView'
import { renderWithProviders } from '@/__tests__/fixtures'

const sampleStats = {
  total_nodes: 4200,
  total_relationships: 8800,
  by_type: { Memory: 50, Article: 30 },
}

const sampleShards = {
  mode: 'sharded',
  default_graph: '__commons__',
  endpoints: [
    { endpoint: 'ipc:///run/eg.sock', local: true, reachable: true, breaker: 'closed' },
    { endpoint: 'tcp://shard-2:9701', local: false, reachable: false, breaker: 'open' },
  ],
}

const sampleDaemon = { role: 'host', running: true, queue_depth: 3 }
const sampleCodeInstances = { source_systems: ['gitlab/agent-packages', 'gitlab/services'] }

/**
 * Mock `fetch` keyed by URL substring, returning the canonical `{status,result}`
 * envelope for the gateway routes and bare JSON for the enhanced/dashboard
 * routes — matching how the real backend answers each surface.
 */
function mockFetchByUrl(map: Record<string, { body: unknown; status?: number; wrap?: boolean }>) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    for (const [pattern, cfg] of Object.entries(map)) {
      if (url.includes(pattern)) {
        const payload = cfg.wrap ? { status: 'ok', result: cfg.body } : cfg.body
        return Promise.resolve({
          ok: (cfg.status ?? 200) < 400,
          status: cfg.status ?? 200,
          json: () => Promise.resolve(payload),
          text: () => Promise.resolve(''),
        }) as unknown as Promise<Response>
      }
    }
    // Unknown routes → 404 so the gateway helper resolves `unavailable` (mirrors
    // the RBAC / backup probe degrading to the read-only placeholder).
    return Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('not found'),
    }) as unknown as Promise<Response>
  })
}

describe('AdminView Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    global.fetch = mockFetchByUrl({
      '/api/enhanced/graph/stats': { body: sampleStats },
      '/api/dashboard/daemon/shards': { body: sampleShards },
      '/api/dashboard/daemon/status': { body: sampleDaemon },
      '/api/enhanced/code/instances': { body: sampleCodeInstances },
      // /api/graph/configure (rbac_list / backup_status) intentionally 404 →
      // placeholder path.
    }) as unknown as typeof fetch
  })

  it('renders the four admin tabs', () => {
    renderWithProviders(<AdminView />)

    expect(screen.getByRole('tab', { name: /tenants/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /shards/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /rbac/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /backup/i })).toBeInTheDocument()
  })

  it('loads real tenant stats + indexed source tenants on mount', async () => {
    renderWithProviders(<AdminView />)

    await waitFor(() => {
      // total_nodes 4200 formatted as "4.2k" by the panel's fmt().
      expect(screen.getByText('4.2k')).toBeInTheDocument()
    })
    // Active graph name + an indexed source tenant.
    expect(screen.getByText('__commons__')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('gitlab/agent-packages')).toBeInTheDocument()
    })
  })

  it('shows shard topology + per-shard health when the Shards tab is opened', async () => {
    const { user } = renderWithProviders(<AdminView />)

    await user.click(screen.getByRole('tab', { name: /shards/i }))

    await waitFor(() => {
      expect(screen.getByTestId('admin-shards-panel')).toBeInTheDocument()
      expect(screen.getByText('ipc:///run/eg.sock')).toBeInTheDocument()
    })
    // Reachability derived from the mocked topology: 1 of 2 shards up.
    expect(screen.getByText('1/2')).toBeInTheDocument()
    expect(screen.getByText('tcp://shard-2:9701')).toBeInTheDocument()
  })

  it('degrades RBAC to a read-only placeholder when the REST twin is not wired', async () => {
    const { user } = renderWithProviders(<AdminView />)

    await user.click(screen.getByRole('tab', { name: /rbac/i }))

    await waitFor(() => {
      expect(screen.getByText(/not exposed over REST yet/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/read-only · not wired/i)).toBeInTheDocument()
  })
})
