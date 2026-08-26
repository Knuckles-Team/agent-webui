import { describe, expect, it } from 'vitest'

import { buildModel, neighbourhood, neighbours, type Graph3DPayload } from '../model'
import { sphereDetail } from '../scene'

function payload(
  nodes: { id: string; type: string; name: string }[],
  edges: [number, number, string][],
): Graph3DPayload {
  return {
    nodes,
    edges: edges.map(([s, t, r]) => ({ s, t, r, w: 1 })),
    total_nodes: nodes.length,
    total_relationships: edges.length,
    connected_nodes: nodes.length,
    isolated_nodes: 0,
    truncated: false,
    source_graphs: ['tenant'],
    degraded_graphs: [],
    available: true,
  }
}

// A -> B -> C, plus A -> D. D and C are leaves; A has degree 2, B degree 2.
const CHAIN = payload(
  [
    { id: 'a', type: 'Skill', name: 'A' },
    { id: 'b', type: 'WorkflowStep', name: 'B' },
    { id: 'c', type: 'WorkflowStep', name: 'C' },
    { id: 'd', type: 'Skill', name: 'D' },
  ],
  [
    [0, 1, 'USES_SKILL'],
    [1, 2, 'TRANSITION_TO'],
    [0, 3, 'USES_SKILL'],
  ],
)

describe('buildModel', () => {
  it('derives undirected degree and a CSR adjacency that agrees with it', () => {
    const model = buildModel(CHAIN)
    expect([...model.degree]).toEqual([2, 2, 1, 1])
    for (let i = 0; i < model.nodes.length; i += 1) {
      expect(model.adjOffset[i + 1] - model.adjOffset[i]).toBe(model.degree[i])
    }
    expect(model.adjTarget.length).toBe(6)
  })

  it('orders type and relationship vocabularies by frequency', () => {
    const model = buildModel(CHAIN)
    expect(model.types).toEqual(['Skill', 'WorkflowStep'])
    expect(model.typeCount).toEqual([2, 2])
    expect(model.relTypes[0]).toBe('USES_SKILL')
    expect(model.relTypeCount[0]).toBe(2)
  })

  it('drops out-of-range and self-loop edges instead of throwing', () => {
    const hostile = payload(
      [{ id: 'a', type: 'Skill', name: 'A' }],
      [
        [0, 0, 'SELF'],
        [0, 99, 'OUT_OF_RANGE'],
        [-1, 0, 'NEGATIVE'],
      ],
    )
    const model = buildModel(hostile)
    expect(model.edges).toHaveLength(0)
    expect([...model.degree]).toEqual([0])
  })

  it('returns an empty model for an empty payload', () => {
    const model = buildModel(payload([], []))
    expect(model.nodes).toHaveLength(0)
    expect(model.adjOffset).toHaveLength(1)
  })
})

describe('neighbourhood', () => {
  it('grows by exactly one hop per step', () => {
    const model = buildModel(CHAIN)
    expect([...neighbourhood(model, 0, 0)]).toEqual([1, 0, 0, 0])
    expect([...neighbourhood(model, 0, 1)]).toEqual([1, 1, 0, 1])
    expect([...neighbourhood(model, 0, 2)]).toEqual([1, 1, 1, 1])
  })

  it('is empty for an out-of-range root', () => {
    const model = buildModel(CHAIN)
    expect([...neighbourhood(model, 42, 3)]).toEqual([0, 0, 0, 0])
  })
})

describe('neighbours', () => {
  it('de-duplicates parallel edges between the same pair', () => {
    const parallel = payload(
      [
        { id: 'a', type: 'Skill', name: 'A' },
        { id: 'b', type: 'Skill', name: 'B' },
      ],
      [
        [0, 1, 'ONE'],
        [0, 1, 'TWO'],
      ],
    )
    const model = buildModel(parallel)
    expect(model.degree[0]).toBe(2)
    expect(neighbours(model, 0)).toEqual([1])
  })
})

describe('sphereDetail', () => {
  it('drops tessellation as the node count grows, and never below detail 0', () => {
    // The renderer's one cost that scales with N. Detail 2 is 320 triangles
    // per node, 1 is 80, 0 is 20 -- so these thresholds are what keeps the
    // whole-graph triangle budget bounded instead of linear in node count.
    expect(sphereDetail(0)).toBe(2)
    expect(sphereDetail(800)).toBe(2)
    expect(sphereDetail(801)).toBe(1)
    expect(sphereDetail(20_000)).toBe(1)
    expect(sphereDetail(20_001)).toBe(0)
    expect(sphereDetail(5_000_000)).toBe(0)
  })
})
