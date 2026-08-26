/**
 * @file useLodExplorer.ts
 * @description The LOD state machine: owns the root cluster level, every
 * cluster the viewer has expanded, and the ONE combined `LodScope` that gets
 * handed to `Graph3DCanvas` — the same canvas, worker and scene the
 * non-LOD `Graph3DView` already uses (see `lodGraph.ts`'s file doc for why
 * that reuse is possible at all).
 *
 * ## The expansion model
 *
 * A cluster starts collapsed (a single pseudo-node). Expanding it fetches
 * its children (real nodes, or more clusters one level down) and folds them
 * into the SAME rendered scope in place of the pseudo-node — this is
 * `removeClusterNode` + `mergeScopes` from `lodGraph.ts`, applied in the
 * order the viewer expanded things (a child cannot be expanded before its
 * parent is, so processing `expanded` in Map insertion order always finds
 * the node it needs to remove still present in the accumulator).
 *
 * Multiple branches can be open at once — expanding one cluster does not
 * force-collapse a sibling, it only visually recedes it (`emphasisMask`,
 * scoped to whichever expansion happened MOST RECENTLY, via
 * `LodNodeMeta.originClusterId` — see below). `collapse` folds one
 * expansion (and, recursively, anything expanded inside it) back down to
 * its pseudo-node; `reset` folds everything back to the root level.
 *
 * ## Progressive tiles
 *
 * Both the root level and an expansion can arrive as several `LodTile`s
 * (`contract.ts`). Each tile updates state immediately — `clustersToScope`/
 * `expandToScope` are cheap enough (a "few thousand" nodes, per the brief)
 * to re-run on every tile rather than trying to incrementally patch a
 * `Graph3DModel` in place, and re-running them is what lets a tile arrive
 * with NO inter-cluster edges yet (the mock and http transports both ride
 * edges on the final tile — see their file docs) without the intermediate
 * renders being wrong, just incomplete.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ClusterSummary, ExpandEdge, ExpandNode, LodGraphScope, LodTransport } from './contract'
import { clustersToScope, emptyScope, expandToScope, mergeScopes, removeClusterNode, type LodScope } from './lodGraph'

export interface UseLodExplorerOptions {
  transport: LodTransport
  graph: LodGraphScope
}

export type ExpandOutcome = 'expanded' | 'no-children' | 'error'

export interface UseLodExplorerResult {
  /** The combined scope to render: root clusters with every open expansion folded in. */
  scope: LodScope
  /** True while the root level's first tile has not landed yet. */
  rootLoading: boolean
  error: string | null
  /** Ids currently being fetched — drive a per-node loading affordance. */
  pending: ReadonlySet<string>
  /** Ids currently expanded (their pseudo-node has been replaced by children). */
  expandedIds: ReadonlySet<string>
  /**
   * `null` when nothing has been expanded yet (no dimming — the resting
   * state renders identically to the non-LOD view). Otherwise a per-node
   * 0/1 mask, `1` for the most-recently-expanded branch, for
   * `Graph3DScene.setEmphasis`.
   */
  emphasisMask: Uint8Array | null
  /** The node index (into `scope.model.nodes`) the camera should follow after the latest expansion, or `null`. */
  followIndex: number | null
  /** Expand the cluster at `clusterId` (a no-op if already expanded or pending). */
  expand: (clusterId: string) => Promise<ExpandOutcome>
  /** Fold `clusterId`'s expansion (and anything expanded inside it) back down. */
  collapse: (clusterId: string) => void
  /** Fold every expansion back down to the root level. */
  reset: () => void
  /** Re-fetch the root level from scratch, discarding all expansions. */
  reload: () => void
}

interface AccumulatedExpansion {
  scope: LodScope
  /**
   * The id of the EXPANSION this one is nested inside — i.e. the expanded
   * cluster whose own children included the cluster this entry expands —
   * or `null` when this entry expands a root-level cluster. Used purely to
   * cascade `collapse()` to nested expansions; see that function.
   */
  ancestorExpansionId: string | null
}

export function useLodExplorer({ transport, graph }: UseLodExplorerOptions): UseLodExplorerResult {
  const [root, setRoot] = useState<LodScope>(() => emptyScope())
  const [rootLoading, setRootLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Map<string, AccumulatedExpansion>>(() => new Map())
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const [lastExpandedId, setLastExpandedId] = useState<string | null>(null)
  const [followIndex, setFollowIndex] = useState<number | null>(null)

  const rootAbort = useRef<AbortController | null>(null)
  const expandAbort = useRef<Map<string, AbortController>>(new Map())

  const fetchRoot = useCallback(() => {
    rootAbort.current?.abort()
    const controller = new AbortController()
    rootAbort.current = controller
    setRootLoading(true)
    setError(null)
    setExpanded(new Map())
    setLastExpandedId(null)
    setFollowIndex(null)
    void (async () => {
      const accumulated: ClusterSummary[] = []
      try {
        for await (const tile of transport.clusters(graph, 0, undefined, controller.signal)) {
          accumulated.push(...tile.data.clusters)
          const scope = clustersToScope({
            level: tile.data.level,
            clusters: accumulated,
            inter_cluster_edges: tile.done ? tile.data.inter_cluster_edges : [],
          })
          if (controller.signal.aborted) return
          setRoot(scope)
          setRootLoading(false)
        }
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : String(err))
        setRootLoading(false)
      }
    })()
  }, [transport, graph])

  useEffect(() => {
    fetchRoot()
    return () => rootAbort.current?.abort()
  }, [fetchRoot])

  // ── the combined scope: root with every open expansion folded in ───────
  const scope = useMemo(() => {
    let acc = root
    for (const [clusterId, { scope: childScope }] of expanded) {
      acc = mergeScopes(removeClusterNode(acc, clusterId), childScope)
    }
    return acc
  }, [root, expanded])

  const emphasisMask = useMemo(() => {
    if (lastExpandedId == null) return null
    const mask = new Uint8Array(scope.meta.length)
    for (let i = 0; i < scope.meta.length; i += 1) {
      mask[i] = scope.meta[i].originClusterId === lastExpandedId ? 1 : 0
    }
    return mask
  }, [scope, lastExpandedId])

  const expand = useCallback(
    async (clusterId: string): Promise<ExpandOutcome> => {
      if (expanded.has(clusterId)) return 'no-children'
      const clusterMeta = scope.meta.find((m) => m.clusterId === clusterId)
      const parentLevel = clusterMeta?.level ?? 0
      const ancestorExpansionId = clusterMeta?.originClusterId ?? null

      expandAbort.current.get(clusterId)?.abort()
      const controller = new AbortController()
      expandAbort.current.set(clusterId, controller)
      setPending((current) => new Set(current).add(clusterId))

      const accNodes: ExpandNode[] = []
      const accClusters: ClusterSummary[] = []
      let sawAnyTile = false
      try {
        for await (const tile of transport.expand(graph, clusterId, controller.signal)) {
          if (controller.signal.aborted) return 'error'
          sawAnyTile = true
          accNodes.push(...tile.data.nodes)
          accClusters.push(...tile.data.child_clusters)
          const edges: ExpandEdge[] = tile.done ? tile.data.edges : []
          let childScope = expandToScope({ nodes: accNodes, edges, child_clusters: accClusters }, parentLevel)
          childScope = {
            ...childScope,
            meta: childScope.meta.map((m) => ({ ...m, originClusterId: clusterId })),
          }
          setExpanded((current) => {
            const next = new Map(current)
            next.set(clusterId, { scope: childScope, ancestorExpansionId })
            return next
          })
          setLastExpandedId(clusterId)
          if (tile.done) {
            setFollowIndex(accNodes.length > 0 || accClusters.length > 0 ? 0 : null)
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return 'error'
        setError(err instanceof Error ? err.message : String(err))
        return 'error'
      } finally {
        setPending((current) => {
          const next = new Set(current)
          next.delete(clusterId)
          return next
        })
      }
      if (!sawAnyTile || (accNodes.length === 0 && accClusters.length === 0)) return 'no-children'
      return 'expanded'
    },
    [transport, graph, expanded, scope],
  )

  const collapse = useCallback((clusterId: string) => {
    expandAbort.current.get(clusterId)?.abort()
    expandAbort.current.delete(clusterId)
    setExpanded((current) => {
      if (!current.has(clusterId)) return current
      // Fold `clusterId` AND anything expanded inside it — a descendant's
      // ancestor chain, walked through `ancestorExpansionId`, must not
      // survive its ancestor collapsing (its nodes would dangle: the
      // pseudo-node they replaced no longer exists once the ancestor folds
      // back down).
      const drop = new Set<string>([clusterId])
      let changed = true
      while (changed) {
        changed = false
        for (const [id, entry] of current) {
          if (entry.ancestorExpansionId != null && drop.has(entry.ancestorExpansionId) && !drop.has(id)) {
            drop.add(id)
            changed = true
          }
        }
      }
      const next = new Map(current)
      for (const id of drop) {
        next.delete(id)
        expandAbort.current.get(id)?.abort()
        expandAbort.current.delete(id)
      }
      return next
    })
    setLastExpandedId((current) => (current === clusterId ? null : current))
  }, [])

  const reset = useCallback(() => {
    for (const controller of expandAbort.current.values()) controller.abort()
    expandAbort.current.clear()
    setExpanded(new Map())
    setLastExpandedId(null)
    setFollowIndex(null)
  }, [])

  const reload = useCallback(() => {
    fetchRoot()
  }, [fetchRoot])

  const expandedIds = useMemo(() => new Set(expanded.keys()), [expanded])

  return {
    scope,
    rootLoading,
    error,
    pending,
    expandedIds,
    emphasisMask,
    followIndex,
    expand,
    collapse,
    reset,
    reload,
  }
}
