/** @file adapters/uql-response.ts — strict UQL rows, evidence, and provenance decoding. */
import type { Row } from '../types'
import {
  UQL_EVIDENCE_BUNDLE_SCHEMA,
  UQL_ROWS_SCHEMA,
  UQL_RESPONSE_SCHEMA,
  UQL_TARGETS_SCHEMA,
  sanitizeUqlPlan,
  type UqlEvidenceBundle,
  type UqlPayload,
  type UqlQueryPlan,
  type UqlResponseMetadata,
  type UqlRowSource,
} from './uql-contract'

interface RowExtraction {
  rows: Row[] | null
  source: UqlRowSource
  error: string | null
}

interface DecodedUqlResponse {
  payload: UqlPayload | null
  error: string | null
}

const FAILURE_STATUSES = new Set(['error', 'failed', 'degraded'])
const SENSITIVE_TEXT = /:\/\/|(?:password|passwd|token|secret|dsn|endpoint|authorization)\s*[:=]|\bbearer\s+/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function safeMessage(value: unknown): string | null {
  const text = nonEmptyString(value)
  return text !== null && !SENSITIVE_TEXT.test(text) ? text : null
}

const SAFE_REFERENCE = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/

function safeReference(value: unknown): string | null {
  const text = nonEmptyString(value)
  return text !== null && SAFE_REFERENCE.test(text) ? text : null
}
function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const safe = safeReference(item)
        return safe === null ? [] : [safe]
      })
    : []
}

function recordRows(value: unknown, field: string): { rows: Row[] | null; error: string | null } {
  const parsed = UQL_ROWS_SCHEMA.safeParse(value)
  return parsed.success
    ? { rows: parsed.data, error: null }
    : { rows: null, error: `UQL response field '${field}' must contain object rows.` }
}

function rowsFromTargets(value: unknown): RowExtraction {
  const parsed = UQL_TARGETS_SCHEMA.safeParse(value)
  return parsed.success
    ? { rows: Object.values(parsed.data).flat(), source: 'targets', error: null }
    : { rows: null, source: 'targets', error: 'UQL response targets must contain object rows per target.' }
}

const emptyExtraction = (): RowExtraction => ({ rows: null, source: 'none', error: null })

const hasExtraction = (extraction: RowExtraction): boolean => extraction.rows !== null || extraction.error !== null

function rowsFromRoot(root: unknown): RowExtraction {
  if (Array.isArray(root)) return { ...recordRows(root, 'response'), source: 'rows' }
  if (!isRecord(root)) return emptyExtraction()
  // A fan-out may keep an empty compatibility `rows` beside its target map.
  if ('targets' in root) return rowsFromTargets(root.targets)
  if ('rows' in root) return { ...recordRows(root.rows, 'rows'), source: 'rows' }
  if ('results' in root) return { ...recordRows(root.results, 'results'), source: 'results' }
  return emptyExtraction()
}

function rowsFromTrace(root: unknown, bundle: UqlEvidenceBundle | null): RowExtraction {
  const entries = traceEntries(root, bundle)
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    const extraction = rowsFromRoot(entry.payload)
    if (hasExtraction(extraction)) {
      const source = extraction.source === 'targets' ? 'targets' : 'trace'
      return { ...extraction, source }
    }
  }
  return emptyExtraction()
}

function evidenceBundleFrom(root: unknown): UqlEvidenceBundle | null {
  if (!isRecord(root)) return null
  if (isRecord(root.evidence_bundle)) {
    const parsed = UQL_EVIDENCE_BUNDLE_SCHEMA.safeParse(root.evidence_bundle)
    return parsed.success ? parsed.data : null
  }
  if ('rows' in root || 'results' in root) return null
  const parsed = UQL_EVIDENCE_BUNDLE_SCHEMA.safeParse(root)
  return parsed.success ? parsed.data : null
}

function traceEntries(root: unknown, bundle: UqlEvidenceBundle | null): Record<string, unknown>[] {
  const entries = isRecord(root) && Array.isArray(root.reasoning_trace) ? root.reasoning_trace.filter(isRecord) : []
  return bundle?.reasoning_trace ? [...entries, ...bundle.reasoning_trace] : entries
}

function responseRecords(root: unknown, bundle: UqlEvidenceBundle | null): Record<string, unknown>[] {
  const records = [
    ...(isRecord(root) ? [root] : []),
    ...(isRecord(root) && isRecord(root.evidence_bundle) ? [root.evidence_bundle] : []),
    ...(bundle ? [bundle] : []),
  ]
  for (const entry of traceEntries(root, bundle)) {
    records.push(entry)
    if (isRecord(entry.payload)) records.push(entry.payload)
  }
  return records
}

function nestedProvenanceRecords(records: Record<string, unknown>[]): Record<string, unknown>[] {
  return records.flatMap((record) => (isRecord(record.provenance) ? [record.provenance] : []))
}

function firstNonEmptyField(records: Record<string, unknown>[], field: string): string | null {
  return records.map((record) => safeReference(record[field])).find((value) => value !== null) ?? null
}

function safeCitation(value: unknown): string | Record<string, string> | null {
  const text = safeReference(value)
  if (text !== null) return text
  if (!isRecord(value)) return null
  const safe = Object.fromEntries(
    ['id', 'label', 'title', 'source', 'ref'].flatMap((key): [string, string][] => {
      const item = safeReference(value[key])
      return item === null ? [] : [[key, item]]
    }),
  )
  return Object.keys(safe).length > 0 ? safe : null
}

function firstArrayField(records: Record<string, unknown>[], field: string): unknown[] {
  const value = records.map((record) => record[field]).find(Array.isArray)
  return Array.isArray(value)
    ? value.flatMap((item): unknown[] => {
        const citation = safeCitation(item)
        return citation === null ? [] : [citation]
      })
    : []
}

function safeRecordKeys(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value).flatMap((name) => safeReference(name) ?? []) : []
}

function targetNamesFrom(record: Record<string, unknown>): string[] {
  const parsed = UQL_TARGETS_SCHEMA.safeParse(record.targets)
  return parsed.success ? safeRecordKeys(parsed.data) : []
}

function failedTargetNamesFrom(record: Record<string, unknown>): string[] {
  return safeRecordKeys(record.errors)
}

function rowsFromEnvelope(root: unknown): RowExtraction {
  const direct = rowsFromRoot(root)
  if (hasExtraction(direct)) return direct
  if (!isRecord(root) || !isRecord(root.evidence_bundle)) return emptyExtraction()
  return rowsFromRoot(root.evidence_bundle)
}

function rowsFromClaims(bundle: UqlEvidenceBundle | null): RowExtraction {
  if (!bundle?.claims) return { rows: [], source: 'none', error: null }
  for (const claim of bundle.claims) {
    if (!isRecord(claim) || !('targets' in claim)) continue
    const extraction = rowsFromTargets(claim.targets)
    if (hasExtraction(extraction)) return extraction
  }
  return { rows: bundle.claims, source: 'claims', error: null }
}

function rowsFromResponse(root: unknown, bundle: UqlEvidenceBundle | null): RowExtraction {
  const envelope = rowsFromEnvelope(root)
  if (hasExtraction(envelope)) return envelope
  const traced = rowsFromTrace(root, bundle)
  if (hasExtraction(traced)) return traced
  return rowsFromClaims(bundle)
}

function planFromResponse(root: unknown, bundle: UqlEvidenceBundle | null): UqlQueryPlan | null {
  const candidates = [root, bundle, ...responseRecords(root, bundle).reverse()]
  for (const candidate of candidates) {
    const plan = isRecord(candidate) ? sanitizeUqlPlan(candidate.plan) : null
    if (plan !== null) return plan
  }
  return null
}

function provenanceFromResponse(root: unknown, bundle: UqlEvidenceBundle | null): UqlResponseMetadata['provenance'] {
  const records = responseRecords(root, bundle)
  const provenanceRecords = nestedProvenanceRecords(records)
  const allRecords = [...records, ...provenanceRecords]
  const graph = firstNonEmptyField(allRecords, 'graph')
  const sourceGraphs = allRecords.flatMap((record) => stringList(record.source_graphs).concat(targetNamesFrom(record)))
  const degradedGraphs = allRecords.flatMap((record) => [
    ...stringList(record.degraded_graphs),
    ...failedTargetNamesFrom(record),
  ])
  if (graph !== null) sourceGraphs.push(graph)
  return {
    sourceGraphs: [...new Set(sourceGraphs)],
    degradedGraphs: [...new Set(degradedGraphs)],
    graph,
    connection: firstNonEmptyField(allRecords, 'connection'),
    citations: firstArrayField(allRecords, 'citations'),
  }
}

function hasMoreFrom(root: unknown, bundle: UqlEvidenceBundle | null): boolean {
  const records = responseRecords(root, bundle)
  return [...records, ...nestedProvenanceRecords(records)].some(
    (record) => record.truncated === true || record.has_more === true,
  )
}

function errorDetails(error: unknown): string | null {
  const text = safeMessage(error)
  if (text !== null) return text
  if (!isRecord(error)) return null
  const message = safeMessage(error.message)
  if (message !== null) return message
  const code = safeReference(error.code)
  return code === null ? 'UQL query failed.' : `UQL query failed (${code}).`
}

function statusError(status: unknown, message: unknown): string | null {
  const statusText = nonEmptyString(status)
  if (statusText === null || !FAILURE_STATUSES.has(statusText.toLowerCase())) return null
  return safeMessage(message) ?? 'UQL query failed.'
}

function targetFailureMessage(root: unknown, bundle: UqlEvidenceBundle | null): string | null {
  const unique = [...new Set(responseRecords(root, bundle).flatMap(failedTargetNamesFrom))]
  return unique.length > 0 ? `Some UQL query targets failed: ${unique.join(', ')}` : null
}

function errorMessage(value: unknown): string | null {
  if (!isRecord(value)) return null
  return errorDetails(value.error) ?? statusError(value.status, value.message)
}

function responseError(root: unknown, bundle: UqlEvidenceBundle | null): string | null {
  return errorMessage(root) ?? (bundle ? errorMessage({ error: bundle.error }) : null)
}

/** Decode a validated-or-untrusted route payload without coercing malformed rows. */
export function decodeUqlResponse(value: unknown): DecodedUqlResponse {
  const parsed = UQL_RESPONSE_SCHEMA.safeParse(value)
  if (!parsed.success) {
    return { payload: null, error: 'UQL response did not match the governed result shape.' }
  }
  const root = parsed.data
  const bundle = evidenceBundleFrom(root)
  const extraction = rowsFromResponse(root, bundle)
  if (extraction.error !== null) return { payload: null, error: extraction.error }
  const provenance = provenanceFromResponse(root, bundle)
  const metadata: UqlResponseMetadata = {
    evidenceBundle: bundle,
    plan: planFromResponse(root, bundle),
    provenance,
    rowSource: extraction.source,
    truncated: hasMoreFrom(root, bundle),
  }
  return {
    payload: { rows: extraction.rows ?? [], metadata },
    error:
      responseError(root, bundle) ??
      targetFailureMessage(root, bundle) ??
      (provenance.degradedGraphs.length > 0 ? `Skipped graphs: ${provenance.degradedGraphs.join(', ')}` : null),
  }
}

export function emptyUqlPayload(): UqlPayload {
  return {
    rows: [],
    metadata: {
      evidenceBundle: null,
      plan: null,
      provenance: {
        sourceGraphs: [],
        degradedGraphs: [],
        graph: null,
        connection: null,
        citations: [],
      },
      rowSource: 'none',
      truncated: false,
    },
  }
}
