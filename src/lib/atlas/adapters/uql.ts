/**
 * @file adapters/uql.ts
 * @description Native UQL adapter; the engine remains the grammar authority.
 * UQL is sent unchanged and its governed evidence/plan/provenance stay attached.
 */
import { Braces } from 'lucide-react'

import type { ExecuteRequest, IntrospectRequest, ModalityAdapter } from '../adapter'
import { rowsToGraph } from '../projection'
import { atlasGet, atlasPost, type AtlasFetchResult } from '../transport'
import type {
  AdapterCapabilities,
  Column,
  GraphProjection,
  ResultSet,
  Row,
  RowSet,
  SchemaNode,
  SchemaTree,
} from '../types'
import {
  UQL_NODE_TYPE_RESPONSE_SCHEMA,
  UQL_RESPONSE_SCHEMA,
  type UqlNodeTypeResponse,
  type UqlPayload,
  type UqlQuery,
  type UqlWireResponse,
} from './uql-contract'
import { decodeUqlResponse, emptyUqlPayload } from './uql-response'
import { boundedUqlLimit, compileUql, parseUql, rawQueryError, UQL_SERVER_RESULT_LIMIT } from './uql-query'

export type {
  UqlEvidenceBundle,
  UqlPayload,
  UqlProvenance,
  UqlQuery,
  UqlQueryPlan,
  UqlResponseMetadata,
} from './uql-contract'
export { boundedUqlLimit, compileUql, parseUql, UqlCompileError, UqlSafetyError } from './uql-query'

const ID = 'uql'
const QUERY_ROUTE = '/api/graph/query'
const NODE_TYPES_ROUTE = '/api/enhanced/graph/node-types'
const TYPE_LIMIT = 200

const CAPABILITIES: AdapterCapabilities = {
  introspect: true,
  filters: ['eq', 'gt', 'lt'],
  freeTextSearch: true,
  sort: false,
  rawQuery: true,
  rawQueryLanguage: 'uql',
  graphProjection: true,
  pivots: false,
  live: false,
  notes: {
    filters:
      'Native UQL WHERE supports equality and non-negative numeric comparisons; free text uses the native TEXT stage. ' +
      'Unsupported facet operators are rejected instead of dropped.',
    sort: 'UQL has no modality-neutral sort stage. Use native RANK/RERANK stages in the query text.',
    graphProjection:
      'UQL results project as an unconnected candidate cloud. Relationships are never inferred from claim fields; ' +
      'use a graph or Cypher modality for explicit edges.',
    rawQuery: `Raw UQL is sent to the engine unchanged, but Atlas requires one terminal literal LIMIT at or below ${String(
      UQL_SERVER_RESULT_LIMIT,
    )}.`,
  },
}

function fieldColumns(rows: Row[]): Column[] {
  return [...new Set(rows.flatMap((row) => Object.keys(row)))].map((key) => ({
    key,
    label: key,
    type: 'unknown' as const,
  }))
}

function toRows(result: ResultSet<UqlPayload>): RowSet {
  return { columns: fieldColumns(result.payload.rows), rows: result.payload.rows }
}

function claimsOnlyProjection(): GraphProjection {
  return {
    nodes: [],
    edges: [],
    truncated: false,
    note: 'Claims-only fallback is table-readable but not projectable as graph nodes or edges.',
  }
}

function toGraph(result: ResultSet<UqlPayload>): GraphProjection {
  if (result.payload.metadata.rowSource === 'claims') return claimsOnlyProjection()
  const rowSet = toRows(result)
  const typeColumn = rowSet.columns.some((column) => column.key === 'type') ? 'type' : undefined
  return rowsToGraph(rowSet, {
    keyColumn: rowSet.columns.some((column) => column.key === 'id') ? 'id' : undefined,
    labelColumn: rowSet.columns.some((column) => column.key === 'name') ? 'name' : undefined,
    typeColumn,
    defaultType: 'UQL result',
  })
}

function labelIdentifier(label: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(label)
}

function typeChildren(byType: Record<string, number>, limit: number): SchemaNode[] {
  return Object.entries(byType)
    .filter(([, count]) => Number.isFinite(count))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([label, count]) => ({
      id: `type:${label}`,
      label,
      kind: 'collection' as const,
      count,
      seedQuery: labelIdentifier(label) ? `MATCH (:${label}) |> LIMIT ${String(limit)}` : undefined,
    }))
}

type UqlNodeTypeCatalog = UqlNodeTypeResponse & {
  by_type: Record<string, number>
}

function hasNodeTypeCatalog(
  response: AtlasFetchResult<UqlNodeTypeResponse>,
): response is AtlasFetchResult<UqlNodeTypeCatalog> {
  if (!response.ok || response.data === null) return false
  if (response.data.available === false) return false
  return response.data.by_type !== undefined
}

function unavailableSchemaTree(response: AtlasFetchResult<UqlNodeTypeResponse>): SchemaTree {
  if (!response.ok || response.data === null) {
    return {
      adapterId: ID,
      roots: [],
      unavailable: true,
      note: response.error ?? 'UQL schema is unavailable.',
    }
  }
  if (response.data.available === false) {
    return {
      adapterId: ID,
      roots: [],
      unavailable: true,
      note: 'The graph engine cannot enumerate UQL labels yet.',
    }
  }
  return {
    adapterId: ID,
    roots: [],
    unavailable: true,
    note: 'UQL schema returned no label breakdown.',
  }
}

function schemaNotes(data: UqlNodeTypeCatalog, limit: number): string | undefined {
  const notes = [
    data.partial ? 'The label catalog is partial.' : null,
    data.degraded_graphs?.length ? `Skipped graphs: ${data.degraded_graphs.join(', ')}` : null,
    data.truncated ? `Only the first ${String(limit)} labels are shown.` : null,
  ].filter((note): note is string => note !== null)
  return notes.length > 0 ? notes.join(' ') : undefined
}

function resultFieldNodes(): SchemaNode[] {
  return [
    { id: 'id', label: 'id', kind: 'field', dataType: 'string' },
    { id: 'score', label: 'score', kind: 'field', dataType: 'number' },
  ]
}

function schemaRoots(data: UqlNodeTypeCatalog, limit: number): SchemaNode[] {
  return [
    {
      id: 'types',
      label: 'Node labels',
      kind: 'source',
      children: typeChildren(data.by_type, limit),
    },
    {
      id: 'fields',
      label: 'Result fields',
      kind: 'source',
      children: resultFieldNodes(),
    },
  ]
}

function schemaTree(response: AtlasFetchResult<UqlNodeTypeResponse>, limit: number): SchemaTree {
  if (!hasNodeTypeCatalog(response) || response.data === null) return unavailableSchemaTree(response)
  const { data } = response
  return {
    adapterId: ID,
    roots: schemaRoots(data, limit),
    unavailable: false,
    note: schemaNotes(data, limit),
  }
}

function nodeTypesRoute(graph: string | null): string {
  return graph === null ? NODE_TYPES_ROUTE : `${NODE_TYPES_ROUTE}?graph=${encodeURIComponent(graph)}`
}

async function introspect(request: IntrospectRequest): Promise<SchemaTree> {
  const response = await atlasGet<UqlNodeTypeResponse>(
    nodeTypesRoute(request.ctx.graph),
    request.signal,
    UQL_NODE_TYPE_RESPONSE_SCHEMA,
  )
  return schemaTree(
    response,
    boundedUqlLimit({ search: '', combinator: 'and', clauses: [], sort: null, limit: TYPE_LIMIT }, request.ctx.limit),
  )
}

function requestBody(ctxGraph: string | null, query: UqlQuery): Record<string, unknown> {
  return {
    query: query.text,
    // UQL has no parameter-binding surface. Send the explicit empty object
    // required by the governed graph_query REST contract rather than relying
    // on the server-side default for an omitted field.
    params: '{}',
    scope: 'uql',
    // The execution context wins when a compiled query outlives a context-bar change.
    graph: ctxGraph ?? '',
  }
}

function emptyResult(degraded: string | null, elapsedMs: number): ResultSet<UqlPayload> {
  return {
    adapterId: ID,
    shape: 'empty',
    payload: emptyUqlPayload(),
    stats: { elapsedMs, rowCount: 0, truncated: false },
    degraded,
    sources: [],
  }
}

function resultFromResponse(response: AtlasFetchResult<UqlWireResponse>, elapsedMs: number): ResultSet<UqlPayload> {
  if (!response.ok || response.data === null) {
    return emptyResult(response.error ?? 'The UQL engine surface is not reachable.', elapsedMs)
  }
  const decoded = decodeUqlResponse(response.data)
  if (decoded.payload === null) {
    return emptyResult(decoded.error ?? 'UQL result could not be decoded.', elapsedMs)
  }
  const { payload } = decoded
  const note =
    payload.metadata.rowSource === 'claims'
      ? 'The route exposed EvidenceBundle claims but no raw rows; claims are shown in the bounded table-only result.'
      : payload.metadata.truncated
        ? 'The UQL backend reported that this result is incomplete.'
        : undefined
  return {
    adapterId: ID,
    shape: payload.rows.length > 0 ? 'rows' : 'empty',
    payload,
    stats: {
      elapsedMs,
      rowCount: payload.rows.length,
      truncated: payload.metadata.truncated,
      note,
    },
    degraded: decoded.error,
    sources: payload.metadata.provenance.sourceGraphs,
  }
}

async function execute(request: ExecuteRequest<UqlQuery>): Promise<ResultSet<UqlPayload>> {
  const safetyError = rawQueryError(request.query, request.ctx.limit)
  if (safetyError !== null) return emptyResult(safetyError, 0)
  const started = Date.now()
  const response = await atlasPost<UqlWireResponse>(
    QUERY_ROUTE,
    requestBody(request.ctx.graph, request.query),
    request.signal,
    // Transport validates the outer response; the decoder validates the nested trace rows.
    // Keeping the schema here makes malformed root rows fail before they reach the renderer.
    UQL_RESPONSE_SCHEMA,
  )
  return resultFromResponse(response, Date.now() - started)
}

const uqlAdapter: ModalityAdapter<UqlQuery, UqlPayload> = {
  id: ID,
  label: 'UQL / Unified Query',
  description:
    'Native cross-modal pipelines over graph, vector, text, temporal, epistemic, and registered foreign sources.',
  icon: Braces,
  capabilities: () => CAPABILITIES,
  introspect,
  compile: compileUql,
  describe: (query) => query.text,
  parse: parseUql,
  execute,
  toRows,
  toGraph,
}

export default uqlAdapter
