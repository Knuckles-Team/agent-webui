import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import FilesView from '@/components/views/FilesView'
import { PageContextProvider } from '@/lib/page-context'
import { renderWithProviders } from '@/__tests__/fixtures'

// usePageContextPublisher throws without a PageContextProvider ancestor (see
// GraphView.test.tsx / TemporalGraphView.test.tsx for the same pattern).
function renderFilesView() {
  return renderWithProviders(
    <PageContextProvider route="/files" view="files">
      <FilesView />
    </PageContextProvider>,
  )
}

const LISTING = [
  { name: 'docs', size: 0, modified_iso: '2026-01-01T00:00:00Z', is_dir: true },
  { name: 'docs/guide.md', size: 200, modified_iso: '2026-01-01T00:00:00Z', is_dir: false },
  { name: 'docs/nested', size: 0, modified_iso: '2026-01-01T00:00:00Z', is_dir: true },
  { name: 'docs/nested/deep.md', size: 50, modified_iso: '2026-01-01T00:00:00Z', is_dir: false },
  { name: 'README.md', size: 10, modified_iso: '2026-01-01T00:00:00Z', is_dir: false },
]

function mockFilesFetch() {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.startsWith('/api/enhanced/files')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(LISTING),
      } as unknown as Response)
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as unknown as Response)
  }) as unknown as typeof fetch
}

describe('FilesView collapsible tree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFilesFetch()
  })

  it('renders top-level entries collapsed by default', async () => {
    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('docs')).toBeInTheDocument()
    })
    expect(screen.getByText('README.md')).toBeInTheDocument()
    // A directory's children are not mounted until it is expanded.
    expect(screen.queryByText('guide.md')).not.toBeInTheDocument()
    expect(screen.queryByText('nested')).not.toBeInTheDocument()
  })

  it('expands a directory on click to reveal its children', async () => {
    const { user } = renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('docs')).toBeInTheDocument()
    })

    await user.click(screen.getByText('docs'))

    await waitFor(() => {
      expect(screen.getByText('guide.md')).toBeInTheDocument()
      expect(screen.getByText('nested')).toBeInTheDocument()
    })
    // A nested directory's own children stay collapsed until expanded in turn.
    expect(screen.queryByText('deep.md')).not.toBeInTheDocument()
  })

  it('collapses an expanded directory back on a second click', async () => {
    const { user } = renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('docs')).toBeInTheDocument()
    })

    await user.click(screen.getByText('docs'))
    await waitFor(() => {
      expect(screen.getByText('guide.md')).toBeInTheDocument()
    })

    await user.click(screen.getByText('docs'))
    await waitFor(() => {
      expect(screen.queryByText('guide.md')).not.toBeInTheDocument()
    })
  })

  it('expands nested directories independently', async () => {
    const { user } = renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('docs')).toBeInTheDocument()
    })
    await user.click(screen.getByText('docs'))
    await waitFor(() => {
      expect(screen.getByText('nested')).toBeInTheDocument()
    })
    await user.click(screen.getByText('nested'))

    await waitFor(() => {
      expect(screen.getByText('deep.md')).toBeInTheDocument()
    })
  })

  it('selecting a file previews it', async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/enhanced/files') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(LISTING) } as unknown as Response)
      }
      if (url === '/api/enhanced/files/README.md') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ content: 'hello workspace' }),
        } as unknown as Response)
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as unknown as Response)
    }) as unknown as typeof fetch

    const { user } = renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })
    await user.click(screen.getByText('README.md'))

    await waitFor(() => {
      expect(screen.getByText('hello workspace')).toBeInTheDocument()
    })
  })

  it('search auto-expands ancestor directories of a match and hides non-matches', async () => {
    const { user } = renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('docs')).toBeInTheDocument()
    })

    const search = screen.getByPlaceholderText('Search files...')
    await user.type(search, 'deep.md')

    await waitFor(() => {
      expect(screen.getByText('deep.md')).toBeInTheDocument()
    })
    // Ancestors of the match are visible (auto-expanded); the unrelated
    // top-level file is filtered out entirely.
    expect(screen.getByText('nested')).toBeInTheDocument()
    expect(screen.queryByText('README.md')).not.toBeInTheDocument()
    expect(screen.queryByText('guide.md')).not.toBeInTheDocument()
  })

  it('shows an empty-tree message when the workspace has no files', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) } as unknown as Response),
    ) as unknown as typeof fetch

    renderFilesView()

    await waitFor(() => {
      expect(screen.getByText('No files found.')).toBeInTheDocument()
    })
  })

  it('renders the tree inside an accessible tree role', async () => {
    renderFilesView()

    await waitFor(() => {
      expect(screen.getByRole('tree', { name: 'Workspace files' })).toBeInTheDocument()
    })
    const tree = screen.getByRole('tree', { name: 'Workspace files' })
    expect(within(tree).getByText('docs')).toBeInTheDocument()
  })
})
