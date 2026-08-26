/**
 * @file mockGenerator.ts
 * @description Pure, deterministic, STATELESS synthetic hierarchical graph —
 * the data `mockTransport.ts` serves. Split out from the transport so the
 * tree math is unit-testable without touching `AsyncIterable`.
 *
 * ## Why stateless matters
 *
 * A real backend answers `clusters(graph, level, parentClusterId)` /
 * `expand(graph, clusterId)` from persisted clustering output, not from
 * whatever the client happened to fetch earlier in the session. This
 * generator is held to the same bar: every function here recomputes its
 * answer from `(graph scope, cluster id)` alone. Concretely, a cluster's
 * `node_count` is NOT looked up from a tree built in memory — it is
 * re-derived from the ROOT on every call by re-running the same
 * hash-seeded partition down the id's path (`nodeCountForPath`). That is
 * what lets `expand()` be called for a cluster id the caller never fetched
 * via `clusters()` first (mirroring a real server, and a real client that
 * deep-links to a cluster) and still get an answer consistent with what
 * `clusters()` would have said.
 *
 * ## The tree shape
 *
 * `ROOT_CLUSTER_COUNT` top-level clusters partition `TOTAL_LEAVES` real
 * nodes between them (mildly skewed, not a power law — big enough to be
 * interesting, not so skewed a single cluster dwarfs the rest). A cluster
 * recurses into child clusters as long as its own share exceeds
 * `LEAF_THRESHOLD`; below that (or past `MAX_DEPTH` as a hard backstop) it
 * is a LEAF cluster and `expand()` returns real nodes instead of children.
 * Every level's children partition their parent's `node_count` EXACTLY
 * (integer remainder handed out deterministically), so
 * `sum(children.node_count) === parent.node_count` always holds — a
 * property `__tests__/mockGenerator.test.ts` pins directly, and one a real
 * backend's clustering output should have too.
 */

import { pick, randInt, rngFor } from './rng'
import type { ClusterSummary, InterClusterEdge, ExpandEdge, ExpandNode, Centroid } from './contract'

/** Real nodes at/under a cluster before it stops splitting into children. */
export const LEAF_THRESHOLD = 400
/** Hard backstop so a pathological config cannot recurse forever. */
export const MAX_DEPTH = 6
/** Total real (leaf) nodes across the whole synthetic root, by default. */
export const DEFAULT_TOTAL_LEAVES = 1_000_000
/** Default count of level-0 clusters — "a few thousand", per the brief. */
export const DEFAULT_ROOT_CLUSTER_COUNT = 2_200

const NODE_TYPE_VOCAB = [
  'Skill',
  'Agent',
  'Workflow',
  'MCPServer',
  'Concept',
  'RunTrace',
  'Runnable',
  'WorkItem',
  'ToolCall',
  'Dataset',
] as const

const REL_TYPE_VOCAB = ['CALLS', 'BINDS', 'PRODUCES', 'DEPENDS_ON', 'RELATES_TO', 'INVOKES'] as const

export interface MockGeneratorConfig {
  totalLeaves: number
  rootClusterCount: number
  leafThreshold: number
  maxDepth: number
  /** [min, max] child clusters per non-leaf cluster. */
  fanout: [number, number]
  /** World-space radius centroids are spread within. */
  spread: number
  /** Deepest level (inclusive) the generator still hands out a centroid for; deeper levels fall back to local layout. */
  centroidMaxLevel: number
}

export const DEFAULT_MOCK_CONFIG: MockGeneratorConfig = {
  totalLeaves: DEFAULT_TOTAL_LEAVES,
  rootClusterCount: DEFAULT_ROOT_CLUSTER_COUNT,
  leafThreshold: LEAF_THRESHOLD,
  maxDepth: MAX_DEPTH,
  fanout: [3, 9],
  spread: 900,
  centroidMaxLevel: 1,
}

function salt(graph: readonly string[]): string {
  return graph.length === 0 ? 'default' : [...graph].sort().join(',')
}

/** Parse a cluster id back into its root-relative path of child indices. */
function parsePath(clusterId: string): number[] {
  const parts = clusterId.split('/')
  return parts.map((p) => {
    const idx = p.indexOf(':')
    return Number(p.slice(idx + 1))
  })
}

function makeId(path: readonly number[]): string {
  return path.map((index, level) => `L${level}:${index}`).join('/')
}

/** Deterministic fanout for a cluster, given its id. */
function fanoutOf(graphKey: string, clusterId: string, cfg: MockGeneratorConfig): number {
  const rng = rngFor(`${graphKey}|fanout|${clusterId}`)
  return randInt(rng, cfg.fanout[0], cfg.fanout[1])
}

/**
 * Partition `total` integrally across `count` children of `parentId`,
 * weighted by a deterministic per-child draw. Remainders go to the
 * children with the largest fractional share first, so the sum is always
 * exactly `total`.
 */
function partition(graphKey: string, parentId: string, count: number, total: number): number[] {
  if (count <= 0) return []
  if (count === 1) return [total]
  const weights: number[] = []
  for (let i = 0; i < count; i += 1) {
    const rng = rngFor(`${graphKey}|weight|${parentId}|${i}`)
    weights.push(1 + rng() * 9) // mild skew, not a power law
  }
  const sum = weights.reduce((a, b) => a + b, 0)
  const raw = weights.map((w) => (total * w) / sum)
  const floors = raw.map((v) => Math.floor(v))
  let remainder = total - floors.reduce((a, b) => a + b, 0)
  const order = raw
    .map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((a, b) => b.frac - a.frac)
    .map((e) => e.i)
  const out = floors.slice()
  for (let k = 0; k < order.length && remainder > 0; k += 1, remainder -= 1) {
    out[order[k]] += 1
  }
  // Every child gets at least one node, taken from the largest share —
  // avoids a degenerate zero-sized cluster when `total` is small.
  for (let i = 0; i < out.length; i += 1) {
    if (out[i] === 0) {
      const donor = out.indexOf(Math.max(...out))
      out[donor] -= 1
      out[i] = 1
    }
  }
  return out
}

/** Node count for the cluster at `path`, re-derived from the root. */
function nodeCountForPath(graphKey: string, path: readonly number[], cfg: MockGeneratorConfig): number {
  const rootCounts = partition(graphKey, 'ROOT', cfg.rootClusterCount, cfg.totalLeaves)
  let count = rootCounts[path[0]]
  for (let level = 1; level < path.length; level += 1) {
    const parentId = makeId(path.slice(0, level))
    const fanout = fanoutOf(graphKey, parentId, cfg)
    const shares = partition(graphKey, parentId, fanout, count)
    count = shares[path[level]]
  }
  return count
}

/** Is the cluster at `path` (with this many nodes) a leaf cluster? */
function isLeaf(count: number, depth: number, cfg: MockGeneratorConfig): boolean {
  return count <= cfg.leafThreshold || depth >= cfg.maxDepth
}

function centroidFor(graphKey: string, clusterId: string, cfg: MockGeneratorConfig): Centroid {
  const rng = rngFor(`${graphKey}|centroid|${clusterId}`)
  // Uniform-ish point inside a sphere of radius `cfg.spread`, deterministic.
  const u = rng()
  const costheta = rng() * 2 - 1
  const phi = rng() * Math.PI * 2
  const r = cfg.spread * Math.cbrt(u)
  const sintheta = Math.sqrt(1 - costheta * costheta)
  return {
    x: r * sintheta * Math.cos(phi),
    y: r * sintheta * Math.sin(phi),
    z: r * costheta,
  }
}

function labelFor(clusterId: string, count: number): string {
  return `Cluster ${clusterId} (${count.toLocaleString('en-US')})`
}

function topTypesFor(graphKey: string, clusterId: string): string[] {
  const rng = rngFor(`${graphKey}|types|${clusterId}`)
  const n = randInt(rng, 1, 3)
  const chosen = new Set<string>()
  while (chosen.size < n) chosen.add(pick(rng, NODE_TYPE_VOCAB))
  return [...chosen]
}

/** Plausible internal edge count for a cluster of this size — an estimate, not a recount of `expand`'s own edges. */
function edgeCountFor(count: number): number {
  return Math.round(count * 1.8)
}

export interface ClusterNode extends ClusterSummary {
  /** Root-relative depth: 0 at the top. */
  level: number
}

/**
 * The clusters that are children of `parentId` (siblings, one level below
 * `parentId`'s own level) — or the root level's clusters when
 * `parentId` is `undefined`.
 */
export function siblingClusters(
  graph: readonly string[],
  parentId: string | undefined,
  cfg: MockGeneratorConfig = DEFAULT_MOCK_CONFIG,
): { level: number; clusters: ClusterNode[] } {
  const graphKey = salt(graph)
  if (parentId == null) {
    const counts = partition(graphKey, 'ROOT', cfg.rootClusterCount, cfg.totalLeaves)
    const clusters = counts.map((count, index) => {
      const id = makeId([index])
      return {
        id,
        label: labelFor(id, count),
        node_count: count,
        edge_count: edgeCountFor(count),
        centroid: cfg.centroidMaxLevel >= 0 ? centroidFor(graphKey, id, cfg) : null,
        top_node_types: topTypesFor(graphKey, id),
        level: 0,
      }
    })
    return { level: 0, clusters }
  }

  const parentPath = parsePath(parentId)
  const parentDepth = parentPath.length - 1
  const parentCount = nodeCountForPath(graphKey, parentPath, cfg)
  const childDepth = parentDepth + 1
  if (isLeaf(parentCount, parentDepth, cfg)) return { level: childDepth, clusters: [] }

  const fanout = fanoutOf(graphKey, parentId, cfg)
  const shares = partition(graphKey, parentId, fanout, parentCount)
  const clusters = shares.map((count, index) => {
    const path = [...parentPath, index]
    const id = makeId(path)
    return {
      id,
      label: labelFor(id, count),
      node_count: count,
      edge_count: edgeCountFor(count),
      centroid: childDepth <= cfg.centroidMaxLevel ? centroidFor(graphKey, id, cfg) : null,
      top_node_types: topTypesFor(graphKey, id),
      level: childDepth,
    }
  })
  return { level: childDepth, clusters }
}

/** A handful of deterministic edges between siblings, by array index. */
export function interClusterEdges(
  graph: readonly string[],
  parentId: string | undefined,
  clusters: readonly ClusterNode[],
): InterClusterEdge[] {
  if (clusters.length < 2) return []
  const graphKey = salt(graph)
  const edges: InterClusterEdge[] = []
  const seen = new Set<string>()
  for (let i = 0; i < clusters.length; i += 1) {
    const rng = rngFor(`${graphKey}|xedge|${parentId ?? 'ROOT'}|${i}`)
    const count = randInt(rng, 1, Math.min(3, clusters.length - 1))
    for (let k = 0; k < count; k += 1) {
      const j = randInt(rng, 0, clusters.length - 1)
      if (j === i) continue
      const src = Math.min(i, j)
      const dst = Math.max(i, j)
      const key = `${src}-${dst}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ src_idx: src, dst_idx: dst, weight: 1 + rng() * 4 })
    }
  }
  return edges
}

export interface ExpandedLeaf {
  nodes: ExpandNode[]
  edges: ExpandEdge[]
}

/** The real nodes + edges inside a LEAF cluster. */
export function expandLeafCluster(graph: readonly string[], clusterId: string, count: number): ExpandedLeaf {
  const graphKey = salt(graph)
  const nodes: ExpandNode[] = []
  for (let i = 0; i < count; i += 1) {
    const rng = rngFor(`${graphKey}|leafnode|${clusterId}|${i}`)
    const type = pick(rng, NODE_TYPE_VOCAB)
    nodes.push({ id: `${clusterId}#n${i}`, type, name: `${type} ${clusterId.replaceAll('/', '.')}.${i}` })
  }
  const edges: ExpandEdge[] = []
  // A cheap "reads as a graph" generator: each node links to a small
  // number of EARLIER nodes (preferential-attachment flavoured, since
  // earlier nodes accumulate more incoming links) — deterministic, no
  // isolated-by-construction majority the way a pure random pairing would
  // tend to leave behind.
  for (let i = 1; i < count; i += 1) {
    const rng = rngFor(`${graphKey}|leafedge|${clusterId}|${i}`)
    const linkCount = randInt(rng, 1, Math.min(3, i))
    const used = new Set<number>()
    for (let k = 0; k < linkCount; k += 1) {
      const target = Math.floor(rng() * rng() * i) // skewed toward 0 = early/hub nodes
      if (used.has(target)) continue
      used.add(target)
      edges.push({ src_idx: i, dst_idx: target, type: pick(rng, REL_TYPE_VOCAB) })
    }
  }
  return { nodes, edges }
}

/** Resolve a cluster id to its derived node count + level + leaf-ness, without materializing anything. */
export function describeCluster(
  graph: readonly string[],
  clusterId: string,
  cfg: MockGeneratorConfig = DEFAULT_MOCK_CONFIG,
): { count: number; level: number; leaf: boolean } {
  const graphKey = salt(graph)
  const path = parsePath(clusterId)
  const count = nodeCountForPath(graphKey, path, cfg)
  const level = path.length - 1
  return { count, level, leaf: isLeaf(count, level, cfg) }
}
