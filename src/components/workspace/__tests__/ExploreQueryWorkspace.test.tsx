import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
// spec: OVERSTORY-APPS-R049.1.7
import { act, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/__tests__/fixtures'
import { PageContextProvider } from '@/lib/page-context'
import { api } from '@/lib/api'
import type { WebMcpToolDefinition } from '@/lib/webmcp/types'
import ExploreQueryWorkspace from '../ExploreQueryWorkspace'
const state = vi.hoisted(() => ({
  role: 'maintainer',
  owner: 'owner-a',
  loading: false,
  tools: new Map<string, WebMcpToolDefinition>(),
}))
vi.mock('@/lib/auth', () => ({
  useIdentity: () => ({
    identity: { role: state.role, userKey: state.owner, needsSignIn: false, raw: { tenant: 'tenant' } },
    loading: state.loading,
  }),
}))
vi.mock('@/lib/webmcp/provider', () => ({
  useWebMcpToolSet: (tools: WebMcpToolDefinition[]) => {
    for (const tool of tools) state.tools.set(tool.name, tool)
  },
}))
vi.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  api: {
    ontologySearch: vi.fn(async () => ({ total: 0, objects: [] })),
    getOntologyObject: vi.fn(async () => ({ id: 'a', properties: [], links: [], history: [] })),
    runSparqlQuery: vi.fn(async () => ({
      status: 'success',
      head: { vars: ['value'] },
      results: { bindings: [{ value: { value: 'answer' } }] },
    })),
    validateOntologyCandidate: vi.fn(async () => ({ valid: true, errors: [], warnings: [], summary: {} })),
  },
}))
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
function openAdvanced() {
  const summary = screen.getByText('Advanced')
  if (!summary.closest('details')!.open) fireEvent.click(summary)
}
function surface() {
  return (
    <QueryClientProvider client={queryClient}>
      <PageContextProvider route="/workspace/explore" view="workspace.explore-proof">
        <ExploreQueryWorkspace />
      </PageContextProvider>
    </QueryClientProvider>
  )
}
beforeEach(() => {
  state.role = 'maintainer'
  state.owner = 'owner-a'
  state.loading = false
  state.tools.clear()
  vi.clearAllMocks()
  window.history.replaceState({}, '', '/workspace/explore?q=retained&lens=query')
})
describe('integrated Explore query lenses', () => {
  it('retains drafts across lenses without navigation executing them', async () => {
    renderWithProviders(surface())
    fireEvent.change(screen.getByRole('textbox', { name: 'SPARQL query' }), {
      target: { value: 'SELECT ?private WHERE {}' },
    })
    fireEvent.click(screen.getByRole('link', { name: 'Check data schema' }))
    expect(window.location.search).toBe('?q=retained&lens=validation')
    fireEvent.click(screen.getByRole('link', { name: 'Stored records' }))
    openAdvanced()
    fireEvent.click(screen.getByRole('link', { name: 'Query stored data (SPARQL)' }))
    expect(screen.getByRole('textbox', { name: 'SPARQL query' })).toHaveValue('SELECT ?private WHERE {}')
    expect(window.location.href).not.toContain('private')
    expect(api.runSparqlQuery).not.toHaveBeenCalled()
    expect(api.validateOntologyCandidate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Run Query' }))
    await screen.findByText('answer')
    expect(api.runSparqlQuery).toHaveBeenCalledTimes(1)
  })
  it('uses typed tool navigation and retires held context handles', async () => {
    renderWithProviders(surface())
    const held = state.tools.get('agent-webui.explore.lens')!
    await act(async () => {
      await held.execute({ lens: 'validation' }, { signal: new AbortController().signal })
    })
    expect(window.location.search).toContain('lens=validation')
    await expect(held.execute({ lens: 'query' }, { signal: new AbortController().signal })).rejects.toThrow('stale')
    expect(api.runSparqlQuery).not.toHaveBeenCalled()
  })
  it('retires hidden evidence handles and privileged drafts on role changes', async () => {
    const view = renderWithProviders(surface())
    fireEvent.change(screen.getByRole('textbox', { name: 'SPARQL query' }), {
      target: { value: 'SELECT ?private WHERE {}' },
    })
    fireEvent.click(screen.getByRole('link', { name: 'Stored records' }))
    const evidence = state.tools.get('agent-webui.explore.select')!
    openAdvanced()
    fireEvent.click(screen.getByRole('link', { name: 'Query stored data (SPARQL)' }))
    await expect(
      evidence.execute({ entity: null, tool: 'overview' }, { signal: new AbortController().signal }),
    ).rejects.toThrow('stale')
    fireEvent.click(screen.getByRole('link', { name: 'Stored records' }))
    state.role = 'user'
    view.rerender(surface())
    state.role = 'maintainer'
    view.rerender(surface())
    openAdvanced()
    fireEvent.click(screen.getByRole('link', { name: 'Query stored data (SPARQL)' }))
    expect(screen.getByRole('textbox', { name: 'SPARQL query' })).not.toHaveValue('SELECT ?private WHERE {}')
  })
  it('preserves native modified links and identity-keyed draft retirement', () => {
    const view = renderWithProviders(surface())
    fireEvent.change(screen.getByRole('textbox', { name: 'SPARQL query' }), {
      target: { value: 'SELECT ?secret WHERE {}' },
    })
    const push = vi.spyOn(window.history, 'pushState')
    fireEvent.click(screen.getByRole('link', { name: 'Check data schema' }), { ctrlKey: true })
    expect(push).not.toHaveBeenCalled()
    state.owner = 'owner-b'
    view.rerender(surface())
    expect(screen.getByRole('textbox', { name: 'SPARQL query' })).not.toHaveValue('SELECT ?secret WHERE {}')
    push.mockRestore()
  })
  it('keeps maintainer permission and unresolved identity gates', () => {
    state.role = 'user'
    const view = renderWithProviders(surface())
    expect(screen.getByRole('alert')).toHaveTextContent('maintainer access')
    expect(screen.queryByRole('button', { name: 'Run Query' })).not.toBeInTheDocument()
    state.role = 'maintainer'
    state.loading = true
    view.rerender(surface())
    expect(screen.getByRole('status')).toHaveTextContent('Checking workspace access')
    expect(api.runSparqlQuery).not.toHaveBeenCalled()
  })
  it('refuses malformed lens state without executing or fetching evidence', () => {
    window.history.replaceState({}, '', '/workspace/explore?lens=query&lens=validation')
    renderWithProviders(surface())
    expect(screen.getByRole('alert')).toHaveTextContent('invalid')
    expect(api.ontologySearch).not.toHaveBeenCalled()
    expect(api.runSparqlQuery).not.toHaveBeenCalled()
  })
})

// spec: OVERSTORY-APPS-R049.1.8
describe('attended query editor tools', () => {
  const invoke = (name: string, input = {}) =>
    state.tools.get(`agent-webui.explore.${name}`)!.execute(input, { signal: new AbortController().signal })
  it('edits without execution and requires visible confirmation for submission', async () => {
    renderWithProviders(surface())
    await act(async () => {
      await invoke('edit-query', { text: 'SELECT ?review WHERE {}' })
    })
    expect(screen.getByRole('textbox', { name: 'SPARQL query' })).toHaveValue('SELECT ?review WHERE {}')
    expect(api.runSparqlQuery).not.toHaveBeenCalled()
    await act(async () => {
      await invoke('request-query-submission')
    })
    expect(screen.getByRole('dialog')).toHaveTextContent('SELECT ?review WHERE {}')
    expect(api.runSparqlQuery).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel submission' }))
    expect(api.runSparqlQuery).not.toHaveBeenCalled()
    await act(async () => {
      await invoke('request-query-submission')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm provider submission' }))
    expect(screen.getByRole('alert')).toHaveTextContent('browser interaction')
    expect(api.runSparqlQuery).not.toHaveBeenCalled()
  })
  it('refuses same-tick old handles after an edit and stale review after manual changes', async () => {
    renderWithProviders(surface())
    const held = state.tools.get('agent-webui.explore.request-query-submission')!
    await act(async () => {
      await invoke('edit-query', { text: 'SELECT ?fresh WHERE {}' })
      await expect(held.execute({}, { signal: new AbortController().signal })).rejects.toThrow('stale')
    })
    await act(async () => {
      await invoke('request-query-submission')
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'SPARQL query', hidden: true }), {
      target: { value: 'SELECT ?changed WHERE {}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm provider submission' }))
    expect(screen.getByRole('alert')).toHaveTextContent('browser interaction')
    expect(api.runSparqlQuery).not.toHaveBeenCalled()
  })
  it('retires review and held tool after owner change', async () => {
    const view = renderWithProviders(surface())
    const held = state.tools.get('agent-webui.explore.edit-query')!
    await act(async () => {
      await invoke('request-query-submission')
    })
    state.owner = 'owner-b'
    view.rerender(surface())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await expect(
      held.execute({ text: 'SELECT ?old WHERE {}' }, { signal: new AbortController().signal }),
    ).rejects.toThrow('stale')
    expect(api.runSparqlQuery).not.toHaveBeenCalled()
  })
  it('uses the existing validation callback only after review', async () => {
    renderWithProviders(surface())
    fireEvent.click(screen.getByRole('link', { name: 'Check data schema' }))
    await act(async () => {
      await invoke('edit-query', { text: 'candidate', sourceType: 'text' })
    })
    await act(async () => {
      await invoke('request-query-submission')
    })
    expect(api.validateOntologyCandidate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm provider submission' }))
    expect(api.validateOntologyCandidate).not.toHaveBeenCalled()
  })
})

// spec: OVERSTORY-APPS-R049.2.1
it('leaves evidence focus with the integrated journey through StrictMode close and reselection', async () => {
  window.history.replaceState({}, '', '/workspace/explore?q=retained&entity=a')
  renderWithProviders(<StrictMode>{surface()}</StrictMode>)
  expect(await screen.findByRole('heading', { name: 'a' })).not.toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Close record details' }))
  expect(screen.getByRole('textbox', { name: 'Search knowledge' })).toHaveFocus()
  expect(screen.getByRole('textbox', { name: 'Search knowledge' })).toHaveValue('retained')
  act(() => {
    window.history.pushState({}, '', '/workspace/explore?q=retained&entity=a')
    window.dispatchEvent(new Event('history-state-changed'))
  })
  expect(await screen.findByRole('heading', { name: 'a' })).toHaveFocus()
  openAdvanced()
  fireEvent.click(screen.getByRole('link', { name: 'Query stored data (SPARQL)' }))
  expect(screen.getByRole('heading', { name: 'Knowledge' })).toHaveFocus()
  fireEvent.click(screen.getByRole('link', { name: 'Stored records' }))
  expect(screen.getByRole('heading', { name: 'a' })).toHaveFocus()
})
