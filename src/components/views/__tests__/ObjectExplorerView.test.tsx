import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'

import ObjectExplorerView, {
  deriveColumns,
  defaultOpenObject,
  isBulkApplicableAction,
  type ObjectSetResult,
} from '@/components/views/ObjectExplorerView'
import { api } from '@/lib/api'
import { renderWithProviders } from '@/__tests__/fixtures'

/**
 * ObjectExplorerView unit + integration coverage.
 *
 * This suite drives the REAL component handlers through `renderWithProviders`
 * (real QueryClientProvider) against the REAL `api` singleton — it does NOT
 * replace `@/lib/api` with a hand-written object that could silently hide a
 * missing or renamed method. Instead each consumed method is stubbed with
 * `vi.spyOn(api, name).mockResolvedValue(...)`, so if the component reaches for
 * a method the real `ApiClient` does not define, the spy setup throws and the
 * test fails. That is exactly the wiring break this fix closes (e.g. the
 * `action_name` payload key and the dynamic action / saved-set methods).
 */

const baseResult: ObjectSetResult = {
  total: 2,
  columns: ['status'],
  objects: [
    { id: 'obj-1', type: 'Document', title: 'Alpha', properties: { status: 'open' } },
    { id: 'obj-2', type: 'Concept', title: 'Beta', properties: { status: 'closed' } },
  ],
}

beforeEach(() => {
  // Spy on the REAL singleton. A missing/renamed method makes vi.spyOn throw,
  // surfacing the wiring break instead of hiding it behind a fake module.
  vi.spyOn(api, 'ontologySearch').mockResolvedValue(baseResult)
  vi.spyOn(api, 'ontologySearchAround').mockResolvedValue({
    total: 1,
    objects: [{ id: 'rel-9', type: 'Repository', title: 'Linked' }],
  })
  vi.spyOn(api, 'ontologyPivot').mockResolvedValue({
    total: 1,
    objects: [{ id: 'piv-1', type: 'Function', title: 'Pivoted' }],
  })
  vi.spyOn(api, 'ontologyAggregate').mockResolvedValue([{ key: 'Document', count: 5 }])
  vi.spyOn(api, 'ontologyObjectSetAction').mockResolvedValue({ applied: 1, results: [], errors: [] })
  vi.spyOn(api, 'ontologySaveObjectSet').mockResolvedValue({ id: 'set-1', name: 'set', count: 0 })
  // Dynamic bulk-action menu: a mutation action (offered) + a read action
  // (must be filtered out by the component).
  vi.spyOn(api, 'listOntologyActions').mockResolvedValue([
    {
      name: 'kg.annotate_concept',
      verb: 'annotate',
      description: 'Annotate a concept',
      produces_effect: 'mutation',
      required_capability: 'kg_write',
      acts_on: ['concept'],
    },
    {
      name: 'kg.search',
      verb: 'search',
      description: 'Read-only search',
      produces_effect: 'read',
      required_capability: 'kg_read',
      acts_on: ['concept'],
    },
  ])
  vi.spyOn(api, 'listSavedObjectSets').mockResolvedValue([
    { id: 'set-1', name: 'My Concepts', count: 4, kind: 'Concept', shared: false },
  ])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ObjectExplorerView (component handlers, real api singleton)', () => {
  it('issues the initial object-set search and loads actions/saved-sets on mount', async () => {
    renderWithProviders(<ObjectExplorerView />)
    await waitFor(() => {
      expect(api.ontologySearch).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(api.listOntologyActions).toHaveBeenCalled()
      expect(api.listSavedObjectSets).toHaveBeenCalled()
    })
  })

  it('"Save Set" button drives api.ontologySaveObjectSet with the prompted name', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('my saved set')
    renderWithProviders(<ObjectExplorerView />)

    fireEvent.click(screen.getByRole('button', { name: /save set/i }))

    await waitFor(() => {
      expect(api.ontologySaveObjectSet).toHaveBeenCalledTimes(1)
    })
    const arg = vi.mocked(api.ontologySaveObjectSet).mock.calls[0][0]
    expect(arg.name).toBe('my saved set')
    promptSpy.mockRestore()
  })

  it('"Apply action" drives api.ontologyObjectSetAction with the action_name key and selection', async () => {
    renderWithProviders(<ObjectExplorerView />)

    // Wait for the result rows + the dynamic action menu to populate.
    const rowCheckbox = await screen.findByLabelText('Select obj-1')
    fireEvent.click(rowCheckbox)

    fireEvent.click(screen.getByRole('button', { name: /apply action/i }))

    await waitFor(() => {
      expect(api.ontologyObjectSetAction).toHaveBeenCalledTimes(1)
    })
    const arg = vi.mocked(api.ontologyObjectSetAction).mock.calls[0][0]
    expect(arg.ids).toContain('obj-1')
    // The aligned payload key the backend route reads.
    expect(arg).toHaveProperty('action_name')
    // The offered action is a REAL registered mutation action — never a fake.
    expect(arg.action_name).toBe('kg.annotate_concept')
  })

  it('"Search around" button drives api.ontologySearchAround over the selection', async () => {
    renderWithProviders(<ObjectExplorerView />)
    const rowCheckbox = await screen.findByLabelText('Select obj-2')
    fireEvent.click(rowCheckbox)

    fireEvent.click(screen.getByRole('button', { name: /search around/i }))

    await waitFor(() => {
      expect(api.ontologySearchAround).toHaveBeenCalledTimes(1)
    })
    const arg = vi.mocked(api.ontologySearchAround).mock.calls[0][0]
    expect(arg.ids).toContain('obj-2')
  })

  it('loading a saved set narrows the search facet and re-runs the search', async () => {
    renderWithProviders(<ObjectExplorerView />)
    // Initial mount search.
    await waitFor(() => {
      expect(api.ontologySearch).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(api.listSavedObjectSets).toHaveBeenCalled()
    })

    const before = vi.mocked(api.ontologySearch).mock.calls.length

    // Open the Saved sets dropdown and pick the saved set.
    fireEvent.click(screen.getByLabelText('Saved sets'))
    const option = await screen.findByText(/My Concepts/)
    fireEvent.click(option)

    // Loading the set re-runs the object-set search scoped to its kind.
    await waitFor(() => {
      expect(vi.mocked(api.ontologySearch).mock.calls.length).toBeGreaterThan(before)
    })
    const lastArg = vi.mocked(api.ontologySearch).mock.calls.at(-1)![0]
    expect(lastArg.object_type).toBe('Concept')
  })
})

describe('ObjectExplorerView (pure helpers + contracts)', () => {
  it('exports a renderable component', () => {
    expect(typeof ObjectExplorerView).toBe('function')
  })

  it('derives table columns from the result envelope', () => {
    expect(deriveColumns(baseResult)).toEqual(['status'])
    expect(
      deriveColumns({
        total: 1,
        objects: [{ id: 'x', type: 'T', properties: { a: 1, b: 2 } }],
      }),
    ).toEqual(['a', 'b'])
    expect(deriveColumns(undefined)).toEqual([])
  })

  it('only offers mutation/external-effect actions as bulk actions', () => {
    expect(
      isBulkApplicableAction({
        name: 'a',
        verb: 'v',
        description: '',
        produces_effect: 'mutation',
        required_capability: 'c',
        acts_on: [],
      }),
    ).toBe(true)
    expect(
      isBulkApplicableAction({
        name: 'b',
        verb: 'v',
        description: '',
        produces_effect: 'external',
        required_capability: 'c',
        acts_on: [],
      }),
    ).toBe(true)
    expect(
      isBulkApplicableAction({
        name: 'c',
        verb: 'v',
        description: '',
        produces_effect: 'read',
        required_capability: 'c',
        acts_on: [],
      }),
    ).toBe(false)
  })

  it('exposes the typed API surface the view consumes on the REAL client', () => {
    // These assertions error if a method is removed/renamed on ApiClient.
    expect(typeof api.ontologySearch).toBe('function')
    expect(typeof api.ontologySearchAround).toBe('function')
    expect(typeof api.ontologyPivot).toBe('function')
    expect(typeof api.ontologyAggregate).toBe('function')
    expect(typeof api.ontologyObjectSetAction).toBe('function')
    expect(typeof api.ontologySaveObjectSet).toBe('function')
    expect(typeof api.listOntologyActions).toBe('function')
    expect(typeof api.listSavedObjectSets).toBe('function')
  })

  it('defaultOpenObject navigates to /object/:id via the history contract', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState')
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    defaultOpenObject('obj-42')
    expect(pushSpy).toHaveBeenCalledWith({}, '', '/object/obj-42')
    expect(dispatchSpy).toHaveBeenCalled()
    pushSpy.mockRestore()
    dispatchSpy.mockRestore()
  })
})
