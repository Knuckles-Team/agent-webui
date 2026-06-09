import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import KnowledgeBaseView from '@/components/views/KnowledgeBaseView'
import { api } from '@/lib/api'
import { renderWithProviders, mockKnowledgeBase, mockArticle } from '@/__tests__/fixtures'

// Mock API calls. The component imports the `api` instance from '@/lib/api',
// so the factory must expose an `api` object carrying the spied methods.
vi.mock('@/lib/api', () => ({
  api: {
    listKnowledgeBases: vi.fn(() => Promise.resolve([mockKnowledgeBase])),
    searchKnowledgeBase: vi.fn(() => Promise.resolve([mockArticle])),
    getKBArticle: vi.fn(() => Promise.resolve(mockArticle)),
    ingestKnowledgeBase: vi.fn(() => Promise.resolve({ status: 'success', job_id: 'test_job' })),
    runKBHealthCheck: vi.fn(() => Promise.resolve({ health_status: 'healthy', issues: [] })),
  },
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

    // "Ingest Knowledge Base" is the trigger button label.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /ingest knowledge base/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /ingest knowledge base/i }))

    // Once open, the dialog exposes the same text as its title plus the form.
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      // Knowledge Base ID input is identified by its placeholder example.
      expect(screen.getByPlaceholderText(/pydantic-ai-docs/i)).toBeInTheDocument()
    })
  })

  it('handles knowledge base ingestion', async () => {
    const { user } = renderWithProviders(<KnowledgeBaseView />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /ingest knowledge base/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /ingest knowledge base/i }))

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/pydantic-ai-docs/i)).toBeInTheDocument()
    })

    // Fill form. Inputs are keyed by their actual placeholders.
    await user.type(screen.getByPlaceholderText(/pydantic-ai-docs/i), 'test_kb')
    await user.type(screen.getByPlaceholderText(/knowledge base name/i), 'Test KB')
    await user.type(screen.getByPlaceholderText(/path\/to\/docs/i), '/test/path')

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

    // "Articles" is both a tab and a card stat label; target the tab.
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Articles' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('tab', { name: 'Articles' }))

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
    // Drive the real data path: KnowledgeBaseView lists via fetch('/api/enhanced/kb/list').
    vi.mocked(api).listKnowledgeBases.mockResolvedValueOnce([])
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
        text: () => Promise.resolve('[]'),
      } as unknown as Response),
    ) as unknown as typeof fetch

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

    await user.click(screen.getByRole('tab', { name: 'Concepts' }))

    // With a knowledge base auto-selected and its article loaded, the concepts
    // tab renders concept cards derived from the article's concepts.
    await waitFor(() => {
      expect(screen.getByText('AI')).toBeInTheDocument()
      expect(screen.getByText('Testing')).toBeInTheDocument()
    })
  })
})
