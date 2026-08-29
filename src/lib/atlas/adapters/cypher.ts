/**
 * @file adapters/cypher.ts
 * @description Read-only Cypher over graph-os's governed graph-query surface.
 *
 * The canonical REST twin (`/api/graph/query`) is used instead of the
 * admin-only enhanced route used by CypherReplView: it carries Atlas's explicit
 * physical-graph context in the governed request envelope. Query construction and
 * response decoding live in named sibling modules so this adapter remains the
 * modality-facing orchestration seam.
 */
import { Workflow } from 'lucide-react'

import type { ExecuteRequest, IntrospectRequest, ModalityAdapter, PivotRequest } from '../adapter'
import { rowsToGraph } from '../projection'
import { atlasGet, atlasPost, type AtlasFetchResult } from '../transport'
import type { AdapterCapabilities, Column, GraphProjection, Pivot, ResultSet, Row, RowSet, SchemaTree } from '../types'
import { EMPTY_FILTER_SET, MINIMAL_FILTER_OPERATORS } from '../types'
import {
  CYPHER_RESPONSE_SCHEMA,
  NODE_TYPE_RESPONSE_SCHEMA,
  parsePayload,
  partialReason,
  responseError,
} from './cypher-contract'
import type { CypherPayload, CypherQuery, CypherResponse, NodeTypeResponse } from './cypher-contract'
import {
  boundedLimit,
  compileCypher,
  countTypes,
  CypherSafetyError,
  escapeCypherString,
  rawQueryError,
  requestBody,
  schemaTree,
  SERVER_RESULT_LIMIT,
  terminalLimit,
  TYPE_LIMIT,
} from './cypher-query'

export type { CypherPayload, CypherQuery, CypherResponseMetadata } from './cypher-contract'
export { compileCypher, CypherCompileError, CypherSafetyError } from './cypher-query'

const ID = 'cypher'
const QUERY_ROUTE = '/api/graph/query'
const NODE_TYPES_ROUTE = '/api/enhanced/graph/node-types'

const CAPABILITIES: AdapterCapabilities = {
  introspect: true,
  filters: MINIMAL_FILTER_OPERATORS,
  freeTextSearch: true,
  sort: true,
  rawQuery: true,
  rawQueryLanguage: 'cypher',
  graphProjection: true,
  pivots: true,
  live: false,
  notes: {
    filters:
      'Facet filters push down into generated Cypher over id, name, and node_type. Unsupported fields/operators are rejected before execution.',
    graphProjection:
      'Rows project as nodes; columns ending in _id become heuristic links when they match another row id.',
    limit: `Generated and raw queries carry one terminal server-side LIMIT (at most ${String(SERVER_RESULT_LIMIT)}, the governed route ceiling). Atlas never slices raw rows in the browser; truncation is shown only when the backend reports it.`,
    rawQuery:
      'Raw Cypher is enabled only for a single statement with one terminal literal LIMIT at or below the active cap. Unsafe text is rejected before network execution.',
  },
}

function emptyResult(
  degraded: string,
  elapsedMs: number,
  metadata?: CypherPayload['metadata'],
): ResultSet<CypherPayload> {
  return {
    adapterId: ID,
    shape: 'empty',
    payload: {
      rows: [],
      connection: null,
      graph: null,
      errors: null,
      ...(metadata ? { metadata } : {}),
    },
    stats: { elapsedMs, rowCount: 0, truncated: false },
    degraded,
    sources: [],
  }
}

function resultFromPayload(payload: CypherPayload, elapsedMs: number): ResultSet<CypherPayload> {
  const rows = payload.rows
  const truncated = payload.metadata?.truncated === true || payload.metadata?.hasMore === true
  return {
    adapterId: ID,
    shape: rows.length > 0 ? 'rows' : 'empty',
    payload,
    stats: {
      elapsedMs,
      rowCount: rows.length,
      truncated,
      note: truncated ? 'The graph backend reported that this result is incomplete.' : undefined,
    },
    degraded: partialReason(payload),
    sources: payload.metadata?.sourceGraphs ?? [],
  }
}

function resultFromResponse(response: AtlasFetchResult<CypherResponse>, elapsedMs: number): ResultSet<CypherPayload> {
  if (!response.ok || response.data === null) {
    return emptyResult(response.error ?? 'The Cypher graph surface is not reachable.', elapsedMs)
  }
  const failure = responseError(response.data)
  if (failure !== null) return emptyResult(failure, elapsedMs)
  const parsed = parsePayload(response.data)
  return parsed.payload
    ? resultFromPayload(parsed.payload, elapsedMs)
    : emptyResult(parsed.error ?? 'Cypher result could not be read.', elapsedMs)
}

async function execute({ query, ctx, signal }: ExecuteRequest<CypherQuery>): Promise<ResultSet<CypherPayload>> {
  const safetyError = rawQueryError(query, ctx.limit)
  if (safetyError !== null) return emptyResult(safetyError, 0)
  const started = Date.now()
  const response = await atlasPost<CypherResponse>(
    QUERY_ROUTE,
    requestBody(query, ctx.graph),
    signal,
    CYPHER_RESPONSE_SCHEMA,
  )
  return resultFromResponse(response, Date.now() - started)
}

function columnsFor(rows: Row[]): Column[] {
  return [...new Set(rows.flatMap((row) => Object.keys(row)))].map((key) => ({
    key,
    label: key,
    type: 'unknown' as const,
  }))
}

function toRows(result: ResultSet<CypherPayload>): RowSet {
  return { columns: columnsFor(result.payload.rows), rows: result.payload.rows }
}

function toGraph(result: ResultSet<CypherPayload>): GraphProjection {
  const rowSet = toRows(result)
  const keys = new Set(rowSet.columns.map((column) => column.key))
  return rowsToGraph(rowSet, {
    labelColumn: keys.has('name') ? 'name' : undefined,
    typeColumn: keys.has('type') ? 'type' : keys.has('node_type') ? 'node_type' : undefined,
    linkColumns: rowSet.columns
      .map((column) => column.key)
      .filter((key) => /_id$/i.test(key) && key.toLowerCase() !== 'id'),
    defaultType: 'Cypher row',
  })
}

function looksLikeIri(value: string): boolean {
  return /^(?:https?:|urn:)[^<>\s]+$/i.test(value)
}

function pivots({ selection }: PivotRequest<CypherPayload>): Pivot[] {
  const offers: Pivot[] = []
  const type =
    typeof selection.data.type === 'string'
      ? selection.data.type
      : typeof selection.data.node_type === 'string'
        ? selection.data.node_type
        : selection.type
  if (type) {
    offers.push({
      id: `cypher:type:${type}`,
      label: `All ${type} nodes in Cypher`,
      description: 'Run a bounded Cypher read for this node type.',
      targetAdapterId: ID,
      filters: { ...EMPTY_FILTER_SET, clauses: [{ id: 'pivot-type', field: 'type', op: 'eq', value: type }] },
    })
  }
  if (looksLikeIri(selection.id)) {
    offers.push({
      id: `sparql:describe:${selection.id}`,
      label: 'Describe in SPARQL',
      description: 'Open this IRI in the RDF modality.',
      targetAdapterId: 'sparql',
      filters: EMPTY_FILTER_SET,
      seedQuery: `SELECT ?s ?p ?o WHERE { <${selection.id}> ?p ?o } LIMIT 100`,
    })
  }
  if (selection.id) {
    offers.unshift({
      id: `cypher:node:${selection.id}`,
      label: 'Inspect this node in Cypher',
      description: 'Fetch the selected node by its stable id.',
      targetAdapterId: ID,
      filters: EMPTY_FILTER_SET,
      seedQuery:
        `MATCH (n) WHERE n.id = ${escapeCypherString(selection.id)} ` +
        'RETURN n.id AS id, n.name AS name, n.node_type AS type LIMIT 1',
    })
  }
  return offers
}

async function introspectExplicitGraph(request: IntrospectRequest, graph: string): Promise<SchemaTree> {
  const limit = Math.min(TYPE_LIMIT, boundedLimit(EMPTY_FILTER_SET, request.ctx.limit))
  const query: CypherQuery = {
    text:
      `MATCH (n) WHERE n.node_type IS NOT NULL RETURN n.node_type AS type, count(*) AS count ` +
      `ORDER BY count DESC LIMIT ${String(limit)}`,
    params: {},
    graph,
    limit,
  }
  const result = await execute({ query, ctx: request.ctx, signal: request.signal })
  return result.degraded
    ? { adapterId: ID, roots: [], unavailable: true, note: result.degraded }
    : schemaTree(countTypes(result.payload.rows))
}

function nodeTypeNotes(data: NodeTypeResponse): string | undefined {
  const notes = [
    data.degraded_graphs?.length ? `Skipped graphs: ${data.degraded_graphs.join(', ')}` : null,
    data.truncated ? `Only the first ${String(TYPE_LIMIT)} node types are shown.` : null,
  ].filter((item): item is string => item !== null)
  return notes.length > 0 ? notes.join(' ') : undefined
}

function schemaFromNodeTypes(response: AtlasFetchResult<NodeTypeResponse>): SchemaTree {
  if (!response.ok || !response.data) {
    return {
      adapterId: ID,
      roots: [],
      unavailable: true,
      note: response.error ?? 'Node-type introspection is unavailable.',
    }
  }
  if (response.data.available === false) {
    return { adapterId: ID, roots: [], unavailable: true, note: 'The graph engine cannot enumerate node types yet.' }
  }
  if (response.data.by_type === undefined) {
    return {
      adapterId: ID,
      roots: [],
      unavailable: true,
      note: 'Node-type introspection returned no breakdown.',
    }
  }
  return schemaTree(response.data.by_type, nodeTypeNotes(response.data))
}

async function introspectUnion(signal: AbortSignal): Promise<SchemaTree> {
  const response = await atlasGet<NodeTypeResponse>(NODE_TYPES_ROUTE, signal, NODE_TYPE_RESPONSE_SCHEMA)
  return schemaFromNodeTypes(response)
}

async function introspect(request: IntrospectRequest): Promise<SchemaTree> {
  return request.ctx.graph === null
    ? introspectUnion(request.signal)
    : introspectExplicitGraph(request, request.ctx.graph)
}

const cypherAdapter: ModalityAdapter<CypherQuery, CypherPayload> = {
  id: ID,
  label: 'Cypher / Property Graph',
  description: 'Read and project the property graph through the governed Cypher surface.',
  icon: Workflow,
  capabilities: () => CAPABILITIES,
  introspect,
  compile: compileCypher,
  describe: (query) => query.text,
  parse: ({ text, ctx }) => {
    const limit = terminalLimit(text)
    const query = { text, params: {}, graph: ctx.graph, limit }
    const safetyError = rawQueryError(query, ctx.limit)
    if (safetyError !== null) throw new CypherSafetyError(safetyError)
    return query
  },
  execute,
  toRows,
  toGraph,
  pivots,
}

export default cypherAdapter
