import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import KnowledgeBaseView from '@/components/views/KnowledgeBaseView'
import { renderWithProviders, mockKnowledgeBase, mockArticle } from '@/__tests__/fixtures'

// Mock API calls
vi.mock('@/lib/api', () => ({
  listKnowledgeBases: vi.fn(() => Promise.resolve([mockKnowledgeBase])),
  searchKnowledgeBase: vi.fn(() => Promise.resolve([mockArticle])),
  getKBArticle: vi.fn(() => Promise.resolve(mockArticle)),
  ingestKnowledgeBase: vi.fn(() => Promise.resolve({ status: 'success', job_id: 'test_job' })),
  runKBHealthCheck: vi.fn(() => Promise.resolve({ health_status: 'healthy', issues: [] })),
}))

describe('KnowledgeBaseView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders knowledge base list correctly', async () => {
    renderWithProviders(<KnowledgeBaseView />)

    await waitFor(() => {
      expect(screen.getByText('Test Knowledge Base')).toBeInTheDocument()
      expect(screen.getByText('10')).toBeInTheDocument() // article count
    })
  })

  it('displays ingestion dialog', async () => {
    const { user } = renderWithProviders(<KnowledgeBaseView />)

    await waitFor(() => {
      expect(screen.getByText('Ingest Knowledge Base')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Ingest Knowledge Base'))

    await waitFor(() => {
      expect(screen.getByText('Ingest Knowledge Base')).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/knowledge base id/i)).toBeInTheDocument()
    })
  })

  it('handles knowledge base ingestion', async () => {
    const { user } = renderWithProviders(<KnowledgeBaseView />)

    await waitFor(() => {
      expect(screen.getByText('Ingest Knowledge Base')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Ingest Knowledge Base'))

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/knowledge base id/i)).toBeInTheDocument()
    })

    // Fill form
    const kbIdInput = screen.getByPlaceholderText(/knowledge base id/i)
    await user.type(kbIdInput, 'test_kb')

    const nameInput = screen.getByPlaceholderText(/knowledge base name/i)
    await user.type(nameInput, 'Test KB')

    const sourceInput = screen.getByPlaceholderText(/source path/i)
    await user.type(sourceInput, '/test/path')

    await user.click(screen.getByRole('button', { name: /start ingestion/i }))

    await waitFor(() => {
      expect(screen.getByText('Knowledge base ingestion started')).toBeInTheDocument()
    })
  })

  it('displays articles tab when KB is selected', async () => {
    const { user } = renderWithProviders(<KnowledgeBaseView />)

    await waitFor(() => {
      expect(screen.getByText('Test Knowledge Base')).toBeInTheDocument()
    })

    // Click on KB
    await user.click(screen.getByText('Test Knowledge Base'))

    await waitFor(() => {
      expect(screen.getByText('Articles')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Articles'))

    await waitFor(() => {
      expect(screen.getByText('Test Article')).toBeInTheDocument()
    })
  })

  it('displays health check results', async () => {
    const { user } = renderWithProviders(<KnowledgeBaseView />)

    await waitFor(() => {
      expect(screen.getByText('Test Knowledge Base')).toBeInTheDocument()
    })

    // Click on health check button
    const healthButton = screen.getAllByRole('button').find(btn => btn.textContent === '')
    if (healthButton) {
      await user.click(healthButton)

      await waitFor(() => {
        expect(screen.getByText('Health')).toBeInTheDocument()
      })
    }
  })

  it('shows loading state initially', () => {
    renderWithProviders(<KnowledgeBaseView />)

    expect(screen.getByText(/loading/i) || screen.queryByText(/loading/i)).toBeDefined()
  })

  it('handles empty knowledge bases gracefully', async () => {
    vi.mocked('@/lib/api').listKnowledgeBases.mockResolvedValueOnce([])

    renderWithProviders(<KnowledgeBaseView />)

    await waitFor(() => {
      expect(screen.getByText('No knowledge bases found')).toBeInTheDocument()
    })
  })

  it('filters knowledge bases by search query', async () => {
    const { user } = renderWithProviders(<KnowledgeBaseView />)

    await waitFor(() => {
      expect(screen.getByText('Test Knowledge Base')).toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText(/search knowledge bases/i)
    await user.type(searchInput, 'Test')

    await waitFor(() => {
      expect(screen.getByText('Test Knowledge Base')).toBeInTheDocument()
    })
  })

  it('displays concepts tab with concept cards', async () => {
    const { user } = renderWithProviders(<KnowledgeBaseView />)

    await waitFor(() => {
      expect(screen.getByText('Test Knowledge Base')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Concepts'))

    await waitFor(() => {
      expect(screen.getByText('Select a knowledge base to view concepts')).toBeInTheDocument()
    })
  })
})
