import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
// spec: OVERSTORY-APPS-R049.1.6
import { WorkspaceCommandsProvider, WorkspaceCommandPalette } from '../WorkspaceCommands'
// spec: OVERSTORY-APPS-R049.1.1
import { PageContextProvider, usePageContextEnvelope } from '@/lib/page-context'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/__tests__/fixtures'
import { api } from '@/lib/api'
import { exploreHref, navigateExplore, parseExploreState } from '@/lib/explore-workspace'
import type { WebMcpToolDefinition } from '@/lib/webmcp/types'
import ExploreWorkspace from '../ExploreWorkspace'
const state = vi.hoisted(() => ({ tools: [] as WebMcpToolDefinition[], role: 'user', loading: false }))
vi.mock('@/lib/auth', () => ({
  useIdentity: () => ({
    identity: { role: state.role, userKey: 'test-user', needsSignIn: false, raw: { tenant: 'test' } },
    loading: state.loading,
  }),
}))
vi.mock('@/lib/webmcp/provider', () => ({
  WorkspaceWebMcpControl: () => null,
  useWebMcpToolSet: (tools: WebMcpToolDefinition[]) => {
    state.tools = tools
  },
}))
vi.mock('@/lib/api', () => ({
  api: {
    ontologySearch: vi.fn(async () => ({ total: 1, objects: [{ id: 'a', type: 'Document', title: 'Evidence A' }] })),
    getOntologyObject: vi.fn(async (id: string) => ({
      id,
      object_type: 'Document',
      title: `Evidence ${id.toUpperCase()}`,
      properties: [{ name: 'title', value: `Body ${id}` }],
      derived: [],
      markings: [],
      links:
        id === 'a'
          ? [
              { link_type: 'cites', target_id: 'b', target_title: 'Evidence B', direction: 'out' },
              { link_type: 'cited by', target_id: 'c', target_title: 'Evidence C', direction: 'in' },
            ]
          : [],
      history: [
        {
          edit_id: 'edit1',
          kind: 'set_property',
          target: 'title',
          timestamp: '2026-10-23T12:00:00Z',
          actor: 'fixture',
        },
      ],
    })),
  },
}))
beforeEach(() => {
  window.history.replaceState({}, '', '/workspace/explore')
  state.tools = []
  state.role = 'user'
  state.loading = false
  vi.mocked(api.getOntologyObject).mockClear()
})
afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState({}, '', '/')
})

function ContextProbe() {
  const context = usePageContextEnvelope()
  return (
    <>
      <output aria-label="Conversation evidence">{context.selection.map((entry) => entry.id).join(',')}</output>
      <output aria-label="Published query">{String(context.filters.collectionQuery ?? '')}</output>
    </>
  )
}
function renderWorkspace() {
  return renderWithProviders(
    <PageContextProvider route="/workspace/explore" view="workspace.explore-proof">
      <ExploreWorkspace />
      <ContextProbe />
    </PageContextProvider>,
  )
}

async function searchAndOpen() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Search knowledge' }), { target: { value: 'sample query' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  fireEvent.click(await screen.findByRole('link', { name: /Evidence A/ }))
  await screen.findByText('Body a')
}

describe('retained Explore investigation', () => {
  it('publishes actual loaded evidence to the matching owner command catalog', async () => {
    renderWithProviders(
      <PageContextProvider route="/workspace/explore" view="workspace.explore-proof">
        <WorkspaceCommandsProvider owner={JSON.stringify(['owner-v1', 'test', 'test-user'])} role="user">
          <WorkspaceCommandPalette />
          <ExploreWorkspace />
        </WorkspaceCommandsProvider>
      </PageContextProvider>,
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Search knowledge' }), { target: { value: 'sample query' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await screen.findByRole('link', { name: /Evidence A/ })
    fireEvent.click(screen.getByRole('button', { name: 'Find destination' }))
    const command = await within(screen.getByRole('dialog')).findByRole('link', { name: 'Evidence A' })
    fireEvent.click(command)
    expect(parseExploreState(window.location.href)).toEqual({ entity: 'a', tool: 'overview', query: 'sample query' })
    await screen.findByText('Body a')
  })
  it('retains the search and collection while traversing evidence and synthetic history events', async () => {
    renderWorkspace()
    await searchAndOpen()
    expect(screen.getByRole('textbox', { name: 'Search knowledge' })).toHaveValue('sample query')
    expect(window.location.search).toBe('?q=sample+query&entity=a')
    expect(screen.getByLabelText('Conversation evidence')).toHaveTextContent('a')
    expect(screen.getByRole('region', { name: 'Related records' })).toHaveTextContent('Evidence B')
    expect(screen.getByRole('region', { name: 'Recent history' })).toHaveTextContent('set_property title')
    fireEvent.click(screen.getByRole('button', { name: 'Related records' }))
    expect(await screen.findByRole('button', { name: /cited by.*←.*Evidence C/ })).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /cites.*Evidence B/ }))
    await screen.findByText('Body b')
    fireEvent.click(screen.getByRole('button', { name: 'Change history' }))
    await screen.findByText('set_property title')
    act(() => {
      window.history.replaceState({}, '', '/workspace/explore?q=sample+query&entity=a')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await screen.findByText('Body a')
    expect(screen.getByRole('textbox', { name: 'Search knowledge' })).toHaveValue('sample query')
    expect(screen.getByRole('link', { name: /Evidence A/ })).toHaveAttribute('aria-current', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Search knowledge' }))
    expect(screen.getByRole('textbox', { name: 'Search knowledge' })).toHaveFocus()
    expect(window.location.search).toBe('?q=sample+query')
  })

  // spec: OVERSTORY-APPS-R049.2.1
  it('only opens detail for a selection and closes back to the retained searchable collection', async () => {
    renderWorkspace()
    expect(screen.queryByRole('region', { name: 'Record details' })).not.toBeInTheDocument()
    await searchAndOpen()
    expect(screen.getByRole('region', { name: 'Record details' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close record details' }))
    expect(screen.queryByRole('region', { name: 'Record details' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Search knowledge' })).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Search knowledge' })).toHaveValue('sample query')
    expect(screen.getByRole('link', { name: /Evidence A/ })).toBeInTheDocument()
  })

  it('removes protected list and detail immediately on admission loss instead of animating a snapshot', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const surface = () => (
      <QueryClientProvider client={client}>
        <PageContextProvider route="/workspace/explore" view="workspace.explore-proof">
          <ExploreWorkspace />
          <ContextProbe />
        </PageContextProvider>
      </QueryClientProvider>
    )
    const view = render(surface())
    await searchAndOpen()
    state.role = 'reader'
    view.rerender(surface())
    expect(screen.queryByText('Body a')).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Knowledge results' })).not.toBeInTheDocument()
    expect(state.tools).toEqual([])
  })

  it('shares typed selection between manual navigation and mounted WebMCP without arbitrary targets', async () => {
    renderWorkspace()
    await searchAndOpen()
    await act(async () => {
      await state.tools[0].execute({ entity: 'a', tool: 'history' }, { signal: new AbortController().signal })
    })
    expect(window.location.search).toBe('?q=sample+query&entity=a&tool=history')
    expect(screen.getByRole('button', { name: 'Change history' })).toHaveAttribute('aria-pressed', 'true')
    await expect(
      state.tools[0].execute({ entity: 'unrelated', tool: 'overview' }, { signal: new AbortController().signal }),
    ).rejects.toThrow('outside')
    expect(window.location.search).toBe('?q=sample+query&entity=a&tool=history')
  })

  it('bounds published context without truncating the actual search input', async () => {
    renderWorkspace()
    const query = 'x'.repeat(300)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search knowledge' }), { target: { value: query } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await screen.findByRole('link', { name: /Evidence A/ })
    expect(screen.getByRole('textbox', { name: 'Search knowledge' })).toHaveValue(query)
    expect(screen.getByLabelText('Published query').textContent).toHaveLength(256)
    expect(api.ontologySearch).toHaveBeenCalledWith({ query, filters: [] })
  })

  it('does not issue protected reads while identity resolves or for a reader', async () => {
    window.history.replaceState({}, '', '/workspace/explore?q=sample+query&entity=a')
    state.loading = true
    const view = renderWorkspace()
    expect(screen.getByText('Checking workspace access…')).toHaveAttribute('role', 'status')
    expect(api.getOntologyObject).not.toHaveBeenCalled()
    expect(state.tools).toEqual([])
    view.unmount()
    state.loading = false
    state.role = 'reader'
    renderWorkspace()
    expect(screen.getByRole('alert')).toHaveTextContent('not available')
    expect(api.getOntologyObject).not.toHaveBeenCalled()
  })

  it('loads a directly addressed entity without duplicating the anchored context rail', async () => {
    window.history.replaceState({}, '', '/workspace/explore?entity=b&tool=history')
    renderWorkspace()
    await screen.findByText('set_property title')
    expect(api.getOntologyObject).toHaveBeenCalledWith('b', 'standard')
    expect(screen.queryByRole('navigation', { name: 'Primary workspace contexts' })).not.toBeInTheDocument()
  })

  it('reports an unavailable direct entity without publishing fabricated evidence', async () => {
    vi.mocked(api.getOntologyObject).mockRejectedValueOnce(new Error('Object not found'))
    window.history.replaceState({}, '', '/workspace/explore?entity=missing&tool=overview')
    renderWorkspace()
    expect(await screen.findByRole('alert')).toHaveTextContent('This record could not be loaded')
    expect(screen.getByLabelText('Conversation evidence').textContent).toBe('')
    expect(window.location.search).toContain('entity=missing')
    expect(screen.queryByText('Body missing')).not.toBeInTheDocument()
  })

  it('restores collection query, results and selected evidence after remount', async () => {
    const view = renderWorkspace()
    await searchAndOpen()
    expect(screen.getByRole('link', { name: /Evidence A/ })).toHaveAttribute(
      'href',
      '/workspace/explore?q=sample+query&entity=a',
    )
    view.unmount()
    vi.mocked(api.ontologySearch).mockClear()
    renderWorkspace()
    await screen.findByText('Body a')
    await screen.findByRole('link', { name: /Evidence A/ })
    expect(api.ontologySearch).toHaveBeenCalledWith({ query: 'sample query', filters: [] })
    expect(screen.getByRole('textbox', { name: 'Search knowledge' })).toHaveValue('sample query')
    expect(screen.getByLabelText('Conversation evidence')).toHaveTextContent('a')
  })

  it('shows a retryable search failure and keeps the user query', async () => {
    vi.mocked(api.ontologySearch).mockRejectedValueOnce(new Error('Unavailable'))
    renderWorkspace()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search knowledge' }), { target: { value: 'retained' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('textbox', { name: 'Search knowledge' })).toHaveValue('retained')
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })
})

describe('typed Explore destination authority', () => {
  it('round-trips entity IDs without normalizing them into other routes', () => {
    const selected = { entity: '../record?secret#fragment', tool: 'history' as const }
    expect(parseExploreState(exploreHref(selected))).toEqual(selected)
  })
  it('rejects untyped state, malformed tools and insufficient roles before writing history', () => {
    const push = vi.spyOn(window.history, 'pushState')
    expect(() => parseExploreState('/workspace/explore?redirect=https://elsewhere')).toThrow()
    expect(() => parseExploreState('/workspace/explore?entity=a&entity=b')).toThrow()
    expect(() => navigateExplore({ entity: 'a', tool: 'history' }, 'reader')).toThrow('not permitted')
    expect(push).not.toHaveBeenCalled()
  })
})

// spec: OVERSTORY-APPS-R049.2.1
it('uses a returned related-record title without inventing identity or fetching another record', async () => {
  vi.mocked(api.ontologySearch).mockResolvedValueOnce({
    total: 2,
    objects: [
      { id: 'a', type: 'Document', title: 'Evidence A' },
      { id: 'b', type: 'Document', title: 'Project setup notes' },
    ],
  })
  vi.mocked(api.getOntologyObject).mockResolvedValueOnce({
    id: 'a',
    object_type: 'Document',
    title: 'Evidence A',
    properties: [{ name: 'title', value: 'Body a' }],
    derived: [],
    markings: [],
    history: [],
    links: [{ link_type: 'references', target_id: 'b', direction: 'out' }],
  })
  renderWorkspace()
  await searchAndOpen()
  const related = screen.getByRole('button', { name: /references.*Project setup notes.*b/ })
  expect(related).toBeVisible()
  expect(api.getOntologyObject).toHaveBeenCalledTimes(1)
  fireEvent.click(related)
  await screen.findByText('Body b')
  expect(parseExploreState(window.location.href).entity).toBe('b')
})
