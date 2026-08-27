import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import CodeGraphView from '@/components/views/CodeGraphView'
import { renderWithProviders } from '@/__tests__/fixtures'

// CodeGraphView (CONCEPT:KG-2.9g) fetches /api/enhanced/code/instances on mount
// and POSTs /api/enhanced/code/nav per action. Drive both via a fetch shim.
function mockFetch(navResults: Record<string, unknown>[]) {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    const body = url.includes('/code/instances')
      ? { source_systems: ['gitlab:gitlab.example'] }
      : { action: 'find_definition', results: navResults, count: navResults.length }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response)
  }) as unknown as typeof fetch
}

describe('CodeGraphView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch([])
  })

  it('renders the navigator header and action buttons', async () => {
    renderWithProviders(<CodeGraphView />)
    expect(screen.getByText('Code Graph Navigator')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Definition/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /References/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Call graph/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Impact/i })).toBeInTheDocument()
  })

  it('loads the configured source systems into the selector', async () => {
    renderWithProviders(<CodeGraphView />)
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'gitlab:gitlab.example' })).toBeInTheDocument()
    })
  })

  it('runs an action and renders resolved symbol rows', async () => {
    mockFetch([
      {
        id: 'gitlab:gitlab.example:35:symbol:abc',
        name: 'NewAnalyzer',
        file_path: 'analyzer.go',
        line: 12,
        language: 'go',
      },
    ])
    const { user } = renderWithProviders(<CodeGraphView />)

    await user.type(screen.getByPlaceholderText(/Symbol name/i), 'NewAnalyzer')
    await user.click(screen.getByRole('button', { name: /Definition/i }))

    await waitFor(() => {
      expect(screen.getByText('NewAnalyzer')).toBeInTheDocument()
      expect(screen.getByText('analyzer.go')).toBeInTheDocument()
    })
  })
})
