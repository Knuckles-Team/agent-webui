import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import MemoryView from '@/components/views/MemoryView'
import { api } from '@/lib/api'
import { renderWithProviders, mockMemoryNode } from '@/__tests__/fixtures'

// Mock API calls. The component imports the `api` instance from '@/lib/api',
// so the factory must expose an `api` object carrying the spied methods.
vi.mock('@/lib/api', () => ({
  api: {
    getGraphNodes: vi.fn(() => Promise.resolve([mockMemoryNode])),
    addMemory: vi.fn(() => Promise.resolve({ status: 'success', id: 'mem_test' })),
    updateMemory: vi.fn(() => Promise.resolve({ status: 'success' })),
    deleteMemory: vi.fn(() => Promise.resolve({ status: 'success' })),
  },
}))

describe('MemoryView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders memory list correctly', async () => {
    renderWithProviders(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByText('Memory Management')).toBeInTheDocument()
    })
  })

  it('displays create memory dialog', async () => {
    const { user } = renderWithProviders(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByText('Add Memory')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Add Memory'))

    await waitFor(() => {
      expect(screen.getByText('Create New Memory')).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/memory content/i)).toBeInTheDocument()
    })
  })

  it('handles memory creation', async () => {
    const { user } = renderWithProviders(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByText('Add Memory')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Add Memory'))

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/memory content/i)).toBeInTheDocument()
    })

    // Fill form
    const contentInput = screen.getByPlaceholderText(/memory content/i)
    await user.type(contentInput, 'Test memory content')

    await user.click(screen.getByRole('button', { name: /create memory/i }))

    await waitFor(() => {
      expect(screen.getByText('Memory created successfully')).toBeInTheDocument()
    })
  })

  it('displays memory timeline view', async () => {
    const { user } = renderWithProviders(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByText('Timeline')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Timeline'))

    // The Timeline tab renders the loaded memories on a vertical timeline.
    // Card titles truncate the content and append an ellipsis, so match on a
    // substring of the seeded memory content.
    await waitFor(() => {
      expect(screen.getAllByText(/Test memory content/).length).toBeGreaterThan(0)
    })
  })

  it('displays memory search view', async () => {
    const { user } = renderWithProviders(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByText('Search')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Search'))

    // "Advanced Search" appears both as the card title and the action button,
    // so scope the assertion to the heading to stay unambiguous.
    await waitFor(() => {
      expect(
        screen.getByText('Advanced Search', { selector: '[data-slot="card-title"]' }),
      ).toBeInTheDocument()
    })
  })

  it('handles memory deletion', async () => {
    const { user } = renderWithProviders(<MemoryView />)

    await waitFor(() => {
      // Browse-tab card titles truncate content + append an ellipsis.
      expect(screen.getAllByText(/Test memory content/).length).toBeGreaterThan(0)
    })

    // The delete affordance on each memory card is the icon button carrying the
    // lucide trash icon; click it directly rather than guessing button order.
    const trashButton = screen
      .getAllByRole('button')
      .find(btn => btn.querySelector('svg.lucide-trash-2'))
    expect(trashButton).toBeDefined()
    await user.click(trashButton as HTMLElement)

    await waitFor(() => {
      expect(screen.getByText('Memory deleted successfully')).toBeInTheDocument()
    })
  })

  it('handles memory editing', async () => {
    const { user } = renderWithProviders(<MemoryView />)

    await waitFor(() => {
      expect(screen.getAllByText(/Test memory content/).length).toBeGreaterThan(0)
    })

    // Find and click edit button
    const editButtons = screen.getAllByRole('button').filter(btn =>
      btn.textContent === '' || btn.querySelector('svg')
    )

    if (editButtons.length > 1) {
      await user.click(editButtons[1]) // Second button should be edit

      await waitFor(() => {
        expect(screen.getByText('Edit Memory')).toBeInTheDocument()
      })
    }
  })

  it('handles tag management in memory form', async () => {
    const { user } = renderWithProviders(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByText('Add Memory')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Add Memory'))

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/add tag/i)).toBeInTheDocument()
    })

    const tagInput = screen.getByPlaceholderText(/add tag/i)
    await user.type(tagInput, 'test-tag')

    await user.click(screen.getByRole('button', { name: /add/i }))

    await waitFor(() => {
      expect(screen.getByText('test-tag')).toBeInTheDocument()
    })
  })

  it('shows loading state initially', () => {
    renderWithProviders(<MemoryView />)

    expect(screen.getByText(/loading/i) || screen.queryByText(/loading/i)).toBeDefined()
  })

  it('handles empty memories gracefully', async () => {
    // MemoryView loads via fetch('/api/enhanced/graph/nodes?node_type=Memory');
    // drive the real data path with an empty backend response. The api spies are
    // mocked above (`vi.mocked(api)`) for the suite contract; here we override
    // fetch to assert the genuine empty-state branch.
    vi.mocked(api).getGraphNodes.mockResolvedValueOnce([])
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
        text: () => Promise.resolve('[]'),
      } as unknown as Response),
    ) as unknown as typeof fetch

    renderWithProviders(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByText('No memories found')).toBeInTheDocument()
    })
  })

  it('filters memories by search query', async () => {
    const { user } = renderWithProviders(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search memories/i)).toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText(/search memories/i)
    await user.type(searchInput, 'Test')

    await waitFor(() => {
      // Card title truncates to "Test memory content...".
      expect(screen.getAllByText(/Test memory content/).length).toBeGreaterThan(0)
    })
  })

  it('displays memory importance visualization', async () => {
    renderWithProviders(<MemoryView />)

    await waitFor(() => {
      expect(screen.getAllByText(/Test memory content/).length).toBeGreaterThan(0)
      // Should show importance percentage
      expect(screen.getByText('80%')).toBeInTheDocument()
    })
  })
})
