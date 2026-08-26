import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MockLodTransport } from '../mockTransport'
import { DEFAULT_MOCK_CONFIG, siblingClusters, type MockGeneratorConfig } from '../mockGenerator'
import { useLodExplorer } from '../useLodExplorer'

const GRAPH = ['default']

/** A small, fast config: few root clusters, a shallow tree, tiny tiles — exercises the same code paths without 2,200-cluster runtimes. */
const SMALL_CONFIG: MockGeneratorConfig = {
  ...DEFAULT_MOCK_CONFIG,
  rootClusterCount: 16,
  totalLeaves: 2_000,
  leafThreshold: 150,
}

function smallTransport(clusterTileSize = 5, nodeTileSize = 10) {
  return new MockLodTransport({ config: SMALL_CONFIG, clusterTileSize, nodeTileSize, tileDelayMs: 0 })
}

describe('useLodExplorer — root loading', () => {
  it('loads the root level progressively and settles with every cluster present', async () => {
    const transport = smallTransport()
    const { result } = renderHook(() => useLodExplorer({ transport, graph: GRAPH }))

    expect(result.current.rootLoading).toBe(true)
    await waitFor(() => {
      expect(result.current.rootLoading).toBe(false)
    })
    await waitFor(() => {
      expect(result.current.scope.model.nodes.length).toBe(SMALL_CONFIG.rootClusterCount)
    })
    expect(result.current.error).toBeNull()
    // Every rendered node is a root-level cluster before anything is expanded.
    expect(result.current.scope.meta.every((m) => m.kind === 'cluster' && m.level === 0)).toBe(true)
    expect(result.current.emphasisMask).toBeNull()
  })
})

describe('useLodExplorer — expand', () => {
  it('expands a non-leaf cluster into child clusters, replacing its pseudo-node', async () => {
    const transport = smallTransport()
    const { result } = renderHook(() => useLodExplorer({ transport, graph: GRAPH }))
    await waitFor(() => {
      expect(result.current.rootLoading).toBe(false)
    })

    const root = siblingClusters(GRAPH, undefined, SMALL_CONFIG)
    const nonLeaf = root.clusters.find((c) => c.node_count > SMALL_CONFIG.leafThreshold)!
    const before = result.current.scope.model.nodes.length

    let outcome
    await act(async () => {
      outcome = await result.current.expand(nonLeaf.id)
    })
    expect(outcome).toBe('expanded')

    await waitFor(() => {
      expect(result.current.expandedIds.has(nonLeaf.id)).toBe(true)
    })
    // The expanded cluster's own pseudo-node is gone; its children are present instead.
    expect(result.current.scope.model.nodes.some((n) => n.id === nonLeaf.id)).toBe(false)
    expect(result.current.scope.model.nodes.length).toBeGreaterThan(before - 1)
    expect(result.current.emphasisMask).not.toBeNull()
    expect(result.current.followIndex).not.toBeNull()
  })

  it('expands a leaf cluster into real nodes', async () => {
    const transport = smallTransport()
    const { result } = renderHook(() => useLodExplorer({ transport, graph: GRAPH }))
    await waitFor(() => {
      expect(result.current.rootLoading).toBe(false)
    })

    const root = siblingClusters(GRAPH, undefined, SMALL_CONFIG)
    const leaf = root.clusters.find((c) => c.node_count <= SMALL_CONFIG.leafThreshold)!

    await act(async () => {
      await result.current.expand(leaf.id)
    })
    await waitFor(() => {
      expect(result.current.expandedIds.has(leaf.id)).toBe(true)
    })

    const leafNodeMetas = result.current.scope.meta.filter((m) => m.kind === 'leaf')
    expect(leafNodeMetas.length).toBe(leaf.node_count)
  })

  it('emphasizes only the most recently expanded branch', async () => {
    const transport = smallTransport()
    const { result } = renderHook(() => useLodExplorer({ transport, graph: GRAPH }))
    await waitFor(() => {
      expect(result.current.rootLoading).toBe(false)
    })

    const root = siblingClusters(GRAPH, undefined, SMALL_CONFIG)
    const leaves = root.clusters.filter((c) => c.node_count <= SMALL_CONFIG.leafThreshold)
    expect(leaves.length).toBeGreaterThanOrEqual(2)

    await act(async () => {
      await result.current.expand(leaves[0].id)
    })
    await act(async () => {
      await result.current.expand(leaves[1].id)
    })

    const mask = result.current.emphasisMask!
    const emphasizedOrigins = new Set(
      result.current.scope.meta.filter((_, i) => mask[i] === 1).map((m) => m.originClusterId),
    )
    // Only leaves[1] (the latest expansion) is emphasized.
    expect(emphasizedOrigins).toEqual(new Set([leaves[1].id]))
  })

  it('is a no-op (no-children) on an already-expanded cluster', async () => {
    const transport = smallTransport()
    const { result } = renderHook(() => useLodExplorer({ transport, graph: GRAPH }))
    await waitFor(() => {
      expect(result.current.rootLoading).toBe(false)
    })
    const root = siblingClusters(GRAPH, undefined, SMALL_CONFIG)
    const leaf = root.clusters.find((c) => c.node_count <= SMALL_CONFIG.leafThreshold)!

    await act(async () => {
      await result.current.expand(leaf.id)
    })
    let second
    await act(async () => {
      second = await result.current.expand(leaf.id)
    })
    expect(second).toBe('no-children')
  })
})

describe('useLodExplorer — collapse / reset', () => {
  it('collapse restores the cluster pseudo-node and drops its children', async () => {
    const transport = smallTransport()
    const { result } = renderHook(() => useLodExplorer({ transport, graph: GRAPH }))
    await waitFor(() => {
      expect(result.current.rootLoading).toBe(false)
    })
    const root = siblingClusters(GRAPH, undefined, SMALL_CONFIG)
    const leaf = root.clusters.find((c) => c.node_count <= SMALL_CONFIG.leafThreshold)!

    await act(async () => {
      await result.current.expand(leaf.id)
    })
    expect(result.current.expandedIds.has(leaf.id)).toBe(true)

    act(() => {
      result.current.collapse(leaf.id)
    })

    expect(result.current.expandedIds.has(leaf.id)).toBe(false)
    expect(result.current.scope.model.nodes.some((n) => n.id === leaf.id)).toBe(true)
    expect(result.current.scope.model.nodes.length).toBe(SMALL_CONFIG.rootClusterCount)
  })

  it('collapsing an ancestor also drops a nested expansion inside it', async () => {
    const transport = smallTransport()
    const { result } = renderHook(() => useLodExplorer({ transport, graph: GRAPH }))
    await waitFor(() => {
      expect(result.current.rootLoading).toBe(false)
    })
    const root = siblingClusters(GRAPH, undefined, SMALL_CONFIG)
    const nonLeaf = root.clusters.find((c) => c.node_count > SMALL_CONFIG.leafThreshold)!

    await act(async () => {
      await result.current.expand(nonLeaf.id)
    })
    const children = result.current.scope.meta.filter((m) => m.originClusterId === nonLeaf.id)
    expect(children.length).toBeGreaterThan(0)
    const grandchildClusterId = children.find((m) => m.kind === 'cluster')?.clusterId

    if (grandchildClusterId) {
      await act(async () => {
        await result.current.expand(grandchildClusterId)
      })
      expect(result.current.expandedIds.has(grandchildClusterId)).toBe(true)
    }

    act(() => {
      result.current.collapse(nonLeaf.id)
    })

    expect(result.current.expandedIds.size).toBe(0)
    expect(result.current.scope.model.nodes.length).toBe(SMALL_CONFIG.rootClusterCount)
  })

  it('reset folds every expansion back to the root level', async () => {
    const transport = smallTransport()
    const { result } = renderHook(() => useLodExplorer({ transport, graph: GRAPH }))
    await waitFor(() => {
      expect(result.current.rootLoading).toBe(false)
    })
    const root = siblingClusters(GRAPH, undefined, SMALL_CONFIG)
    const leaves = root.clusters.filter((c) => c.node_count <= SMALL_CONFIG.leafThreshold)

    await act(async () => {
      await result.current.expand(leaves[0].id)
    })
    await act(async () => {
      await result.current.expand(leaves[1].id)
    })
    expect(result.current.expandedIds.size).toBe(2)

    act(() => {
      result.current.reset()
    })

    expect(result.current.expandedIds.size).toBe(0)
    expect(result.current.emphasisMask).toBeNull()
    expect(result.current.scope.model.nodes.length).toBe(SMALL_CONFIG.rootClusterCount)
  })
})

describe('useLodExplorer — reload', () => {
  it('re-fetches the root and discards expansions', async () => {
    const transport = smallTransport()
    const { result } = renderHook(() => useLodExplorer({ transport, graph: GRAPH }))
    await waitFor(() => {
      expect(result.current.rootLoading).toBe(false)
    })
    const root = siblingClusters(GRAPH, undefined, SMALL_CONFIG)
    const leaf = root.clusters.find((c) => c.node_count <= SMALL_CONFIG.leafThreshold)!

    await act(async () => {
      await result.current.expand(leaf.id)
    })
    expect(result.current.expandedIds.size).toBe(1)

    act(() => {
      result.current.reload()
    })

    await waitFor(() => {
      expect(result.current.expandedIds.size).toBe(0)
    })
    await waitFor(() => {
      expect(result.current.scope.model.nodes.length).toBe(SMALL_CONFIG.rootClusterCount)
    })
  })
})
