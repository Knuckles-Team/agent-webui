/**
 * @file useAtlas.ts
 * @description The React binding: `atlasReducer` + `@tanstack/react-query`.
 *
 * Cancellation, retry, de-duplication and caching are react-query's job, not
 * Atlas's — the queryFn simply forwards react-query's `signal` into
 * `adapter.introspect` / `adapter.execute`, which is why every adapter is REQUIRED to
 * honour it.
 */
import { useCallback, useMemo, useReducer } from 'react'
import { useQuery } from '@tanstack/react-query'

import type { ModalityAdapter } from './adapter'
import { atlasAdapters } from './discover'
import {
  acceptingRenderers,
  projectResult,
  selectRenderer,
  type AtlasRenderer,
  type ResultProjection,
} from './renderers'
import type { AtlasContext, ResultSet, SchemaTree, Selection } from './types'
import { atlasReducer, initialAtlasState, type AtlasAction, type AtlasState, type SubmittedQuery } from './workbench'

const EMPTY_SCHEMA: SchemaTree = { adapterId: '', roots: [], unavailable: true, note: 'No modality selected.' }

/** Build the adapter's query from a submitted snapshot: edited text wins, else the filters. */
export function queryFromSubmission(adapter: ModalityAdapter, submitted: SubmittedQuery): unknown {
  const ctx = submitted.ctx
  if (submitted.text !== null && adapter.parse) return adapter.parse({ text: submitted.text, ctx })
  return adapter.compile({ filters: submitted.filters, ctx })
}

export interface AtlasWorkbench {
  state: AtlasState
  dispatch: (action: AtlasAction) => void
  adapters: ModalityAdapter[]
  adapter: ModalityAdapter | null
  schema: SchemaTree
  schemaLoading: boolean
  result: ResultSet | null
  resultLoading: boolean
  resultError: string | null
  projection: ResultProjection | null
  renderers: AtlasRenderer[]
  renderer: AtlasRenderer | null
  /** `describe(compile(filters))`, or the user's edited text once they have touched it. */
  consoleText: string
  select: (selection: Selection | null) => void
}

function useSchema(adapter: ModalityAdapter | null, ctx: AtlasContext) {
  return useQuery({
    queryKey: ['atlas', 'schema', adapter?.id ?? '', ctx.graph],
    enabled: adapter !== null,
    queryFn: ({ signal }) => (adapter ? adapter.introspect({ ctx, signal }) : Promise.resolve(EMPTY_SCHEMA)),
  })
}

function useResult(adapter: ModalityAdapter | null, submitted: SubmittedQuery | null) {
  return useQuery({
    queryKey: ['atlas', 'result', submitted?.adapterId ?? '', submitted?.nonce ?? 0],
    enabled: adapter !== null && submitted !== null,
    // A result is a point-in-time answer to an explicit Run; refetching it behind the
    // user's back would swap the canvas under a selection they are inspecting.
    refetchOnWindowFocus: false,
    queryFn: ({ signal }) => {
      if (!adapter || !submitted) throw new Error('no query submitted')
      return adapter.execute({ query: queryFromSubmission(adapter, submitted), ctx: submitted.ctx, signal })
    },
  })
}

function describeCurrent(adapter: ModalityAdapter | null, state: AtlasState): string {
  if (state.consoleDirty) return state.consoleText
  if (!adapter) return ''
  try {
    return adapter.describe(adapter.compile({ filters: state.filters, ctx: state.ctx }))
  } catch {
    return ''
  }
}

/** The whole `/explore` page state, in one hook. */
export function useAtlas(adapters: ModalityAdapter[] = atlasAdapters()): AtlasWorkbench {
  const [state, dispatch] = useReducer(atlasReducer, adapters[0]?.id ?? '', initialAtlasState)
  const adapter = useMemo(() => adapters.find((a) => a.id === state.adapterId) ?? null, [adapters, state.adapterId])

  const schemaQuery = useSchema(adapter, state.ctx)
  const resultQuery = useResult(adapter, state.submitted)
  const result = resultQuery.data ?? null

  const projection = useMemo(() => (adapter && result ? projectResult(adapter, result) : null), [adapter, result])
  const renderer = useMemo(
    () => (projection ? selectRenderer(projection, state.rendererId) : null),
    [projection, state.rendererId],
  )
  const renderers = useMemo(() => (projection ? acceptingRenderers(projection) : []), [projection])
  const select = useCallback((selection: Selection | null) => {
    dispatch({ type: 'select', selection })
  }, [])

  return {
    state,
    dispatch,
    adapters,
    adapter,
    schema: schemaQuery.data ?? EMPTY_SCHEMA,
    schemaLoading: schemaQuery.isFetching,
    result,
    resultLoading: resultQuery.isFetching,
    resultError: resultQuery.error ? String(resultQuery.error) : null,
    projection,
    renderers,
    renderer,
    consoleText: describeCurrent(adapter, state),
    select,
  }
}
