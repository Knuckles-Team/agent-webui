/** React Query bindings for the Atlas source control-plane client. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { AtlasFetchResult } from '@/lib/atlas/transport'

import {
  cancelSourceRun,
  connectSource,
  DEFAULT_ATLAS_SOURCE_ROUTES,
  fetchSourceCatalog,
  fetchSourceConnection,
  fetchSourceRuns,
  previewSourceSync,
  startSourceSync,
  type AtlasSourceRoutes,
} from './api'
import {
  sourceScopeSchema,
  sourceIdSchema,
  type CancelSyncRunRequest,
  type CancelSyncRunResponse,
  type ConnectSourceRequest,
  type ConnectSourceResponse,
  type SourceCatalog,
  type SourceConnectionStatus,
  type SourceScope,
  type StartSyncRequest,
  type StartSyncResponse,
  type SyncPreview,
  type SyncPreviewRequest,
  type SyncRunAggregate,
} from './contracts'

export interface UseAtlasSourcesOptions {
  routes?: AtlasSourceRoutes
  enabled?: boolean
  /** Tenant/principal/authority discriminator; queries stay disabled without it. */
  scope?: SourceScope
}

export interface UseAtlasSourceRunsOptions extends UseAtlasSourcesOptions {
  sourceId?: string
  /** Set to false to let an operator-driven refresh be the only poll. */
  pollIntervalMs?: number | false
}

export function atlasSourceScopeKey(scope: SourceScope | undefined): readonly string[] {
  const parsed = sourceScopeSchema.safeParse(scope)
  if (!parsed.success) return ['scope', 'unscoped']
  return ['scope', parsed.data.authority, parsed.data.tenant, parsed.data.principal]
}

function hasScope(scope: SourceScope | undefined) {
  return sourceScopeSchema.safeParse(scope).success
}

function sourceKeyId(sourceId: string): string {
  const parsed = sourceIdSchema.safeParse(sourceId)
  return parsed.success ? parsed.data : 'invalid-source-id'
}

export function atlasSourceCatalogQueryKey(routes: AtlasSourceRoutes, scope?: SourceScope): readonly unknown[] {
  return ['atlas', 'sources', 'catalog', routes.catalog, ...atlasSourceScopeKey(scope)]
}

export function atlasSourceConnectionQueryKey(
  routes: AtlasSourceRoutes,
  sourceId: string,
  scope?: SourceScope,
): readonly unknown[] {
  return ['atlas', 'sources', 'connection', routes.connection(sourceKeyId(sourceId)), ...atlasSourceScopeKey(scope)]
}

export function atlasSourceRunsQueryKey(
  routes: AtlasSourceRoutes,
  sourceId: string | undefined,
  scope?: SourceScope,
): readonly unknown[] {
  const keySourceId = sourceId === undefined ? '' : sourceKeyId(sourceId)
  return ['atlas', 'sources', 'runs', routes.syncRuns, ...atlasSourceScopeKey(scope), keySourceId]
}

function atlasSourceRunsPrefixKey(routes: AtlasSourceRoutes, scope: SourceScope | undefined): readonly unknown[] {
  return ['atlas', 'sources', 'runs', routes.syncRuns, ...atlasSourceScopeKey(scope)]
}

function selectedRoutes(routes: AtlasSourceRoutes | undefined): AtlasSourceRoutes {
  return routes ?? DEFAULT_ATLAS_SOURCE_ROUTES
}

/** Fetch the server-owned provider catalog, preserving unavailable/error state. */
export function useAtlasSourceCatalog(options: UseAtlasSourcesOptions = {}) {
  const routes = selectedRoutes(options.routes)
  const enabled = (options.enabled ?? true) && hasScope(options.scope)
  return useQuery<AtlasFetchResult<SourceCatalog>>({
    queryKey: atlasSourceCatalogQueryKey(routes, options.scope),
    enabled,
    queryFn: ({ signal }) => fetchSourceCatalog({ signal, routes }),
    refetchOnWindowFocus: false,
  })
}

/** Fetch one source's connection state without exposing its secret material. */
export function useAtlasSourceConnection(sourceId: string | undefined, options: UseAtlasSourcesOptions = {}) {
  const routes = selectedRoutes(options.routes)
  const enabled = (options.enabled ?? true) && Boolean(sourceId) && hasScope(options.scope)
  const queryKey = sourceId
    ? atlasSourceConnectionQueryKey(routes, sourceId, options.scope)
    : ['atlas', 'sources', 'connection', 'none', ...atlasSourceScopeKey(options.scope)]
  return useQuery<AtlasFetchResult<SourceConnectionStatus>>({
    queryKey,
    enabled,
    queryFn: ({ signal }) => {
      if (!sourceId) throw new Error('source id is required to fetch connection status')
      return fetchSourceConnection({ signal, routes, sourceId })
    },
    refetchOnWindowFocus: false,
  })
}

/** Associate a server-side connection profile reference with a source. */
export function useConnectAtlasSource(options: UseAtlasSourcesOptions = {}) {
  const routes = selectedRoutes(options.routes)
  const queryClient = useQueryClient()
  return useMutation<AtlasFetchResult<ConnectSourceResponse>, Error, ConnectSourceRequest>({
    mutationFn: (payload) => connectSource({ signal: new AbortController().signal, routes, payload }),
    onSuccess: (result, payload) => {
      if (!result.ok) return
      void queryClient.invalidateQueries({ queryKey: atlasSourceCatalogQueryKey(routes, options.scope) })
      void queryClient.invalidateQueries({
        queryKey: atlasSourceConnectionQueryKey(routes, payload.source_id, options.scope),
      })
    },
  })
}

/** Request a non-mutating, provenance-bearing sync preview. */
export function usePreviewAtlasSourceSync(options: UseAtlasSourcesOptions = {}) {
  const routes = selectedRoutes(options.routes)
  return useMutation<AtlasFetchResult<SyncPreview>, Error, SyncPreviewRequest>({
    mutationFn: (payload) => previewSourceSync({ signal: new AbortController().signal, routes, payload }),
  })
}

/** Start exactly the reviewed preview selected by the operator. */
export function useStartAtlasSourceSync(options: UseAtlasSourcesOptions = {}) {
  const routes = selectedRoutes(options.routes)
  const queryClient = useQueryClient()
  return useMutation<AtlasFetchResult<StartSyncResponse>, Error, StartSyncRequest>({
    mutationFn: (payload) => startSourceSync({ signal: new AbortController().signal, routes, payload }),
    onSuccess: (result) => {
      if (result.ok) {
        void queryClient.invalidateQueries({ queryKey: atlasSourceRunsPrefixKey(routes, options.scope) })
      }
    },
  })
}

/** Read the aggregate run status; polling never changes the server-owned rollup. */
export function useAtlasSourceRuns(options: UseAtlasSourceRunsOptions = {}) {
  const routes = selectedRoutes(options.routes)
  const enabled = (options.enabled ?? true) && hasScope(options.scope)
  return useQuery<AtlasFetchResult<SyncRunAggregate>>({
    queryKey: atlasSourceRunsQueryKey(routes, options.sourceId, options.scope),
    enabled,
    queryFn: ({ signal }) => fetchSourceRuns({ signal, routes, sourceId: options.sourceId }),
    refetchInterval: options.pollIntervalMs ?? 5000,
    refetchOnWindowFocus: false,
  })
}

/** Cancel a server-owned run and refresh the aggregate status. */
export function useCancelAtlasSourceRun(options: UseAtlasSourceRunsOptions = {}) {
  const routes = selectedRoutes(options.routes)
  const queryClient = useQueryClient()
  return useMutation<AtlasFetchResult<CancelSyncRunResponse>, Error, CancelSyncRunRequest>({
    mutationFn: (payload) => cancelSourceRun({ signal: new AbortController().signal, routes, payload }),
    onSuccess: (result) => {
      if (result.ok) {
        void queryClient.invalidateQueries({
          queryKey: atlasSourceRunsQueryKey(routes, options.sourceId, options.scope),
        })
      }
    },
  })
}
