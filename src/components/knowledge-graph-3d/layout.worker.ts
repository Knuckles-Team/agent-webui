/**
 * @file layout.worker.ts
 * @description 3D force-directed layout, off the main thread.
 *
 * WHY A WORKER: a force simulation is O(n log n) per tick (Barnes-Hut) and
 * wants hundreds of ticks. Running that on the main thread is exactly the
 * stutter this view exists to avoid -- the render loop must keep its 16.6 ms
 * budget while the graph is still settling. The worker instead ticks the
 * simulation as fast as it can and posts a fresh `Float32Array` of xyz
 * positions every `POST_EVERY` ticks; the renderer lerps toward the newest one
 * it has. The layout arriving progressively is not a compromise, it is the
 * nice part: the graph visibly unfolds instead of popping into place.
 *
 * WHY `d3-force-3d` (MIT) RATHER THAN HAND-ROLLED PHYSICS: it is the 3D port
 * of d3-force, with a real Barnes-Hut octree (`forceManyBody().theta()`), and
 * it is the same simulation the reference implementations this view was
 * modelled on use. Hand-rolling an octree here would be a worse version of a
 * small, well-tested dependency.
 *
 * DETERMINISM: the same graph must lay out the same way on every reload, or
 * the view is impossible to build a memory of. d3-force's own node
 * initialization already gives that for free -- it seeds initial positions
 * from a deterministic phyllotaxis lattice indexed by node order, NOT from
 * randomness -- and `randomSource` is wired to a splitmix32 PRNG so the one
 * place the library does draw random numbers (jiggling nodes that land on
 * exactly the same coordinate) is deterministic too. Verified by
 * `__tests__/layout.test.ts`: two runs of the same graph agree bit for bit.
 * Note the consequence, which the tests also pin: changing `seed` does NOT
 * reshuffle the layout, because the lattice does not consult it.
 */

import { forceCenter, forceLink, forceManyBody, forceSimulation } from 'd3-force-3d'

/** Start a layout. Transferred in; the worker owns the arrays afterwards. */
export interface LayoutRequest {
  kind: 'layout'
  nodeCount: number
  /** Flat `[s0, t0, s1, t1, ...]` edge endpoints. */
  edges: Uint32Array
  /** Undirected degree per node, used to scale repulsion and link distance. */
  degree: Uint32Array
  seed: number
}

/** A layout snapshot: `positions` is `[x0,y0,z0, x1,y1,z1, ...]`. */
export interface LayoutProgress {
  kind: 'progress'
  positions: Float32Array
  tick: number
  totalTicks: number
  done: boolean
}

/** Tick budget for a small graph, where a full settle is cheap. */
export const TOTAL_TICKS = 320

/**
 * Tick budget by node count.
 *
 * ★ THE LOD LADDER HAS TO BOUND LAYOUT WORK, NOT JUST DRAW CALLS. The renderer
 * is already O(1) in draw calls at any size, so the only thing that grows with
 * N is the simulation: Barnes-Hut is O(n log n) PER TICK, and a fixed 320-tick
 * budget therefore has super-linear total cost. Stepping the budget down keeps
 * time-to-settled inside a few seconds across the whole size range instead of
 * letting a large graph sit there computing.
 *
 * This is the same principle `epistemic-graph`'s own
 * `crates/eg-viz-export/src/graph_layout.rs` states for its static export path,
 * where it is applied far more aggressively: above `FULL_LAYOUT_NODE_CAP`
 * (2,000 nodes) that module abandons force-directed physics ENTIRELY for a
 * seeded hash spread. This worker keeps real physics at every size and pays for
 * it with fewer iterations, which is the right trade for an interactive view:
 * a slightly less relaxed layout still reads as a graph, a hash spread does not.
 */
export function tickBudget(nodeCount: number): number {
  if (nodeCount <= 5_000) return TOTAL_TICKS
  if (nodeCount <= 20_000) return 200
  return 120
}

/**
 * Barnes-Hut opening angle by node count. Larger = more aggressive far-field
 * approximation = faster.
 *
 * ★ THIS IS THE SINGLE BIGGEST COST LEVER IN THE LAYOUT, measured, not guessed
 * (`d3-force-3d` 3.0.6, this fleet's dev host, ms per `forceManyBody` tick):
 *
 *        theta        2,500 nodes     12,000 nodes
 *        0.9              72 ms           370 ms
 *        1.2              33 ms           206 ms
 *        1.5              22 ms           126 ms
 *        2.0              11 ms            55 ms
 *
 * A 6-7x swing, for an approximation that only affects the FAR field -- the
 * force from a distant cluster, already collapsed to a centroid, already cut
 * off entirely past `distanceMax`. What a viewer actually reads in the picture
 * is link structure and local separation, neither of which theta touches. So
 * accuracy is bought where it is cheap (small graphs) and traded where it is
 * not, rather than shipping one number that is either too slow at 50k or
 * needlessly coarse at 2k.
 */
export function openingAngle(nodeCount: number): number {
  if (nodeCount <= 5_000) return 0.9
  if (nodeCount <= 20_000) return 1.5
  return 2.2
}

/** Post a snapshot this often (in ticks). ~20 snapshots over a full run. */
const POST_EVERY = 16
/** Nominal edge length, in world units. */
const LINK_DISTANCE = 26

/**
 * Every emitted snapshot is rescaled so the 92nd-percentile distance from the
 * centroid is exactly this many world units.
 *
 * WHY: a force layout's absolute scale is an accident of node count and
 * charge strength -- 200 nodes settle into a cloud a few hundred units across,
 * 20,000 into one many thousands across. Without normalization the renderer
 * would have to guess a node radius that works at both, and it cannot: node
 * size is in world units, so the same setting draws golf balls in one graph
 * and invisible specks in the other. Normalizing here means the scene's node
 * sizes, camera distances, and pick radius are calibrated against ONE known
 * world scale for every graph. p92 rather than the maximum for the same reason
 * the camera frames on p92: a few far-flung stragglers must not set the scale.
 */
const CANONICAL_RADIUS = 300

/** splitmix32 — small, deterministic, and enough for layout jitter. */
function splitmix32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x9e3779b9) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad)
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97)
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296
  }
}

export function runLayout(
  request: LayoutRequest,
  emit: (progress: LayoutProgress, transfer: Transferable[]) => void,
): void {
  const { nodeCount, edges, degree, seed } = request
  if (nodeCount === 0) {
    emit({ kind: 'progress', positions: new Float32Array(0), tick: 0, totalTicks: 0, done: true }, [])
    return
  }

  const nodes = Array.from({ length: nodeCount }, (_, index) => ({ index }))
  const links: { source: number; target: number }[] = []
  for (let i = 0; i + 1 < edges.length; i += 2) {
    links.push({ source: edges[i], target: edges[i + 1] })
  }

  const totalTicks = tickBudget(nodeCount)
  const random = splitmix32(seed)
  const simulation = forceSimulation(nodes, 3)
    .randomSource(random)
    .alpha(1)
    .alphaDecay(1 - Math.pow(0.001, 1 / totalTicks))
    .alphaMin(0.001)
    .velocityDecay(0.36)
    .force(
      'charge',
      forceManyBody()
        // Hubs push harder, so a 200-neighbour skill clears room for its
        // neighbourhood instead of being buried inside it.
        .strength((node) => -34 - 6 * Math.sqrt(degree[(node as { index: number }).index] ?? 0))
        .theta(openingAngle(nodeCount))
        // Bounds the far field so one distant component cannot drag the
        // whole graph off-centre.
        .distanceMax(900),
    )
    .force(
      'link',
      forceLink(links)
        .id((node) => (node as { index: number }).index)
        // Edges into a hub are shortened so hubs stay compact and readable
        // rather than exploding into a uniform shell.
        .distance((link) => {
          const s = typeof link.source === 'number' ? link.source : (link.source.index ?? 0)
          const t = typeof link.target === 'number' ? link.target : (link.target.index ?? 0)
          const hub = Math.max(degree[s] ?? 1, degree[t] ?? 1)
          return LINK_DISTANCE / (1 + Math.log10(1 + hub))
        })
        .strength(0.7)
        .iterations(1),
    )
    .force('center', forceCenter(0, 0, 0))
    .stop()

  const positions = () => {
    const out = new Float32Array(nodeCount * 3)
    const simNodes = simulation.nodes()
    let cx = 0
    let cy = 0
    let cz = 0
    for (let i = 0; i < nodeCount; i += 1) {
      const n = simNodes[i]
      out[i * 3] = n.x ?? 0
      out[i * 3 + 1] = n.y ?? 0
      out[i * 3 + 2] = n.z ?? 0
      cx += out[i * 3]
      cy += out[i * 3 + 1]
      cz += out[i * 3 + 2]
    }
    cx /= nodeCount
    cy /= nodeCount
    cz /= nodeCount
    const radii = new Float64Array(nodeCount)
    for (let i = 0; i < nodeCount; i += 1) {
      const dx = out[i * 3] - cx
      const dy = out[i * 3 + 1] - cy
      const dz = out[i * 3 + 2] - cz
      out[i * 3] = dx
      out[i * 3 + 1] = dy
      out[i * 3 + 2] = dz
      radii[i] = Math.sqrt(dx * dx + dy * dy + dz * dz)
    }
    radii.sort()
    const p92 = radii[Math.floor((nodeCount - 1) * 0.92)]
    const scale = p92 > 1e-6 ? CANONICAL_RADIUS / p92 : 1
    for (let i = 0; i < out.length; i += 1) out[i] *= scale
    return out
  }

  for (let tick = 1; tick <= TOTAL_TICKS; tick += 1) {
    simulation.tick(1)
    const done = tick === TOTAL_TICKS
    if (done || tick % POST_EVERY === 0) {
      const snapshot = positions()
      emit({ kind: 'progress', positions: snapshot, tick, totalTicks: TOTAL_TICKS, done }, [snapshot.buffer])
    }
  }
}

// Worker entry point. Guarded so the module can be imported by unit tests
// (which call `runLayout` directly) without a `self.onmessage` global.
/**
 * The slice of the dedicated-worker global this file uses. Declared here
 * because the app's `tsconfig` `lib` is DOM-only (this is the one module that
 * runs off the main thread), so `DedicatedWorkerGlobalScope` is not in scope.
 */
interface WorkerScope {
  postMessage: (message: LayoutProgress, transfer: Transferable[]) => void
  onmessage: ((event: MessageEvent<unknown>) => void) | null
}

const workerScope = globalThis as unknown as Partial<WorkerScope>
if (typeof workerScope.postMessage === 'function') {
  const post = workerScope.postMessage.bind(workerScope)
  workerScope.onmessage = (event: MessageEvent<unknown>) => {
    // The message crosses a structured-clone boundary, so it is validated
    // here rather than trusted from the `postMessage` call site's types.
    const request = event.data as Partial<LayoutRequest> | null
    if (request?.kind !== 'layout') return
    if (typeof request.nodeCount !== 'number' || !request.edges || !request.degree) return
    runLayout(request as LayoutRequest, post)
  }
}
