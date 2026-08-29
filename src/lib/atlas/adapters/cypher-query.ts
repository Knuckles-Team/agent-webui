/**
 * @file adapters/cypher-query.ts
 * @description Bounded Cypher compilation, raw-query safety, and schema seeds.
 *
 * This module owns all text that can cross the governed graph-query boundary. The
 * adapter can therefore orchestrate transport and render results without mixing query
 * construction with response decoding.
 */
import type { CompileRequest } from '../adapter'
import type { FilterClause, FilterOperator, FilterSet, Row, SchemaNode, SchemaTree } from '../types'
import type { CypherQuery } from './cypher-contract'

export const TYPE_LIMIT = 200
/** The governed webui route clips external collections at this many rows. */
export const SERVER_RESULT_LIMIT = 256

const ID = 'cypher'
const WRITE_OR_CONTEXT_CLAUSE = /\b(?:call|create|delete|detach|drop|foreach|load\s+csv|merge|remove|set|use)\b/i
const FIELD_EXPRESSIONS: Readonly<Record<string, string>> = {
  id: 'n.id',
  name: 'n.name',
  type: 'n.node_type',
  node_type: 'n.node_type',
}

export class CypherCompileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CypherCompileError'
  }
}

export class CypherSafetyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CypherSafetyError'
  }
}

type FragmentBuilder = (field: string, parameter: string) => string
const FRAGMENTS: Partial<Record<FilterOperator, FragmentBuilder>> = {
  eq: (field, parameter) => `${field} = $${parameter}`,
  neq: (field, parameter) => `${field} != $${parameter}`,
  contains: (field, parameter) => `toLower(${field}) CONTAINS toLower($${parameter})`,
}

export function boundedLimit(filters: FilterSet, ctxLimit: number): number {
  const context = Number.isFinite(ctxLimit) ? Math.max(0, Math.floor(ctxLimit)) : 0
  const requested = Number.isFinite(filters.limit) ? Math.floor(filters.limit) : context
  return Math.max(0, Math.min(requested, context, SERVER_RESULT_LIMIT))
}

function fieldExpression(field: string): string | null {
  return typeof field === 'string' ? (FIELD_EXPRESSIONS[field.toLowerCase()] ?? null) : null
}

function clauseFragment(clause: FilterClause, index: number, params: CypherQuery['params']): string {
  const field = fieldExpression(clause.field)
  const build = FRAGMENTS[clause.op]
  if (!field) throw new CypherCompileError(`Unsupported Cypher filter field: ${clause.field}`)
  if (!build) throw new CypherCompileError(`Unsupported Cypher filter operator: ${clause.op}`)
  const parameter = `atlas_filter_${String(index)}`
  params[parameter] = clause.value ?? ''
  return build(field, parameter)
}

function searchFragment(search: string, params: CypherQuery['params']): string | null {
  const needle = search.trim()
  if (!needle) return null
  params.atlas_search = needle
  return [FIELD_EXPRESSIONS.id, FIELD_EXPRESSIONS.name, FIELD_EXPRESSIONS.type]
    .map((field) => `toLower(${field}) CONTAINS toLower($atlas_search)`)
    .join(' OR ')
}

function whereClause(filters: FilterSet, params: CypherQuery['params']): string {
  const clauses = filters.clauses.map((clause, index) => clauseFragment(clause, index, params))
  const combined = clauses.length > 0 ? `(${clauses.join(filters.combinator === 'or' ? ' OR ' : ' AND ')})` : null
  const search = searchFragment(filters.search, params)
  const parts = [combined, search ? `(${search})` : null].filter((part): part is string => part !== null)
  return parts.length > 0 ? `\nWHERE ${parts.join(' AND ')}` : ''
}

function orderClause(sort: FilterSet['sort']): string {
  if (!sort) return ''
  const field = fieldExpression(sort.field)
  if (!field) throw new CypherCompileError(`Unsupported Cypher sort field: ${sort.field}`)
  return `\nORDER BY ${field} ${sort.direction.toUpperCase()}`
}

export function compileCypher({ filters, ctx }: CompileRequest): CypherQuery {
  const params: CypherQuery['params'] = {}
  const limit = boundedLimit(filters, ctx.limit)
  const text =
    `MATCH (n)${whereClause(filters, params)}\n` +
    `RETURN n.id AS id, n.name AS name, n.node_type AS type${orderClause(filters.sort)}\n` +
    `LIMIT ${String(limit)}`
  return { text, params, graph: ctx.graph, limit }
}

export function escapeCypherString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n')}'`
}

function typeNodes(byType: Record<string, number>): SchemaNode[] {
  return Object.entries(byType)
    .filter(([, count]) => Number.isFinite(count))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count]) => ({
      id: `type:${type}`,
      label: type,
      kind: 'collection' as const,
      count,
      seedQuery:
        `MATCH (n) WHERE n.node_type = ${escapeCypherString(type)} ` +
        `RETURN n.id AS id, n.name AS name, n.node_type AS type LIMIT ${String(TYPE_LIMIT)}`,
    }))
}

const FIELD_NODES: SchemaNode[] = [
  { id: 'id', label: 'id', kind: 'field', dataType: 'string' },
  { id: 'name', label: 'name', kind: 'field', dataType: 'string' },
  { id: 'type', label: 'type (node_type)', kind: 'field', dataType: 'string' },
]

export function schemaTree(byType: Record<string, number>, note?: string): SchemaTree {
  return {
    adapterId: ID,
    roots: [
      { id: 'types', label: 'Node types', kind: 'source', children: typeNodes(byType) },
      { id: 'fields', label: 'Fields', kind: 'source', children: FIELD_NODES },
    ],
    unavailable: false,
    note,
  }
}

export function countTypes(rows: Row[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const row of rows) {
    const type = typeof row.type === 'string' ? row.type : null
    const count = typeof row.count === 'number' ? row.count : Number(row.count)
    if (type && Number.isFinite(count)) counts[type] = count
  }
  return counts
}

export function terminalLimit(text: string): number | null {
  const trimmed = executableCypher(text).trim()
  if (trimmed === '' || trimmed.includes(';') || /\bunion\b/i.test(trimmed)) return null
  const occurrences = trimmed.match(/\blimit\b/gi)
  if (occurrences?.length !== 1) return null
  const match = /\blimit\s+([0-9]+)\s*$/i.exec(trimmed)
  if (!match) return null
  const limit = Number(match[1])
  return Number.isSafeInteger(limit) ? limit : null
}

type CypherMaskState = 'plain' | 'line-comment' | 'block-comment' | 'single-quote' | 'double-quote' | 'backtick'

interface CypherMaskStep {
  masked: string
  state: CypherMaskState
  skipNext: boolean
}

type CypherMaskHandler = (char: string | undefined, next: string | undefined) => CypherMaskStep

function quotedState(char: string): CypherMaskState {
  const states: Record<string, CypherMaskState> = {
    "'": 'single-quote',
    '"': 'double-quote',
    '`': 'backtick',
  }
  return states[char] ?? 'plain'
}

function visibleOrSpace(char: string | undefined): string {
  return char === '\n' ? '\n' : ' '
}

const plainMaskStep: CypherMaskHandler = (char, next) => {
  if (char === '/' && next === '/') return { masked: '  ', state: 'line-comment', skipNext: true }
  if (char === '/' && next === '*') return { masked: '  ', state: 'block-comment', skipNext: true }
  const state = char === undefined ? 'plain' : quotedState(char)
  return state === 'plain' ? { masked: char ?? '', state, skipNext: false } : { masked: ' ', state, skipNext: false }
}

const lineCommentMaskStep: CypherMaskHandler = (char) => ({
  masked: visibleOrSpace(char),
  state: char === '\n' ? 'plain' : 'line-comment',
  skipNext: false,
})

const blockCommentMaskStep: CypherMaskHandler = (char, next) =>
  char === '*' && next === '/'
    ? { masked: '  ', state: 'plain', skipNext: true }
    : { masked: visibleOrSpace(char), state: 'block-comment', skipNext: false }

function quotedMaskStep(
  state: CypherMaskState,
  quote: "'" | '"' | '`',
  char: string | undefined,
  next: string | undefined,
): CypherMaskStep {
  if (char === '\\') return { masked: '  ', state, skipNext: true }
  if (char === quote && next === quote) return { masked: '  ', state, skipNext: true }
  return {
    masked: visibleOrSpace(char),
    state: char === quote ? 'plain' : state,
    skipNext: false,
  }
}

function maskStep(state: CypherMaskState, char: string | undefined, next: string | undefined): CypherMaskStep {
  switch (state) {
    case 'line-comment':
      return lineCommentMaskStep(char, next)
    case 'block-comment':
      return blockCommentMaskStep(char, next)
    case 'single-quote':
      return quotedMaskStep(state, "'", char, next)
    case 'double-quote':
      return quotedMaskStep(state, '"', char, next)
    case 'backtick':
      return quotedMaskStep(state, '`', char, next)
    default:
      return plainMaskStep(char, next)
  }
}

/** Mask quoted text and comments before looking for executable clauses. */
function executableCypher(text: string): string {
  let masked = ''
  let state: CypherMaskState = 'plain'
  for (let index = 0; index < text.length; index += 1) {
    const step = maskStep(state, text[index], text[index + 1])
    masked += step.masked
    state = step.state
    if (step.skipNext) index += 1
  }
  return masked
}

export function rawQueryError(query: CypherQuery, ctxLimit: number): string | null {
  if (WRITE_OR_CONTEXT_CLAUSE.test(executableCypher(query.text))) {
    return 'Atlas accepts read-only Cypher clauses only; writes, procedures, imports, and graph-context changes are disabled.'
  }
  const parsedLimit = terminalLimit(query.text)
  if (parsedLimit === null) {
    return 'Raw Cypher is disabled until the query has one terminal literal LIMIT (for example, LIMIT 100).'
  }
  const contextLimit = Number.isFinite(ctxLimit) ? Math.min(Math.max(0, Math.floor(ctxLimit)), SERVER_RESULT_LIMIT) : 0
  if (parsedLimit > contextLimit) {
    return `Raw Cypher LIMIT ${String(parsedLimit)} exceeds the active cap of ${String(contextLimit)}.`
  }
  if (query.limit !== parsedLimit) {
    return 'The query limit changed after it was parsed; run it again to refresh the safety check.'
  }
  return null
}

export function requestBody(query: CypherQuery, ctxGraph: string | null): Record<string, unknown> {
  return {
    query: query.text,
    // The webui's governed route accepts this field as a JSON-encoded string;
    // its sibling federated route is the one that accepts a native object.
    params: JSON.stringify(query.params),
    scope: 'local',
    // A compiled query may outlive a context-bar change, so use the execution
    // context rather than the query's captured graph selector.
    graph: ctxGraph ?? '',
  }
}
