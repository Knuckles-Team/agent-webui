import { describe, expect, it } from 'vitest'

import { runLayout, TOTAL_TICKS, type LayoutProgress, type LayoutRequest } from '../layout.worker'

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
