/**
 * @file adapters/sparql.ts
 * @description Reference adapter #2 — RDF / OWL over SPARQL 1.1.
 *
 * The complement of `graph.ts` in every way that matters for proving the interface is
 * real: it HAS a textual query language (so `parse` is implemented and the console is
 * a live editor), it pushes its filters DOWN into the query rather than filtering in
 * the browser, and its results arrive as bindings rather than as a graph — yet it
 * still reaches the 3D renderer, through `triplesToGraph`. Two adapters, two entirely
 * different shapes, one workbench.
 *
 * Transport is `POST /api/sparql` (au's local, zero-dependency SPARQL 1.1 bridge in
 * front of eg's `:7878`), the same route `SparqlView.tsx` already uses.
 */
import { Share2 } from 'lucide-react'

import type { CompileRequest, ExecuteRequest, IntrospectRequest, ModalityAdapter, PivotRequest } from '../adapter'
import { triplesToGraph } from '../projection'
import { toDisplayText } from '../text'
import { atlasPost, type AtlasFetchResult } from '../transport'
import type {
  AdapterCapabilities,
  FilterClause,
  FilterOperator,
  GraphProjection,
  Pivot,
  ResultSet,
  RowSet,
  SchemaNode,
  SchemaTree,
} from '../types'
import { EMPTY_FILTER_SET } from '../types'

const ID = 'sparql'
const ROUTE = '/api/sparql'
const CLASS_PROBE = 'SELECT DISTINCT ?class WHERE { ?s a ?class } LIMIT 100'

export interface SparqlQuery {
  text: string
}

export type SparqlTerm = { type?: string; value: string } | undefined

export interface SparqlPayload {
  vars: string[]
  bindings: Record<string, SparqlTerm>[]
}

interface SparqlWireResponse {
  status?: string
  message?: string
  head?: { vars?: string[] }
  results?: { bindings?: Record<string, SparqlTerm>[] }
}

const SUPPORTED_OPERATORS: readonly FilterOperator[] = ['eq', 'neq', 'contains', 'startsWith']

const CAPABILITIES: AdapterCapabilities = {
  introspect: true,
  filters: SUPPORTED_OPERATORS,
  freeTextSearch: true,
  // Ordering is expressible in SPARQL but the facet UI's `sort.field` is a column
  // name, not a bound variable, and the two only coincide by luck. Declared false
  // rather than silently sorting the wrong thing.
  sort: false,
  rawQuery: true,
  rawQueryLanguage: 'sparql',
  graphProjection: true,
  pivots: true,
  live: false,
  notes: {
    sort: 'Use ORDER BY in the query text; the facet sort does not map onto bound variables.',
    filters: 'Filters compile into FILTER clauses on ?s / ?p / ?o and run server-side.',
  },
}

// ---------------------------------------------------------------------------
// compile
// ---------------------------------------------------------------------------

/** SPARQL string-literal escaping. Without this a quote in a filter value ends the query. */
export function escapeSparqlLiteral(value: unknown): string {
  return toDisplayText(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')
}

/** The three bound variables this adapter exposes; anything else falls back to the object. */
function variableFor(field: string): string {
  const normalized = field.toLowerCase()
  if (normalized === 's' || normalized === 'subject') return '?s'
  if (normalized === 'p' || normalized === 'predicate') return '?p'
  return '?o'
}

type FragmentBuilder = (variable: string, literal: string) => string

/**
 * Partial on purpose: only four of the eleven operators have a SPARQL form here, and
 * `SUPPORTED_OPERATORS` above must stay in step with these keys. Typing it `Partial`
 * is what makes `fragmentFor`'s miss check real rather than dead code.
 */
const FRAGMENTS: Partial<Record<FilterOperator, FragmentBuilder>> = {
  eq: (variable, literal) => `STR(${variable}) = "${literal}"`,
  neq: (variable, literal) => `STR(${variable}) != "${literal}"`,
  contains: (variable, literal) => `CONTAINS(LCASE(STR(${variable})), LCASE("${literal}"))`,
  startsWith: (variable, literal) => `STRSTARTS(LCASE(STR(${variable})), LCASE("${literal}"))`,
}

function fragmentFor(clause: FilterClause): string | null {
  const build = FRAGMENTS[clause.op]
  if (!build) return null
  return build(variableFor(clause.field), escapeSparqlLiteral(clause.value))
}

function searchFragment(search: string): string | null {
  const trimmed = search.trim()
  if (trimmed === '') return null
  const literal = escapeSparqlLiteral(trimmed)
  return `CONTAINS(LCASE(STR(?o)), LCASE("${literal}")) || CONTAINS(LCASE(STR(?s)), LCASE("${literal}"))`
}

/**
 * `FilterSet` → a SPARQL SELECT over `?s ?p ?o`.
 *
 * Every clause becomes a FILTER, so the SERVER does the work and `limit` is a real
 * bound rather than a client-side slice of an already-truncated page.
 */
export function compileSparql({ filters, ctx }: CompileRequest): SparqlQuery {
  const clauseFragments = filters.clauses.map(fragmentFor).filter((fragment): fragment is string => fragment !== null)
  const joined = clauseFragments.join(filters.combinator === 'or' ? ' || ' : ' && ')
  const parts = [joined, searchFragment(filters.search)].filter((part): part is string => part !== null && part !== '')
  const filterLine = parts.length > 0 ? `\n  FILTER(${parts.map((part) => `(${part})`).join(' && ')})` : ''
  const limit = Math.min(filters.limit, ctx.limit)
  return { text: `SELECT ?s ?p ?o WHERE {\n  ?s ?p ?o.${filterLine}\n} LIMIT ${String(limit)}` }
}

// ---------------------------------------------------------------------------
// introspect / execute
// ---------------------------------------------------------------------------

const FIELD_NODES: SchemaNode[] = [
  { id: 's', label: '?s (subject)', kind: 'field', dataType: 'string' },
  { id: 'p', label: '?p (predicate)', kind: 'field', dataType: 'string' },
  { id: 'o', label: '?o (object)', kind: 'field', dataType: 'string' },
]

function classSeedQuery(iri: string): string {
  return `SELECT ?s ?p ?o WHERE {\n  ?s a <${iri}>.\n  ?s ?p ?o.\n} LIMIT 200`
}

const NO_BINDINGS: SparqlPayload = { vars: [], bindings: [] }

/**
 * Why this response is not usable, or `null` when it is.
 *
 * Two distinct failures collapse here on purpose: the transport never reached the
 * bridge, OR the bridge answered HTTP 200 carrying `status: 'error'` for a query it
 * refused. Both reach the user as `degraded` — a caveat beside the result rather than
 * a thrown exception — and the bridge's own message is preferred when it has one.
 */
function bridgeFailure(res: AtlasFetchResult<SparqlWireResponse>): string | null {
  if (!res.ok || !res.data) return res.error ?? 'SPARQL bridge unreachable.'
  const { status, message } = res.data
  if (status !== undefined && status !== 'success') return message ?? 'SPARQL query failed.'
  return null
}

/** SPARQL-JSON `{head:{vars}, results:{bindings}}` → this adapter's payload. */
function bindingsFrom(body: SparqlWireResponse): SparqlPayload {
  return { vars: body.head?.vars ?? [], bindings: body.results?.bindings ?? [] }
}

async function runQuery(text: string, signal: AbortSignal): Promise<{ payload: SparqlPayload; error: string | null }> {
  const res = await atlasPost<SparqlWireResponse>(ROUTE, { query: text }, signal)
  const failure = bridgeFailure(res)
  if (failure !== null || !res.data) return { payload: NO_BINDINGS, error: failure ?? 'SPARQL bridge unreachable.' }
  return { payload: bindingsFrom(res.data), error: null }
}

async function introspect({ signal }: IntrospectRequest): Promise<SchemaTree> {
  const { payload, error } = await runQuery(CLASS_PROBE, signal)
  if (error !== null) return { adapterId: ID, roots: [], unavailable: true, note: error }
  const classes: SchemaNode[] = payload.bindings.flatMap((binding) => {
    const iri = binding.class?.value
    if (!iri) return []
    return [{ id: `class:${iri}`, label: iri, kind: 'collection' as const, seedQuery: classSeedQuery(iri) }]
  })
  return {
    adapterId: ID,
    roots: [
      { id: 'classes', label: 'Classes', kind: 'source', children: classes },
      { id: 'fields', label: 'Bound variables', kind: 'source', children: FIELD_NODES },
    ],
    unavailable: false,
  }
}

async function execute({ query, signal }: ExecuteRequest<SparqlQuery>): Promise<ResultSet<SparqlPayload>> {
  const started = Date.now()
  const { payload, error } = await runQuery(query.text, signal)
  return {
    adapterId: ID,
    shape: payload.bindings.length === 0 ? 'empty' : 'rows',
    payload,
    stats: { elapsedMs: Date.now() - started, rowCount: payload.bindings.length, truncated: false },
    degraded: error,
    sources: [],
  }
}

// ---------------------------------------------------------------------------
// projections
// ---------------------------------------------------------------------------

function termText(term: SparqlTerm): string {
  return term?.value ?? ''
}

function toRows(result: ResultSet<SparqlPayload>): RowSet {
  const vars = result.payload.vars
  return {
    columns: vars.map((name) => ({ key: name, label: `?${name}`, type: 'string' as const })),
    rows: result.payload.bindings.map((binding) => Object.fromEntries(vars.map((v) => [v, termText(binding[v])]))),
  }
}

/** The three variables that carry a triple, when the result is one. */
function tripleVars(vars: string[]): [string, string, string] | null {
  if (vars.includes('s') && vars.includes('p') && vars.includes('o')) return ['s', 'p', 'o']
  if (vars.length === 3) return [vars[0], vars[1], vars[2]]
  return null
}

/**
 * Bindings → a graph. A triple-shaped result becomes a real RDF graph; anything else
 * declines rather than inventing edges between unrelated columns.
 */
function toGraph(result: ResultSet<SparqlPayload>): GraphProjection {
  const columns = tripleVars(result.payload.vars)
  if (!columns) {
    return {
      nodes: [],
      edges: [],
      truncated: false,
      note: 'This projection needs a triple-shaped result — select ?s ?p ?o (or exactly three variables).',
    }
  }
  const [s, p, o] = columns
  return triplesToGraph(
    result.payload.bindings.map((binding) => ({
      subject: termText(binding[s]),
      predicate: termText(binding[p]),
      object: termText(binding[o]),
    })),
  )
}

function pivots({ selection }: PivotRequest<SparqlPayload>): Pivot[] {
  if (!/^(https?:|urn:)\S+$/i.test(selection.id)) return []
  return [
    {
      id: `sparql:describe:${selection.id}`,
      label: 'Describe this resource',
      description: 'Every predicate and object asserted about the selected IRI.',
      targetAdapterId: ID,
      filters: EMPTY_FILTER_SET,
      seedQuery: `SELECT ?s ?p ?o WHERE {\n  VALUES ?s { <${selection.id}> }\n  ?s ?p ?o.\n} LIMIT 200`,
    },
  ]
}

const sparqlAdapter: ModalityAdapter<SparqlQuery, SparqlPayload> = {
  id: ID,
  label: 'SPARQL / RDF',
  description: 'The OWL/RDF side of the graph, queried with SPARQL 1.1.',
  icon: Share2,
  capabilities: () => CAPABILITIES,
  introspect,
  compile: compileSparql,
  describe: (query) => query.text,
  parse: ({ text }) => ({ text }),
  execute,
  toRows,
  toGraph,
  pivots,
}

export default sparqlAdapter
