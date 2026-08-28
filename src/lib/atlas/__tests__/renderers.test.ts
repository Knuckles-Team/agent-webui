import { describe, expect, it } from 'vitest'
import { Circle } from 'lucide-react'

import type { ModalityAdapter } from '../adapter'
import { Registry } from '../registry'
import {
  acceptingRenderers,
  projectResult,
  selectRenderer,
  type AtlasRenderer,
  type ResultProjection,
} from '../renderers'
import type { ResultSet, RowSet } from '../types'
import { EMPTY_ROW_SET } from '../types'

function result(shape: ResultSet['shape'] = 'rows'): ResultSet<{ n: number }> {
  return {
    adapterId: 'fake',
    shape,
    payload: { n: 1 },
    stats: { elapsedMs: 1, rowCount: 1, truncated: false },
    degraded: null,
    sources: [],
  }
}

const rows: RowSet = { columns: [{ key: 'a', label: 'a', type: 'string' }], rows: [{ a: '1' }] }

const stubAdapter = {
  toRows: () => rows,
  toGraph: () => ({ nodes: [{ id: 'x', label: 'x', type: 't' }], edges: [], truncated: false }),
} as unknown as ModalityAdapter<unknown, { n: number }>

function renderer(id: string, priority: number, accepts: boolean, prefers?: ResultSet['shape'][]): AtlasRenderer {
  return {
    id,
    label: id,
    icon: Circle,
    priority,
    prefers,
    accepts: () => accepts,
    component: () => null,
  }
}

describe('projectResult', () => {
  it('derives rows and graph once', () => {
    const projection = projectResult(stubAdapter, result())
    expect(projection.rows.rows).toHaveLength(1)
    expect(projection.graph?.nodes).toHaveLength(1)
  })

  it('leaves graph null when the adapter has no toGraph', () => {
    const noGraph = { toRows: () => rows } as unknown as ModalityAdapter<unknown, { n: number }>
    expect(projectResult(noGraph, result()).graph).toBeNull()
  })

  it('degrades rather than crashing when a projection throws', () => {
    const broken = {
      toRows: () => {
        throw new Error('bad rows')
      },
      toGraph: () => {
        throw new Error('bad graph')
      },
    } as unknown as ModalityAdapter<unknown, { n: number }>
    const projection = projectResult(broken, result())
    expect(projection.rows).toEqual(EMPTY_ROW_SET)
    expect(projection.graph).toBeNull()
  })
})

describe('renderer selection', () => {
  const projection: ResultProjection = projectResult(stubAdapter, result())

  it('ranks by priority and drops non-accepting renderers', () => {
    const registry = new Registry<AtlasRenderer>()
    registry.registerAll([renderer('low', 10, true), renderer('high', 90, true), renderer('no', 99, false)])
    expect(acceptingRenderers(projection, registry).map((entry) => entry.id)).toEqual(['high', 'low'])
  })

  it('promotes a renderer that prefers this result shape', () => {
    const registry = new Registry<AtlasRenderer>()
    registry.registerAll([renderer('high', 90, true), renderer('preferring', 10, true, ['rows'])])
    expect(selectRenderer(projection, null, registry)?.id).toBe('preferring')
  })

  it('honours the user choice while it still accepts', () => {
    const registry = new Registry<AtlasRenderer>()
    registry.registerAll([renderer('high', 90, true), renderer('chosen', 10, true)])
    expect(selectRenderer(projection, 'chosen', registry)?.id).toBe('chosen')
  })

  it('falls back when the user choice cannot draw this result', () => {
    const registry = new Registry<AtlasRenderer>()
    registry.registerAll([renderer('high', 90, true), renderer('chosen', 10, false)])
    expect(selectRenderer(projection, 'chosen', registry)?.id).toBe('high')
  })

  it('treats a throwing accepts() as a decline instead of crashing the page', () => {
    const registry = new Registry<AtlasRenderer>()
    const throwing: AtlasRenderer = {
      ...renderer('boom', 99, true),
      accepts: () => {
        throw new Error('boom')
      },
    }
    registry.registerAll([throwing, renderer('safe', 1, true)])
    expect(selectRenderer(projection, null, registry)?.id).toBe('safe')
  })

  it('returns null when nothing accepts', () => {
    expect(selectRenderer(projection, null, new Registry<AtlasRenderer>())).toBeNull()
  })
})

describe('Registry', () => {
  it('is idempotent by id and preserves insertion order', () => {
    const registry = new Registry<AtlasRenderer>()
    registry.register(renderer('a', 1, true))
    registry.register(renderer('b', 1, true))
    registry.register(renderer('a', 2, true))
    expect(registry.list().map((entry) => entry.id)).toEqual(['a', 'b'])
    expect(registry.get('a')?.priority).toBe(2)
    expect(registry.size).toBe(2)
    expect(registry.has('b')).toBe(true)
    expect(registry.get(null)).toBeNull()
    registry.clear()
    expect(registry.size).toBe(0)
  })
})
