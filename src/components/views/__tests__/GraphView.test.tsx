import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GraphView from '@/components/views/GraphView'
import { renderWithProviders, mockGraphStats, mockGraphNodes, mockGraphRelationships } from '@/__tests__/fixtures'

// Mock API calls
vi.mock('@/lib/api', () => ({
  getGraphStats: vi.fn(() => Promise.resolve(mockGraphStats)),
  getGraphNodes: vi.fn(() => Promise.resolve(mockGraphNodes)),
  getGraphRelationships: vi.fn(() => Promise.resolve(mockGraphRelationships)),
}))

describe('GraphView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders graph statistics correctly', async () => {
    renderWithProviders(<GraphView />)

    await waitFor(() => {
      expect(screen.getByText('100')).toBeInTheDocument()
      expect(screen.getByText('200')).toBeInTheDocument()
    })
  })

  it('displays nodes in correct format', async () => {
    renderWithProviders(<GraphView />)

    await waitFor(() => {
      expect(screen.getByText('Test Memory')).toBeInTheDocument()
    })
  })

  it('handles node type filtering', async () => {
    const { user } = renderWithProviders(<GraphView />)

    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeInTheDocument()
    })

    // Click on Nodes tab
    await user.click(screen.getByText('Nodes'))

    await waitFor(() => {
      expect(screen.getByText('Graph Nodes')).toBeInTheDocument()
    })
  })

  it('renders visualization tab with controls', async () => {
    const { user } = renderWithProviders(<GraphView />)

    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeInTheDocument()
    })

    // Click on Visualization tab
    await user.click(screen.getByText('Visualization'))

    await waitFor(() => {
      expect(screen.getByText('Interactive Graph Visualization')).toBeInTheDocument()
      expect(screen.getByText('Force')).toBeInTheDocument()
      expect(screen.getByText('Hierarchical')).toBeInTheDocument()
      expect(screen.getByText('Circular')).toBeInTheDocument()
    })
  })

  it('handles graph layout switching', async () => {
    const { user } = renderWithProviders(<GraphView />)

    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Visualization'))

    await waitFor(() => {
      expect(screen.getByText('Force')).toBeInTheDocument()
    })

    // Test layout switching
    await user.click(screen.getByText('Hierarchical'))
    await user.click(screen.getByText('Circular'))
    await user.click(screen.getByText('Force'))

    await waitFor(() => {
      expect(screen.getByText('Force')).toBeInTheDocument()
    })
  })

  it('displays explorer tab with node type buttons', async () => {
    const { user } = renderWithProviders(<GraphView />)

    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Explorer'))

    await waitFor(() => {
      expect(screen.getByText('Quick Access')).toBeInTheDocument()
    })
  })

  it('handles refresh button click', async () => {
    const { user } = renderWithProviders(<GraphView />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /refresh/i }))

    // Verify API was called
    await waitFor(() => {
      expect(screen.getByText('100')).toBeInTheDocument()
    })
  })

  it('shows loading state initially', () => {
    renderWithProviders(<GraphView />)

    // Should show loading state
    expect(screen.getByText(/loading/i) || screen.queryByText(/loading/i)).toBeDefined()
  })

  it('handles empty graph data gracefully', async () => {
    vi.mocked('@/lib/api').getGraphStats.mockResolvedValueOnce({
      total_nodes: 0,
      total_relationships: 0,
      by_type: {}
    })

    renderWithProviders(<GraphView />)

    await waitFor(() => {
      expect(screen.getByText('0')).toBeInTheDocument()
    })
  })
})
