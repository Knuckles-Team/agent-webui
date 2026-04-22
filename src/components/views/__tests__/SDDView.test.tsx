import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SDDView from '@/components/views/SDDView'
import { renderWithProviders, mockSpec, mockPlan, mockTask } from '@/__tests__/fixtures'

// Mock API calls
vi.mock('@/lib/api', () => ({
  getConstitution: vi.fn(() => Promise.resolve({
    governance_rules: ['Rule 1', 'Rule 2'],
    tech_stack: { language: 'Python' },
    quality_gates: ['Gate 1']
  })),
  saveConstitution: vi.fn(() => Promise.resolve({ status: 'success' })),
  listSpecs: vi.fn(() => Promise.resolve([mockSpec])),
  createSpec: vi.fn(() => Promise.resolve({ ...mockSpec, id: 'new_spec' })),
  listPlans: vi.fn(() => Promise.resolve([mockPlan])),
  getTasks: vi.fn(() => Promise.resolve({ tasks: [mockTask] })),
  syncSDDToMemory: vi.fn(() => Promise.resolve({ status: 'success' })),
}))

describe('SDDView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders constitution tab correctly', async () => {
    renderWithProviders(<SDDView />)

    await waitFor(() => {
      expect(screen.getByText('Constitution')).toBeInTheDocument()
      expect(screen.getByText('Governance Rules')).toBeInTheDocument()
    })
  })

  it('displays spec creation dialog', async () => {
    const { user } = renderWithProviders(<SDDView />)

    await waitFor(() => {
      expect(screen.getByText('Specifications')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Specifications'))

    await waitFor(() => {
      expect(screen.getByText('Create Spec')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Create Spec'))

    await waitFor(() => {
      expect(screen.getByText('Create New Specification')).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/specification title/i)).toBeInTheDocument()
    })
  })

  it('handles spec creation', async () => {
    const { user } = renderWithProviders(<SDDView />)

    await waitFor(() => {
      expect(screen.getByText('Specifications')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Specifications'))
    await user.click(screen.getByText('Create Spec'))

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/specification title/i)).toBeInTheDocument()
    })

    // Fill form
    const titleInput = screen.getByPlaceholderText(/specification title/i)
    await user.type(titleInput, 'New Feature Spec')

    const descriptionInput = screen.getByPlaceholderText(/description/i)
    await user.type(descriptionInput, 'Test feature description')

    await user.click(screen.getByRole('button', { name: /create spec/i }))

    await waitFor(() => {
      expect(screen.getByText('Specification created successfully')).toBeInTheDocument()
    })
  })

  it('displays plans tab with implementation plans', async () => {
    const { user } = renderWithProviders(<SDDView />)

    await waitFor(() => {
      expect(screen.getByText('Plans')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Plans'))

    await waitFor(() => {
      expect(screen.getByText('Implementation Plans')).toBeInTheDocument()
    })
  })

  it('displays tasks tab with task list', async () => {
    const { user } = renderWithProviders(<SDDView />)

    await waitFor(() => {
      expect(screen.getByText('Tasks')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Tasks'))

    await waitFor(() => {
      expect(screen.getByText('Task Management')).toBeInTheDocument()
    })
  })

  it('handles constitution editing', async () => {
    const { user } = renderWithProviders(<SDDView />)

    await waitFor(() => {
      expect(screen.getByText('Constitution')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /edit constitution/i }))

    await waitFor(() => {
      expect(screen.getByText('Edit Constitution')).toBeInTheDocument()
    })
  })

  it('displays SDD lifecycle visualization', async () => {
    renderWithProviders(<SDDView />)

    await waitFor(() => {
      expect(screen.getByText('SDD Lifecycle')).toBeInTheDocument()
    })
  })

  it('handles sync to memory operation', async () => {
    const { user } = renderWithProviders(<SDDView />)

    await waitFor(() => {
      expect(screen.getByText('Sync to Memory')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Sync to Memory'))

    await waitFor(() => {
      expect(screen.getByText('SDD synced to memory successfully')).toBeInTheDocument()
    })
  })

  it('shows loading state initially', () => {
    renderWithProviders(<SDDView />)

    expect(screen.getByText(/loading/i) || screen.queryByText(/loading/i)).toBeDefined()
  })

  it('handles empty specs gracefully', async () => {
    vi.mocked('@/lib/api').listSpecs.mockResolvedValueOnce([])

    renderWithProviders(<SDDView />)

    await waitFor(() => {
      expect(screen.getByText('Specifications')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('Specifications'))

    await waitFor(() => {
      expect(screen.getByText('No specifications found')).toBeInTheDocument()
    })
  })

  it('filters specs by search query', async () => {
    const { user } = renderWithProviders(<SDDView />)

    await waitFor(() => {
      expect(screen.getByText('Specifications')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Specifications'))

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search specs/i)).toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText(/search specs/i)
    await user.type(searchInput, 'Test')

    await waitFor(() => {
      expect(screen.getByText('Test Spec')).toBeInTheDocument()
    })
  })

  it('displays task dependency visualization', async () => {
    const { user } = renderWithProviders(<SDDView />)

    await waitFor(() => {
      expect(screen.getByText('Tasks')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Tasks'))

    await waitFor(() => {
      expect(screen.getByText('Task Dependencies')).toBeInTheDocument()
    })
  })

  it('handles task status updates', async () => {
    const { user } = renderWithProviders(<SDDView />)

    await waitFor(() => {
      expect(screen.getByText('Tasks')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Tasks'))

    await waitFor(() => {
      expect(screen.getByText('Test Task')).toBeInTheDocument()
    })

    // Find and click status dropdown
    const statusButtons = screen.getAllByRole('button').filter(btn =>
      btn.textContent === 'pending'
    )

    if (statusButtons.length > 0) {
      await user.click(statusButtons[0])

      await waitFor(() => {
        expect(screen.getByText('in_progress')).toBeInTheDocument()
      })
    }
  })
})
