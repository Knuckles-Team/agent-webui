import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CodeGraphView from '@/components/views/CodeGraphView'
import { renderWithProviders } from '@/__tests__/fixtures'
import { api } from '@/lib/api'

// The Call Graph tab (CONCEPT:KG-2.214) calls api.getCodeMetrics and renders the
// god-node legend + the Sigma canvas. Spy on the api method and stub the on-mount
// instances fetch.

const METRICS = {
  status: 'ok',
  scope: null,
  nodes: 4,
  edges: 3,
  by_language: { python: 4 },
  by_relation: { calls: 3 },
  by_confidence: { EXTRACTED: 3 },
  god_nodes: [
    { id: 'config.py:settings', label: 'settings', file_path: 'config.py', degree: 3, community: 0 },
    { id: 'database.py:pool', label: 'pool', file_path: 'database.py', degree: 1, community: 1 },
  ],
  community_count: 2,
  communities: [{ id: 0, size: 2, members: ['settings', 'pool'] }],
  surprising_connections: [],
  graph: {
    nodes: [
      { id: 'config.py:settings', label: 'settings', file_path: 'config.py', degree: 3, community: 0 },
      { id: 'database.py:pool', label: 'pool', file_path: 'database.py', degree: 1, community: 1 },
    ],
    edges: [{ source: 'database.py:pool', target: 'config.py:settings', rel: 'depends_on' }],
    truncated: false,
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  // on-mount instances fetch (navigator tab)
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ source_systems: [] }),
      text: () => Promise.resolve('{}'),
    } as unknown as Response),
  ) as unknown as typeof fetch
  vi.spyOn(api, 'getCodeMetrics').mockResolvedValue(METRICS)
})

describe('Code Graph canvas tab (KG-2.214)', () => {
  it('renders the Call Graph tab trigger', async () => {
    renderWithProviders(<CodeGraphView />)
    expect(await screen.findByRole('tab', { name: /Call Graph/i })).toBeInTheDocument()
  })

  it('renders god nodes + summary after Render', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CodeGraphView />)
    await user.click(await screen.findByRole('tab', { name: /Call Graph/i }))
    // canvas panel mounted
    expect(await screen.findByText(/Code architecture canvas/i)).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: /Render/i }))

    await waitFor(() => {
      expect(api.getCodeMetrics).toHaveBeenCalled()
    })
    // god-node legend shows the hub symbol + its degree.
    expect(await screen.findByText('settings')).toBeInTheDocument()
    // summary badges reflect the payload.
    expect(await screen.findByText('2 communities')).toBeInTheDocument()
  })
})
