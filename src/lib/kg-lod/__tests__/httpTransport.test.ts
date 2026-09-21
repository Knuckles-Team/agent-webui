import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LodUnavailableError } from '../contract'
import { HttpLodTransport } from '../httpTransport'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function readyClusters(level = 0) {
  return {
    available: true,
    status: 'ready',
    level,
    clusters: [],
    inter_cluster_edges: [],
    transport: 'json-hierarchy-preview',
    streaming: false,
  }
}

function readyRefresh(graph = 'tenant') {
  return {
    available: true,
    status: 'ready',
    graph,
    authority_scoped: true,
    version: 7,
    freshness: 'fresh',
    observed_at: '2026-08-29T12:00:00Z',
    transport: 'json-hierarchy-preview',
    streaming: false,
  }
}

describe('HttpLodTransport', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the authenticated gateway path, one graph scope, and forwards cancellation', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(jsonResponse(readyRefresh('tenant:acme')))
    fetchMock.mockResolvedValueOnce(jsonResponse(readyClusters()))
    const signal = new AbortController().signal
    const transport = new HttpLodTransport()

    const tiles = []
    for await (const tile of transport.clusters(['tenant:acme'], 0, undefined, signal)) {
      tiles.push(tile)
    }

    expect(tiles).toHaveLength(1)
    expect(tiles[0].done).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/enhanced/graph/graph3d/refresh?graph=tenant%3Aacme', { signal })
    expect(fetchMock).toHaveBeenCalledWith('/api/enhanced/graph/graph3d/clusters?level=0&graph=tenant%3Aacme', {
      signal,
    })
  })

  it('turns an explicit unavailable gateway response into an unavailable error', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        available: false,
        status: 'unavailable',
        graph: null,
        authority_scoped: false,
        transport: 'json-hierarchy-preview',
        streaming: false,
        reason: 'Hierarchy has not been refreshed.',
      }),
    )
    const transport = new HttpLodTransport()

    await expect(
      (async () => {
        for await (const _tile of transport.clusters(['tenant'], 0)) {
          // The unavailable response must reject before a tile is yielded.
          void _tile
        }
      })(),
    ).rejects.toBeInstanceOf(LodUnavailableError)
  })

  it('maps the proxy 503 status body to the same explicit unavailable state', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          available: false,
          status: 'unavailable',
          graph: null,
          authority_scoped: false,
          transport: 'json-hierarchy-preview',
          streaming: false,
          reason: 'Hierarchy cache is not ready.',
        },
        503,
      ),
    )
    const transport = new HttpLodTransport()

    await expect(
      (async () => {
        for await (const _tile of transport.clusters(['tenant'], 0)) {
          // no-op
          void _tile
        }
      })(),
    ).rejects.toMatchObject({
      name: 'LodUnavailableError',
      message: 'Hierarchy cache is not ready.',
    })
  })

  it('rejects unscoped, multi-scoped, and out-of-bounds requests before fetch', async () => {
    const fetchMock = vi.mocked(fetch)
    const transport = new HttpLodTransport()

    await expect(
      (async () => {
        for await (const _tile of transport.clusters([], 0)) {
          // no-op
          void _tile
        }
      })(),
    ).rejects.toThrow('exactly one authorized graph')
    await expect(
      (async () => {
        for await (const _tile of transport.clusters(['a', 'b'], 0)) {
          // no-op
          void _tile
        }
      })(),
    ).rejects.toThrow('exactly one authorized graph')
    await expect(
      (async () => {
        for await (const _tile of transport.clusters(['tenant'], -1)) {
          // no-op
          void _tile
        }
      })(),
    ).rejects.toThrow('LOD level')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('validates expansion identifiers and preserves the closed response shape', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(jsonResponse(readyRefresh()))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        available: true,
        status: 'ready',
        nodes: [],
        edges: [],
        child_clusters: [],
        transport: 'json-hierarchy-preview',
        streaming: false,
      }),
    )
    const transport = new HttpLodTransport()
    const tiles = []
    for await (const tile of transport.expand(['tenant'], 'L1-0')) tiles.push(tile)

    expect(tiles[0].data.nodes).toEqual([])
    expect(fetchMock).toHaveBeenCalledWith('/api/enhanced/graph/graph3d/refresh?graph=tenant', { signal: undefined })
    expect(fetchMock).toHaveBeenCalledWith('/api/enhanced/graph/graph3d/expand?cluster_id=L1-0&graph=tenant', {
      signal: undefined,
    })
    await expect(
      (async () => {
        for await (const _tile of transport.expand(['tenant'], '')) {
          // no-op
          void _tile
        }
      })(),
    ).rejects.toThrow('clusterId')
  })

  it('does not reach clusters when the scoped refresh receipt is stale or incomplete', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...readyRefresh(),
        freshness: 'stale',
      }),
    )
    const transport = new HttpLodTransport()

    await expect(
      (async () => {
        for await (const _tile of transport.clusters(['tenant'], 0)) {
          // no-op
          void _tile
        }
      })(),
    ).rejects.toBeInstanceOf(LodUnavailableError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not enable the preview when the scoped receipt has no version', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...readyRefresh(),
        version: null,
      }),
    )
    const transport = new HttpLodTransport()

    await expect(
      (async () => {
        for await (const _tile of transport.clusters(['tenant'], 0)) {
          // no-op
          void _tile
        }
      })(),
    ).rejects.toBeInstanceOf(LodUnavailableError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('accepts finite fractional weighted edge counts in a JSON preview', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(jsonResponse(readyRefresh()))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...readyClusters(),
        clusters: [
          {
            id: 'L1-0',
            label: 'Weighted cluster',
            node_count: 2,
            edge_count: 1.25,
            centroid: null,
            top_node_types: [],
          },
        ],
      }),
    )
    const transport = new HttpLodTransport()
    const tiles = []
    for await (const tile of transport.clusters(['tenant'], 0)) tiles.push(tile)

    expect(tiles[0].data.clusters[0].edge_count).toBe(1.25)
  })
})
