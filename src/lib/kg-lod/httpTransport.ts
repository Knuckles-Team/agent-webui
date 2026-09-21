/**
 * @file httpTransport.ts
 * @description The production `LodTransport` over the authenticated WebUI
 * graph-gateway routes for the bounded JSON hierarchy preview. The browser
 * never contacts epistemic-graph directly: the server route validates the
 * caller's graph scope and invokes the routed graph RPC on the server side.
 * This lane does not claim VIZ-2 binary tiles or streaming.
 *
 * The transport deliberately has no mock or empty-data fallback. A gateway
 * response that says the hierarchy is unavailable becomes
 * `LodUnavailableError`, allowing the view to render an explicit status card.
 * Every request accepts an AbortSignal so navigating away or reloading cannot
 * leave an in-flight hierarchy request updating state.
 */

import { z } from 'zod'

import { ApiError, fetchValidated } from '@/lib/api-validation'

import {
  clustersResponseSchema,
  expandResponseSchema,
  lodHierarchyRefreshResponseSchema,
  LodUnavailableError,
} from './contract'
import type {
  ClustersResponse,
  ExpandResponse,
  LodGraphScope,
  LodHierarchyRefreshResponse,
  LodTile,
  LodTransport,
} from './contract'

export const GRAPH3D_REFRESH_PATH = '/api/enhanced/graph/graph3d/refresh'
const GRAPH3D_CLUSTERS_PATH = '/api/enhanced/graph/graph3d/clusters'
const GRAPH3D_EXPAND_PATH = '/api/enhanced/graph/graph3d/expand'

/** UI depth starts at zero; epistemic-graph hierarchy levels start at one. */
export const MAX_UI_LOD_LEVEL = 64
const MAX_SCOPE_NAME_CHARS = 256
const MAX_CLUSTER_ID_CHARS = 256

function isTimezoneQualifiedTimestamp(value: string): boolean {
  return value.trim() === value && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
}

function validateText(value: string, field: string, maxChars: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    value.length > maxChars ||
    Array.from(value).some((character) => character.charCodeAt(0) < 0x20)
  ) {
    throw new TypeError(`${field} must be a non-empty bounded identifier`)
  }
  return value
}

function requireSingleGraph(graph: LodGraphScope): string {
  // A request is scoped to exactly one graph. Accepting an empty array would
  // make the backend guess a graph; accepting several would look like a union
  // while this hierarchy RPC is explicitly single-graph and ID-addressed.
  if (!Array.isArray(graph) || graph.length !== 1) {
    throw new TypeError('LOD requests require exactly one authorized graph')
  }
  return validateText(graph[0], 'graph', MAX_SCOPE_NAME_CHARS)
}

function graphQuery(graph: LodGraphScope): string {
  return `graph=${encodeURIComponent(requireSingleGraph(graph))}`
}

function validateLevel(level: number): number {
  if (!Number.isInteger(level) || level < 0 || level > MAX_UI_LOD_LEVEL) {
    throw new RangeError(`LOD level must be an integer between 0 and ${MAX_UI_LOD_LEVEL}`)
  }
  return level
}

function requireReady<T extends { available?: boolean; status?: string; reason?: string }>(
  data: T,
  endpoint: string,
): T {
  if (data.available !== true || data.status !== 'ready') {
    const reason = data.reason?.trim()
    throw new LodUnavailableError(reason ?? `${endpoint} is unavailable`)
  }
  return data
}

function requireFreshScopedHierarchy(
  data: LodHierarchyRefreshResponse,
  graph: LodGraphScope,
  endpoint: string,
): LodHierarchyRefreshResponse {
  const ready = requireReady(data, endpoint)
  if (
    ready.graph !== graph[0] ||
    !ready.authority_scoped ||
    ready.freshness !== 'fresh' ||
    typeof ready.version !== 'number' ||
    !Number.isFinite(ready.version) ||
    typeof ready.observed_at !== 'string' ||
    !isTimezoneQualifiedTimestamp(ready.observed_at)
  ) {
    throw new LodUnavailableError('Authority-scoped hierarchy preview is unavailable')
  }
  return ready
}

async function fetchLod<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await fetchValidated(path, schema, { signal })
  } catch (error) {
    // The proxy uses 503 for a live engine/cache failure and includes the
    // same explicit unavailable payload as its 2xx no-engine response. Turn
    // that into the typed state error while preserving auth/network failures.
    if (error instanceof ApiError && error.status === 503) {
      let reason: string | undefined
      try {
        const body = JSON.parse(error.body) as { reason?: unknown }
        if (typeof body.reason === 'string' && body.reason.trim()) reason = body.reason
      } catch {
        // The gateway's stable status is enough when its body is not JSON.
      }
      throw new LodUnavailableError(reason ?? 'Knowledge Graph hierarchy is unavailable')
    }
    throw error
  }
}

export class HttpLodTransport implements LodTransport {
  async refresh(graph: LodGraphScope, signal?: AbortSignal): Promise<LodHierarchyRefreshResponse> {
    const path = `${GRAPH3D_REFRESH_PATH}?${graphQuery(graph)}`
    return fetchLod(path, lodHierarchyRefreshResponseSchema, signal)
  }

  async *clusters(
    graph: LodGraphScope,
    level: number,
    parentClusterId?: string,
    signal?: AbortSignal,
  ): AsyncIterable<LodTile<ClustersResponse>> {
    const uiLevel = validateLevel(level)
    const validParentClusterId =
      parentClusterId == null ? undefined : validateText(parentClusterId, 'parentClusterId', MAX_CLUSTER_ID_CHARS)
    const refreshPath = `${GRAPH3D_REFRESH_PATH}?${graphQuery(graph)}`
    requireFreshScopedHierarchy(await this.refresh(graph, signal), graph, refreshPath)
    const params = new URLSearchParams({ level: String(uiLevel) })
    if (validParentClusterId != null) {
      params.set('parent_cluster_id', validParentClusterId)
    }
    const path = `${GRAPH3D_CLUSTERS_PATH}?${params.toString()}&${graphQuery(graph)}`
    const data = requireReady(await fetchLod(path, clustersResponseSchema, signal), path)
    yield { data, tileIndex: 0, done: true }
  }

  async *expand(
    graph: LodGraphScope,
    clusterId: string,
    signal?: AbortSignal,
  ): AsyncIterable<LodTile<ExpandResponse>> {
    const validClusterId = validateText(clusterId, 'clusterId', MAX_CLUSTER_ID_CHARS)
    const refreshPath = `${GRAPH3D_REFRESH_PATH}?${graphQuery(graph)}`
    requireFreshScopedHierarchy(await this.refresh(graph, signal), graph, refreshPath)
    const params = new URLSearchParams({
      cluster_id: validClusterId,
    })
    const path = `${GRAPH3D_EXPAND_PATH}?${params.toString()}&${graphQuery(graph)}`
    const data = requireReady(await fetchLod(path, expandResponseSchema, signal), path)
    yield { data, tileIndex: 0, done: true }
  }
}
