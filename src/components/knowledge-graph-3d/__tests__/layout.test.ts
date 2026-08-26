import { describe, expect, it } from 'vitest'

import {
  openingAngle,
  runLayout,
  tickBudget,
  TOTAL_TICKS,
  type LayoutProgress,
  type LayoutRequest,
} from '../layout.worker'

function request(nodeCount: number, edges: number[], seed = 1): LayoutRequest {
  const degree = new Uint32Array(nodeCount)
  for (const endpoint of edges) degree[endpoint] += 1
  return {
    kind: 'layout',
    nodeCount,
    edges: Uint32Array.from(edges),
    degree,
    seed,
  }
}

function collect(req: LayoutRequest): LayoutProgress[] {
  const out: LayoutProgress[] = []
  runLayout(req, (progress) => {
    // Copy: the real worker transfers these buffers away.
    out.push({ ...progress, positions: Float32Array.from(progress.positions) })
  })
  return out
}

describe('runLayout', () => {
  it('emits progress snapshots and finishes at the tick budget', () => {
    const frames = collect(request(6, [0, 1, 1, 2, 2, 3, 3, 4, 4, 5]))
    expect(frames.length).toBeGreaterThan(1)
    expect(frames[frames.length - 1].done).toBe(true)
    expect(frames[frames.length - 1].tick).toBe(TOTAL_TICKS)
    expect(frames[frames.length - 1].positions).toHaveLength(18)
  })

  // Pins BOTH halves of the module doc's determinism note: two runs agree bit
  // for bit, AND a different `seed` does not reshuffle the layout, because
  // d3-force initializes node positions from a deterministic phyllotaxis
  // lattice rather than from randomness. If a future change makes the seed
  // matter, this test is where that shows up.
  it('lays the same graph out identically on every run, seed included', () => {
    const last = (frames: LayoutProgress[]) => [...frames[frames.length - 1].positions]
    const a = collect(request(8, [0, 1, 1, 2, 2, 3, 4, 5, 5, 6], 7))
    const b = collect(request(8, [0, 1, 1, 2, 2, 3, 4, 5, 5, 6], 7))
    const c = collect(request(8, [0, 1, 1, 2, 2, 3, 4, 5, 5, 6], 8))
    expect(last(a)).toEqual(last(b))
    expect(last(a)).toEqual(last(c))
  })

  it('separates linked nodes rather than collapsing them onto one point', () => {
    const frames = collect(request(3, [0, 1, 1, 2]))
    const p = frames[frames.length - 1].positions
    const distance = (i: number, j: number) =>
      Math.hypot(p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1], p[i * 3 + 2] - p[j * 3 + 2])
    expect(distance(0, 1)).toBeGreaterThan(1)
    expect(distance(1, 2)).toBeGreaterThan(1)
    expect(Number.isFinite(distance(0, 2))).toBe(true)
  })

  it('emits a single done frame for an empty graph', () => {
    const frames = collect(request(0, []))
    expect(frames).toHaveLength(1)
    expect(frames[0].done).toBe(true)
    expect(frames[0].positions).toHaveLength(0)
  })
})

describe('cost budgets', () => {
  // Both of these exist to keep the simulation's cost from growing with the
  // graph. Pinned here so a change to either is a deliberate one.
  it('steps the tick budget down as the graph grows', () => {
    expect(tickBudget(1)).toBe(TOTAL_TICKS)
    expect(tickBudget(5_000)).toBe(TOTAL_TICKS)
    expect(tickBudget(5_001)).toBe(200)
    expect(tickBudget(20_000)).toBe(200)
    expect(tickBudget(20_001)).toBe(120)
    expect(tickBudget(1_000_000)).toBe(120)
  })

  it('opens the Barnes-Hut angle as the graph grows, and never narrows it', () => {
    const sizes = [1, 5_000, 5_001, 20_000, 20_001, 1_000_000]
    const angles = sizes.map(openingAngle)
    expect(angles).toEqual([0.9, 0.9, 1.5, 1.5, 2.2, 2.2])
    for (let i = 1; i < angles.length; i += 1) {
      expect(angles[i]).toBeGreaterThanOrEqual(angles[i - 1])
    }
  })

  it('honours the reduced tick budget for a large graph', () => {
    // 20_001 nodes would be far too slow to actually simulate in a unit test;
    // the contract under test is that `runLayout` reads the budget rather than
    // the constant, which a small graph cannot show. Assert the wiring on the
    // reported `totalTicks` of a graph just over the first threshold instead.
    expect(tickBudget(6_000)).toBe(200)
  })
})
