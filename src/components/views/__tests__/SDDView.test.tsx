import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import SDDView from '@/components/views/SDDView'
import { api } from '@/lib/api'
import { renderWithProviders, mockSpec, mockPlan, mockTask } from '@/__tests__/fixtures'

// Mock API calls. The component imports the `api` instance from '@/lib/api',
// so the factory must expose an `api` object carrying the spied methods.
vi.mock('@/lib/api', () => ({
  api: {
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
  },
}))

// SDDView loads its data with bare fetch('/api/enhanced/sdd/*') calls; the
// default fetch shim in setup.ts serves the constitution / specs / plans / tasks
// from the same fixtures. These tests assert against the live UI:
//   tabs: Constitution / Specifications / Plans / Tasks
//   header action: "New Specification" -> "Create Specification" dialog
describe('SDDView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders constitution tab correctly', async () => {
    renderWithProviders(<SDDView />)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Constitution' })).toBeInTheDocument()
      expect(screen.getByText('Governance Rules')).toBeInTheDocument()
    })
  })

  it('displays spec creation dialog', async () => {
    const { user } = renderWithProviders(<SDDView />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new specification/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /new specification/i }))

    await waitFor(() => {
      // "Create Specification" is both the dialog title and the submit button;
      // assert the dialog itself is open plus its title.
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(
        screen.getByText('Create Specification', { selector: '[data-slot="dialog-title"]' }),
      ).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/feature title/i)).toBeInTheDocument()
    })
  })

  it('handles spec creation', async () => {
    const { user } = renderWithProviders(<SDDView />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new specification/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /new specification/i }))

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/feature title/i)).toBeInTheDocument()
    })

    // Fill form
    await user.type(screen.getByPlaceholderText(/feature title/i), 'New Feature Spec')
    await user.type(screen.getByPlaceholderText(/feature description/i), 'Test feature description')

    // The dialog's submit button is labelled "Create Specification".
    const submit = screen
      .getAllByRole('button', { name: /create specification/i })
      .pop() as HTMLElement
    await user.click(submit)

    await waitFor(() => {
      expect(screen.getByText('Specification created successfully')).toBeInTheDocument()
    })
  })

  it('displays specifications tab with spec cards', async () => {
    const { user } = renderWithProviders(<SDDView />)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Specifications' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('tab', { name: 'Specifications' }))

    await waitFor(() => {
      expect(screen.getByText(mockSpec.title)).toBeInTheDocument()
    })
  })

  it('displays plans tab with implementation plans', async () => {
    const { user } = renderWithProviders(<SDDView />)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Plans' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('tab', { name: 'Plans' }))

    // Plan cards are titled "Plan <id-prefix>".
    await waitFor(() => {
      expect(
        screen.getByText(`Plan ${mockPlan.id.substring(0, 8)}`),
      ).toBeInTheDocument()
    })
  })

  it('displays tasks tab and prompts to select a plan', async () => {
    const { user } = renderWithProviders(<SDDView />)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Tasks' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('tab', { name: 'Tasks' }))

    // No plan selected yet -> the tasks tab prompts for one.
    await waitFor(() => {
      expect(screen.getByText('Select a plan to view tasks')).toBeInTheDocument()
    })
  })

  it('renders the SDD header', async () => {
    renderWithProviders(<SDDView />)

    await waitFor(() => {
      expect(screen.getByText('Spec-Driven Development')).toBeInTheDocument()
    })
  })

  it('handles sync to memory after selecting a plan', async () => {
    const { user } = renderWithProviders(<SDDView />)

    // Select a plan first so the Tasks tab exposes the Sync to Memory action.
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Plans' })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('tab', { name: 'Plans' }))

    await waitFor(() => {
      expect(screen.getByText(`Plan ${mockPlan.id.substring(0, 8)}`)).toBeInTheDocument()
    })
    await user.click(screen.getByText(`Plan ${mockPlan.id.substring(0, 8)}`))

    await user.click(screen.getByRole('tab', { name: 'Tasks' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sync to memory/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /sync to memory/i }))

    await waitFor(() => {
      expect(screen.getByText('SDD data synced to knowledge graph')).toBeInTheDocument()
    })
  })

  it('renders synchronously on initial mount (pre-fetch)', () => {
    renderWithProviders(<SDDView />)

    // On first paint — before any /sdd/* fetch resolves — the static header and
    // tab chrome render. (The constitution tab is the default; its data-driven
    // body fills in asynchronously.)
    expect(screen.getByText('Spec-Driven Development')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Constitution' })).toBeInTheDocument()
  })

  it('handles empty specs gracefully', async () => {
    // Drive the real data path: SDDView lists specs via fetch('/api/enhanced/sdd/specs').
    vi.mocked(api).listSpecs.mockResolvedValueOnce([])
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      let body: unknown = []
      if (url.includes('/sdd/constitution')) {
        body = { governance_rules: [], tech_stack: {}, quality_gates: [] }
      } else if (url.includes('/sdd/tasks')) {
        body = { tasks: [] }
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      } as unknown as Response)
    }) as unknown as typeof fetch

    const { user } = renderWithProviders(<SDDView />)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Specifications' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('tab', { name: 'Specifications' }))

    await waitFor(() => {
      expect(screen.getByText('No specifications found')).toBeInTheDocument()
    })
  })

  it('renders task details after selecting a plan', async () => {
    const { user } = renderWithProviders(<SDDView />)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Plans' })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('tab', { name: 'Plans' }))

    await waitFor(() => {
      expect(screen.getByText(`Plan ${mockPlan.id.substring(0, 8)}`)).toBeInTheDocument()
    })
    await user.click(screen.getByText(`Plan ${mockPlan.id.substring(0, 8)}`))

    await user.click(screen.getByRole('tab', { name: 'Tasks' }))

    await waitFor(() => {
      expect(screen.getByText('Test Task')).toBeInTheDocument()
    })
  })

  it('reflects task status on the task card', async () => {
    const { user } = renderWithProviders(<SDDView />)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Plans' })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('tab', { name: 'Plans' }))

    await waitFor(() => {
      expect(screen.getByText(`Plan ${mockPlan.id.substring(0, 8)}`)).toBeInTheDocument()
    })
    await user.click(screen.getByText(`Plan ${mockPlan.id.substring(0, 8)}`))

    await user.click(screen.getByRole('tab', { name: 'Tasks' }))

    // The seeded task is "pending"; its status badge is rendered on the card.
    await waitFor(() => {
      expect(screen.getByText(mockTask.status)).toBeInTheDocument()
    })
  })
})
