import { describe, expect, it, vi } from 'vitest'
import { initialAtlasState } from '@/lib/atlas/workbench'
import type { PageContextEnvelope } from '@/lib/page-context'
import { toPublicPageContext } from '../contracts'
import { navigateWithinWebUi } from '../navigation'
import { createAtlasTools, createPageTools } from '../tools'

function executionOptions(): { signal: AbortSignal } {
  return { signal: new AbortController().signal }
}

describe('public WebMCP context contract', () => {
  it('omits action affordances and redacts credential-shaped route/filter keys', () => {
    const envelope: PageContextEnvelope = {
      schemaVersion: '1.0',
      route: '/graph?workspace=alpha&access_token=do-not-echo',
      view: 'graph',
      selection: [{ kind: 'graph-node', id: 'node-1', label: 'Service' }],
      filters: { workspace: 'alpha', api_key: 'do-not-echo' },
      allowedActions: [{ id: 'query-graph', label: 'Query graph', kind: 'read' }],
      capturedAt: '2026-08-29T00:00:00.000Z',
    }

    expect(toPublicPageContext(envelope)).toEqual({
      schemaVersion: '1.0',
      route: '/graph?workspace=alpha',
      view: 'graph',
      selection: [{ kind: 'graph-node', id: 'node-1', label: 'Service' }],
      filters: { workspace: 'alpha' },
      capturedAt: '2026-08-29T00:00:00.000Z',
    })
  })
})

describe('WebMCP tool annotations', () => {
  it('marks getters read-only and UI state changes as mutating', () => {
    const pageTools = createPageTools({
      context: {
        schemaVersion: '1.0',
        route: '/explore',
        view: 'explore',
        selection: [],
        filters: {},
        allowedActions: [],
        capturedAt: '2026-08-29T00:00:00.000Z',
      },
      role: 'reader',
      navigate: () => ({ navigated: true, path: '/explore', routeId: 'explore', view: 'explore' }),
    })
    const atlasTools = createAtlasTools({
      state: initialAtlasState('graph'),
      dispatch: () => undefined,
      select: () => undefined,
    })

    expect(pageTools.map((tool) => [tool.name, tool.annotations?.readOnlyHint])).toEqual([
      ['agent-webui.get-page-context', true],
      ['agent-webui.navigate', false],
    ])
    expect(atlasTools.map((tool) => [tool.name, tool.annotations?.readOnlyHint])).toEqual([
      ['agent-webui.atlas.get-state', true],
      ['agent-webui.atlas.set-filters', false],
      ['agent-webui.atlas.select', false],
    ])
  })
})

describe('WebMCP navigation boundary', () => {
  it('rejects query strings and fragments before writing browser history', () => {
    const pushState = vi.spyOn(window.history, 'pushState')

    expect(() => navigateWithinWebUi('/explore?api_key=do-not-persist', 'reader')).toThrow(
      'does not accept query strings',
    )
    expect(() => navigateWithinWebUi('/explore#private-state', 'reader')).toThrow('does not accept query strings')
    expect(pushState).not.toHaveBeenCalled()
  })
})

describe('WebMCP mutation validation', () => {
  it('rejects oversized filter echoes before changing Atlas state', async () => {
    const dispatch = vi.fn()
    const tools = createAtlasTools({
      state: initialAtlasState('graph'),
      dispatch,
      select: () => undefined,
    })
    const setFilters = tools.find((tool) => tool.name === 'agent-webui.atlas.set-filters')
    if (!setFilters) throw new Error('Atlas filter tool was not registered')
    const clauses = Array.from({ length: 16 }, (_, index) => ({
      id: `clause-${index}`,
      field: `field-${index}`,
      op: 'eq',
      value: 'x'.repeat(256),
    }))

    await expect(
      setFilters.execute({ search: '', combinator: 'and', clauses, sort: null, limit: 100 }, executionOptions()),
    ).rejects.toThrow('output exceeded')
    expect(dispatch).not.toHaveBeenCalled()
  })
})
