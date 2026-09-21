/**
 * @file adapters/uql-query.ts
 * @description Native UQL compilation and the browser-side safety boundary.
 *
 * The engine owns the authoritative UQL parser. This module does not translate
 * Cypher or SQL, and it does not attempt to duplicate that parser. It only
 * enforces the client-side contract that Atlas sends one read-only UQL pipeline
 * with one bounded terminal LIMIT. The engine still performs the final grammar
 * validation at the canonical graph-query route.
 */
import type { CompileRequest, ParseRequest } from '../adapter'
import type { FilterClause, FilterSet } from '../types'

import type { UqlQuery } from './uql-contract'

export const UQL_SERVER_RESULT_LIMIT = 1000
export const UQL_MIN_RESULT_LIMIT = 1
export const UQL_DEFAULT_LABEL = 'Entity'

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
const MUTATION_WORDS = new Set([
  'CREATE',
  'MERGE',
  'DELETE',
  'REMOVE',
  'SET',
  'INSERT',
  'UPDATE',
  'DROP',
  'TRUNCATE',
  'LOAD',
])

// The engine's v1 parser requires a leading MATCH source. REASON and FOREIGN
// are native pipeline stages (and may reseed an empty intermediate), but a bare
// leading REASON/FOREIGN is not accepted by `eg-plan::uql::parse`.
const NATIVE_SOURCES = new Set(['MATCH'])

export class UqlCompileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UqlCompileError'
  }
}

export class UqlSafetyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UqlSafetyError'
  }
}

type UqlTokenKind = 'word' | 'number' | 'string' | 'punctuation'

interface UqlToken {
  kind: UqlTokenKind
  text: string
}

function boundedContextLimit(ctxLimit: number): number {
  if (!Number.isFinite(ctxLimit)) return UQL_MIN_RESULT_LIMIT
  return Math.max(UQL_MIN_RESULT_LIMIT, Math.min(Math.floor(ctxLimit), UQL_SERVER_RESULT_LIMIT))
}

export function boundedUqlLimit(filters: FilterSet, ctxLimit: number): number {
  const context = boundedContextLimit(ctxLimit)
  const requested = Number.isFinite(filters.limit) ? Math.floor(filters.limit) : context
  return Math.max(UQL_MIN_RESULT_LIMIT, Math.min(requested, context))
}

function optionLabel(request: CompileRequest): string {
  const configured = request.ctx.options.uqlLabel
  if (configured === undefined) return UQL_DEFAULT_LABEL
  if (typeof configured !== 'string' || !IDENTIFIER.test(configured)) {
    throw new UqlCompileError('UQL option "uqlLabel" must be a valid identifier.')
  }
  return configured
}

function stringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function equalityValue(value: FilterClause['value']): string {
  if (Array.isArray(value) || value === undefined) {
    throw new UqlCompileError('UQL equality filters require one scalar value.')
  }
  if (typeof value === 'string') return stringLiteral(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new UqlCompileError('UQL equality filter values must be non-negative and finite.')
    }
    return String(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  throw new UqlCompileError('UQL equality filters require a string, number, or boolean value.')
}

function numericValue(clause: FilterClause): string {
  if (typeof clause.value !== 'number' || !Number.isFinite(clause.value) || clause.value < 0) {
    throw new UqlCompileError(`UQL ${clause.op} filters require a non-negative numeric value.`)
  }
  return String(clause.value)
}

function predicateFor(clause: FilterClause): string {
  if (!IDENTIFIER.test(clause.field)) {
    throw new UqlCompileError(`UQL filter field must be a bare identifier: ${clause.field}`)
  }
  if (clause.op === 'eq') return `${clause.field} = ${equalityValue(clause.value)}`
  if (clause.op === 'gt' || clause.op === 'lt') {
    return `${clause.field} ${clause.op === 'gt' ? '>' : '<'} ${numericValue(clause)}`
  }
  throw new UqlCompileError(`UQL does not support the ${clause.op} filter operator.`)
}

function textStage(search: string): string | null {
  const value = search.trim()
  return value === '' ? null : `TEXT ${stringLiteral(value)}`
}

function whereStage(filters: FilterSet): string | null {
  if (filters.clauses.length === 0) return null
  if (filters.combinator === 'or' && filters.clauses.length > 1) {
    throw new UqlCompileError('UQL WHERE supports conjunctions only; OR filters are unavailable.')
  }
  return `WHERE ${filters.clauses.map(predicateFor).join(' AND ')}`
}

/** Compile Atlas filters to the engine's native `MATCH ... |> ...` UQL grammar. */
export function compileUql(request: CompileRequest): UqlQuery {
  if (request.filters.sort !== null) {
    throw new UqlCompileError('UQL has no modality-neutral sort stage; use RANK in the query text.')
  }
  const limit = boundedUqlLimit(request.filters, request.ctx.limit)
  const stages = [whereStage(request.filters), textStage(request.filters.search)].filter(
    (stage): stage is string => stage !== null,
  )
  stages.push(`LIMIT ${String(limit)}`)
  const text = [`MATCH (:${optionLabel(request)})`, ...stages.map((stage) => `|> ${stage}`)].join(' ')
  return { text, graph: request.ctx.graph, limit }
}

function readQuotedToken(text: string, start: number): { token: UqlToken; next: number } {
  const quote = text[start]
  let index = start + 1
  while (index < text.length) {
    if (text[index] === '\\' && quote === '"') {
      index += 2
      continue
    }
    if (text[index] === quote) {
      if (text[index + 1] === quote) {
        index += 2
        continue
      }
      return { token: { kind: 'string', text: text.slice(start, index + 1) }, next: index + 1 }
    }
    index += 1
  }
  throw new UqlSafetyError('UQL contains an unterminated string literal.')
}

function tokenizeUql(text: string): UqlToken[] {
  const tokens: UqlToken[] = []
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (char === "'" || char === '"') {
      const quoted = readQuotedToken(text, index)
      tokens.push(quoted.token)
      index = quoted.next
      continue
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(index))
    if (word) {
      tokens.push({ kind: 'word', text: word[0] })
      index += word[0].length
      continue
    }
    const number = /^\d+(?:\.\d+)?/.exec(text.slice(index))
    if (number) {
      tokens.push({ kind: 'number', text: number[0] })
      index += number[0].length
      continue
    }
    if (text.startsWith('|>', index)) {
      tokens.push({ kind: 'punctuation', text: '|>' })
      index += 2
      continue
    }
    tokens.push({ kind: 'punctuation', text: char })
    index += 1
  }
  return tokens
}

function terminalLimit(tokens: UqlToken[]): number | null {
  const limits = tokens.flatMap((token, index) =>
    token.kind === 'word' && token.text.toUpperCase() === 'LIMIT' && index > 0 && tokens[index - 1].text === '|>'
      ? [index]
      : [],
  )
  if (limits.length !== 1) return null
  const index = limits[0]
  if (index + 1 >= tokens.length) return null
  const value = tokens[index + 1]
  if (value.kind !== 'number' || !/^\d+$/.test(value.text) || index + 2 !== tokens.length) {
    return null
  }
  const limit = Number(value.text)
  return Number.isSafeInteger(limit) ? limit : null
}

function hasMutation(tokens: UqlToken[]): boolean {
  return tokens.some((token) => {
    if (token.kind !== 'word' || !MUTATION_WORDS.has(token.text.toUpperCase())) return false
    // Quoted values are emitted as `string` tokens, so every matching word here
    // is outside a literal. Reject it regardless of where it appears; allowing
    // a write keyword in a label/property position would make malformed UQL
    // indistinguishable from a read at this client safety boundary.
    return true
  })
}

function validateUqlText(text: string, ctxLimit: number): number {
  const trimmed = text.trim()
  if (trimmed === '') throw new UqlSafetyError('UQL query cannot be empty.')
  const tokens = tokenizeUql(trimmed)
  if (tokens.length === 0) throw new UqlSafetyError('UQL query cannot be empty.')
  const first = tokens[0]
  if (first.kind !== 'word' || !NATIVE_SOURCES.has(first.text.toUpperCase())) {
    throw new UqlSafetyError('UQL queries must start with the native MATCH source clause.')
  }
  if (hasMutation(tokens)) {
    throw new UqlSafetyError('UQL Atlas queries are read-only; mutation clauses are disabled.')
  }
  if (tokens.some((token) => token.text === ';')) {
    throw new UqlSafetyError('UQL queries must be one statement without semicolons.')
  }
  const limit = terminalLimit(tokens)
  if (limit === null) {
    throw new UqlSafetyError('UQL queries must end with one terminal literal LIMIT.')
  }
  if (limit < UQL_MIN_RESULT_LIMIT) {
    throw new UqlSafetyError(`UQL LIMIT must be at least ${String(UQL_MIN_RESULT_LIMIT)}.`)
  }
  const cap = boundedContextLimit(ctxLimit)
  if (limit > cap) {
    throw new UqlSafetyError(`UQL LIMIT ${String(limit)} exceeds the active cap of ${String(cap)}.`)
  }
  return limit
}

/** Parse editable console text while retaining the engine-native UQL verbatim. */
export function parseUql(request: ParseRequest): UqlQuery {
  const text = request.text
  const limit = validateUqlText(text, request.ctx.limit)
  return { text, graph: request.ctx.graph, limit }
}

/** Re-check an opaque query at the network boundary, including its parsed limit. */
export function rawQueryError(query: UqlQuery, ctxLimit: number): string | null {
  try {
    const parsedLimit = validateUqlText(query.text, ctxLimit)
    if (query.limit !== parsedLimit) {
      return 'The UQL limit changed after parsing; run it again to refresh the safety check.'
    }
    return null
  } catch (error) {
    return error instanceof UqlSafetyError ? error.message : String(error)
  }
}
