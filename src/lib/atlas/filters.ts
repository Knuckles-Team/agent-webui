/**
 * @file filters.ts
 * @description The `FilterSet` helpers, and the CLIENT-SIDE residual evaluator.
 *
 * There are two ways an adapter can honour a filter:
 *  1. `compile()` pushes it down into the backend query — always preferred, because
 *     the backend does the work and `limit` then means something;
 *  2. {@link matchesFilterSet} applies it in the browser, for a route that takes no
 *     filter parameter today.
 *
 * ⚠ An adapter that uses (2) MUST say so in `capabilities().notes.filters`. Silent
 * client-side filtering over a truncated result set is a correctness lie: it renders
 * "3 matches" when the honest answer is "3 matches within the first N rows the server
 * was willing to give me".
 */
import { toDisplayText } from './text'
import type { FilterClause, FilterOperator, FilterScalar, FilterSet, FilterValue, FilterValueType, Row } from './types'

/** Operators that take no `value`. */
const VALUELESS_OPERATORS: readonly FilterOperator[] = ['exists', 'missing']

/** Human labels for the filter editor. */
export const OPERATOR_LABELS: Readonly<Record<FilterOperator, string>> = {
  eq: 'is',
  neq: 'is not',
  contains: 'contains',
  startsWith: 'starts with',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  in: 'is one of',
  exists: 'is set',
  missing: 'is not set',
}

const TEXT_OPERATORS: readonly FilterOperator[] = ['eq', 'neq', 'contains', 'startsWith', 'in', 'exists', 'missing']
const ORDERED_OPERATORS: readonly FilterOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'exists', 'missing']
const BOOLEAN_OPERATORS: readonly FilterOperator[] = ['eq', 'neq', 'exists', 'missing']

const OPERATORS_BY_TYPE: Readonly<Record<FilterValueType, readonly FilterOperator[]>> = {
  string: TEXT_OPERATORS,
  number: ORDERED_OPERATORS,
  date: ORDERED_OPERATORS,
  boolean: BOOLEAN_OPERATORS,
  unknown: TEXT_OPERATORS,
}

/** Which operators make sense for a field of this type, intersected with what the adapter supports. */
export function operatorsForType(type: FilterValueType, supported: readonly FilterOperator[]): FilterOperator[] {
  const forType = OPERATORS_BY_TYPE[type]
  return forType.filter((operator) => supported.includes(operator))
}

/** True when this operator needs no `value` (so the editor hides the value input). */
export function isValuelessOperator(operator: FilterOperator): boolean {
  return VALUELESS_OPERATORS.includes(operator)
}

let clauseCounter = 0

/** A clause with a stable id, so React keys and reducer updates never depend on array position. */
export function createClause(field: string, op: FilterOperator = 'eq', value?: FilterValue): FilterClause {
  clauseCounter += 1
  return { id: `clause-${String(clauseCounter)}`, field, op, value }
}

// ---------------------------------------------------------------------------
// Client-side evaluation
// ---------------------------------------------------------------------------

/** `null` when either side is not comparable as a number, so callers fall back to text. */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** -1 / 0 / 1, numerically when both sides parse as numbers, lexically otherwise. */
function compare(actual: unknown, expected: unknown): number {
  const left = asNumber(actual)
  const right = asNumber(expected)
  if (left !== null && right !== null) return Math.sign(left - right)
  return toDisplayText(actual).localeCompare(toDisplayText(expected))
}

function isPresent(value: unknown): boolean {
  return value !== null && value !== undefined && value !== ''
}

function toScalarList(expected: FilterValue | undefined): FilterScalar[] {
  if (Array.isArray(expected)) return expected
  if (expected === undefined) return []
  return [expected]
}

type Predicate = (actual: unknown, expected: FilterValue | undefined) => boolean

/**
 * One predicate per operator. A dispatch table rather than a switch: each arm is a
 * one-liner, so this file's complexity lives in its shape rather than in a branch chain.
 */
const PREDICATES: Readonly<Record<FilterOperator, Predicate>> = {
  eq: (actual, expected) => toDisplayText(actual) === toDisplayText(expected),
  neq: (actual, expected) => toDisplayText(actual) !== toDisplayText(expected),
  contains: (actual, expected) => toDisplayText(actual).toLowerCase().includes(toDisplayText(expected).toLowerCase()),
  startsWith: (actual, expected) =>
    toDisplayText(actual).toLowerCase().startsWith(toDisplayText(expected).toLowerCase()),
  gt: (actual, expected) => compare(actual, expected) > 0,
  gte: (actual, expected) => compare(actual, expected) >= 0,
  lt: (actual, expected) => compare(actual, expected) < 0,
  lte: (actual, expected) => compare(actual, expected) <= 0,
  in: (actual, expected) =>
    toScalarList(expected).some((candidate) => toDisplayText(actual) === toDisplayText(candidate)),
  exists: (actual) => isPresent(actual),
  missing: (actual) => !isPresent(actual),
}

/**
 * Read `clause.field` out of a record, supporting dotted paths (`a.b.c`) so a nested
 * property bag is filterable without every adapter flattening its rows first.
 */
export function readField(record: Row, field: string): unknown {
  if (field in record) return record[field]
  let cursor: unknown = record
  for (const segment of field.split('.')) {
    if (!cursor || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

/** Evaluate one clause against one record. */
export function matchesClause(record: Row, clause: FilterClause): boolean {
  return PREDICATES[clause.op](readField(record, clause.field), clause.value)
}

/** True when any value in the record contains `needle` (case-insensitive). */
function matchesSearch(record: Row, needle: string): boolean {
  const lowered = needle.toLowerCase()
  return Object.values(record).some((value) => toDisplayText(value).toLowerCase().includes(lowered))
}

/**
 * The client-side residual: does this record satisfy the whole filter set?
 *
 * `search` is always an AND on top of the clauses — a free-text box that ORed with
 * the facets would widen the result as the user typed, which no one has ever wanted.
 */
export function matchesFilterSet(record: Row, filters: FilterSet): boolean {
  if (filters.search.trim() !== '' && !matchesSearch(record, filters.search.trim())) return false
  if (filters.clauses.length === 0) return true
  if (filters.combinator === 'or') return filters.clauses.some((clause) => matchesClause(record, clause))
  return filters.clauses.every((clause) => matchesClause(record, clause))
}

/** Sort a copy of `rows` by `sort`, or return it untouched when `sort` is null. */
export function applySort(rows: Row[], sort: FilterSet['sort']): Row[] {
  if (!sort) return rows
  const direction = sort.direction === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => direction * compare(readField(a, sort.field), readField(b, sort.field)))
}

/** Filter, sort and cap — the whole client-side residual in one call. */
export function applyFilterSet(rows: Row[], filters: FilterSet): Row[] {
  const matched = rows.filter((row) => matchesFilterSet(row, filters))
  return applySort(matched, filters.sort).slice(0, filters.limit)
}

/** One clause as human-readable text, for the console's read-only rendering. */
export function describeClause(clause: FilterClause): string {
  const label = OPERATOR_LABELS[clause.op]
  if (isValuelessOperator(clause.op)) return `${clause.field} ${label}`
  const value = Array.isArray(clause.value) ? clause.value.join(', ') : toDisplayText(clause.value)
  return `${clause.field} ${label} "${value}"`
}

/**
 * The whole filter set as one readable line. Adapters without a textual query language
 * use this for `describe()`, so the console still shows the user exactly what will run.
 */
export function describeFilterSet(filters: FilterSet): string {
  const parts: string[] = []
  if (filters.search.trim() !== '') parts.push(`search "${filters.search.trim()}"`)
  const clauses = filters.clauses.map(describeClause)
  if (clauses.length > 0) parts.push(clauses.join(filters.combinator === 'or' ? ' OR ' : ' AND '))
  if (filters.sort) parts.push(`order by ${filters.sort.field} ${filters.sort.direction}`)
  parts.push(`limit ${String(filters.limit)}`)
  return parts.join(' ')
}
