import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import OpsPanelView from '@/components/views/OpsPanelView'

const samplePipeline = {
  status: 'idle',
  phases: [
    {
      name: 'scan',
      state: 'done',
      last_run: '2026-01-01T00:00:00Z',
      progress: 1.0,
    },
  ],
}

const sampleMaintenance = {
  status: 'healthy',
  operations: [
    {
      name: 'prune',
      last_run: '2026-01-02T00:00:00Z',
      items_pruned: 14,
      items_updated: 0,
    },
  ],
}

const sampleResources = [
  {
    id: 'resource-1',
    type: 'MCP_TOOL',
    name: 'search_web',
    description: 'Query the web for info.',
  },
]

function mockFetchByUrl(map: Record<string, unknown>) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    for (const [pattern, body] of Object.entries(map)) {
      if (url.includes(pattern)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(body),
          text: () => Promise.resolve(''),
        }) as unknown as Promise<Response>
      }
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
    }) as unknown as Promise<Response>
  })
}

describe('OpsPanelView Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    global.fetch = mockFetchByUrl({
      '/api/enhanced/pipeline/status': samplePipeline,
      '/api/enhanced/maintenance/status': sampleMaintenance,
      '/api/enhanced/resources': sampleResources,
    }) as unknown as typeof fetch
  })

  it('renders the three admin tabs', async () => {
    render(<OpsPanelView />)

    expect(screen.getByRole('tab', { name: /pipeline/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /maintenance/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /resources/i })).toBeInTheDocument()
  })

  it('loads pipeline status on mount', async () => {
    render(<OpsPanelView />)

    await waitFor(() => {
      expect(screen.getByText('scan')).toBeInTheDocument()
    })
  })

  it('triggers the full pipeline via "Run All"', async () => {
    const fetchSpy = global.fetch as unknown as ReturnType<typeof vi.fn>
    render(<OpsPanelView />)

    await waitFor(() => {
      expect(screen.getByText(/run all/i)).toBeInTheDocument()
    })

    screen.getByRole('button', { name: /run all/i }).click()

    await waitFor(() => {
      const triggered = fetchSpy.mock.calls.some((call) => {
        const [url, init] = call as [string, RequestInit?]
        return url.includes('/pipeline/trigger') && init?.method === 'POST'
      })
      expect(triggered).toBe(true)
    })
  })
})
