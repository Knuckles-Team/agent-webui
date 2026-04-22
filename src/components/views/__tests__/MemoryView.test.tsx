import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MemoryView from '@/components/views/MemoryView'
import { renderWithProviders, mockMemoryNode } from '@/__tests__/fixtures'

// Mock API calls
vi.mock('@/lib/api', () => ({
  getGraphNodes: vi.fn(() => Promise.resolve([mockMemoryNode])),
  addMemory: vi.fn(() => Promise.resolve({ status: 'success', id: 'mem_test' })),
  updateMemory: vi.fn(() => Promise.resolve({ status: 'success' })),
  deleteMemory: vi.fn(() => Promise.resolve({ status: 'success' })),
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

    await waitFor(() => {
      expect(screen.getByText(/no memories found/i)).toBeInTheDocument()
    })
  })

  it('displays memory search view', async () => {
    const { user } = renderWithProviders(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByText('Search')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Search'))

    await waitFor(() => {
      expect(screen.getByText('Advanced Search')).toBeInTheDocument()
    })
  })

  it('handles memory deletion', async () => {
    const { user } = renderWithProviders(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByText('Test memory content')).toBeInTheDocument()
    })

    // Find and click delete button
    const deleteButtons = screen.getAllByRole('button').filter(btn =>
      btn.textContent === '' || btn.querySelector('svg')
    )

    if (deleteButtons.length > 0) {
      await user.click(deleteButtons[0])

      await waitFor(() => {
        expect(screen.getByText('Memory deleted successfully')).toBeInTheDocument()
      })
    }
  })

  it('handles memory editing', async () => {
    const { user } = renderWithProviders(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByText('Test memory content')).toBeInTheDocument()
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
    vi.mocked('@/lib/api').getGraphNodes.mockResolvedValueOnce([])

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
      expect(screen.getByText('Test memory content')).toBeInTheDocument()
    })
  })

  it('displays memory importance visualization', async () => {
    renderWithProviders(<MemoryView />)

    await waitFor(() => {
      expect(screen.getByText('Test memory content')).toBeInTheDocument()
      // Should show importance percentage
      expect(screen.getByText('80%')).toBeInTheDocument()
    })
  })
})
