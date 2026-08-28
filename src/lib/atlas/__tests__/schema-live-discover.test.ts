import { describe, expect, it, vi } from 'vitest'

import { isModalityAdapter } from '../adapter'
import { atlasAdapters, discoverAdapters, resetAdapterDiscovery } from '../discover'
import { createLiveController, INITIAL_LIVE_CURSOR, type LiveSource } from '../live'
import { Registry } from '../registry'
import { collectFields, countSchemaNodes, fieldType, searchSchema } from '../schema'
import { DEFAULT_ATLAS_CONTEXT, type SchemaNode, type SchemaTree } from '../types'
import type { ModalityAdapter } from '../adapter'

const roots: SchemaNode[] = [
  {
    id: 'types',
    label: 'Node types',
    kind: 'source',
    children: [
      { id: 'type:Service', label: 'Service', kind: 'collection', count: 3 },
      { id: 'type:Host', label: 'Host', kind: 'collection', count: 1 },
    ],
  },
  {
    id: 'fields',
    label: 'Fields',
    kind: 'source',
    children: [
      { id: 'name', label: 'name', kind: 'field', dataType: 'string' },
      { id: 'degree', label: 'degree', kind: 'field', dataType: 'number' },
    ],
  },
]

const tree: SchemaTree = { adapterId: 'graph', roots, unavailable: false }

describe('schema helpers', () => {
  it('collects only field nodes', () => {
    expect(collectFields(tree).map((node) => node.id)).toEqual(['name', 'degree'])
  })

  it('resolves a declared field type and falls back to unknown', () => {
    const fields = collectFields(tree)
    expect(fieldType(fields, 'degree')).toBe('number')
    expect(fieldType(fields, 'nope')).toBe('unknown')
  })

  it('keeps a matching branch in context and prunes the rest', () => {
    const pruned = searchSchema(roots, 'Host')
    expect(pruned).toHaveLength(1)
    expect(pruned[0].children).toHaveLength(1)
  })

  it('returns everything for an empty query', () => {
    expect(searchSchema(roots, '  ')).toHaveLength(2)
  })

  it('counts every node in the tree', () => {
    expect(countSchemaNodes(roots)).toBe(6)
  })
})

describe('isModalityAdapter', () => {
  it('rejects a module that is not an adapter', () => {
    expect(isModalityAdapter(null)).toBe(false)
    expect(isModalityAdapter({ id: 'x' })).toBe(false)
    expect(isModalityAdapter({ id: '', label: 'x' })).toBe(false)
  })
})

describe('adapter discovery', () => {
  it('finds every adapter file and rejects nothing valid', () => {
    resetAdapterDiscovery()
    const found = atlasAdapters()
    expect(found.length).toBeGreaterThanOrEqual(2)
    expect(found.map((adapter) => adapter.id)).toContain('graph')
    expect(found.map((adapter) => adapter.id)).toContain('sparql')
    expect(found.every((adapter) => isModalityAdapter(adapter))).toBe(true)
  })

  it('gives every adapter a unique id, so one cannot silently shadow another', () => {
    const ids = atlasAdapters().map((adapter) => adapter.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('registers into whichever registry it is given, idempotently', () => {
    const registry = new Registry<ModalityAdapter>()
    discoverAdapters(registry)
    const size = registry.size
    discoverAdapters(registry)
    expect(registry.size).toBe(size)
  })
})

describe('createLiveController', () => {
  function source(overrides: Partial<LiveSource> = {}): LiveSource {
    return {
      mode: 'poll',
      intervalMs: 10,
      poll: vi.fn(() => Promise.resolve({ result: null, cursor: { token: 't1', gap: false }, changed: false })),
      ...overrides,
    }
  }

  it('polls on tick and advances the cursor', async () => {
    const live = source()
    const updates: unknown[] = []
    const controller = createLiveController({
      source: live,
      query: {},
      ctx: DEFAULT_ATLAS_CONTEXT,
      onUpdate: (update) => updates.push(update),
      onError: () => undefined,
      isVisible: () => true,
    })
    await controller.tick()
    expect(updates).toHaveLength(1)
    expect(live.poll).toHaveBeenCalledWith(
      expect.objectContaining({ query: {}, cursor: INITIAL_LIVE_CURSOR, ctx: DEFAULT_ATLAS_CONTEXT }),
    )
    await controller.tick()
    expect(live.poll).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: { token: 't1', gap: false } }))
    controller.stop()
  })

  it('does not poll a hidden tab', async () => {
    const live = source()
    const controller = createLiveController({
      source: live,
      query: {},
      ctx: DEFAULT_ATLAS_CONTEXT,
      onUpdate: () => undefined,
      onError: () => undefined,
      isVisible: () => false,
    })
    await controller.tick()
    expect(live.poll).not.toHaveBeenCalled()
  })

  it('reports a poll failure without throwing', async () => {
    const errors: unknown[] = []
    const controller = createLiveController({
      source: source({ poll: () => Promise.reject(new Error('nope')) }),
      query: {},
      ctx: DEFAULT_ATLAS_CONTEXT,
      onUpdate: () => undefined,
      onError: (error) => errors.push(error),
      isVisible: () => true,
    })
    await controller.tick()
    expect(errors).toHaveLength(1)
  })

  it('never starts a timer for a non-live source', () => {
    const spy = vi.spyOn(global, 'setInterval')
    const controller = createLiveController({
      source: source({ mode: 'none' }),
      query: {},
      ctx: DEFAULT_ATLAS_CONTEXT,
      onUpdate: () => undefined,
      onError: () => undefined,
    })
    controller.start()
    expect(spy).not.toHaveBeenCalled()
    controller.stop()
    spy.mockRestore()
  })
})
