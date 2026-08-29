/**
 * @file natural-language/client.ts
 * @description Reusable Atlas client for the governed NL query gateway twin.
 *
 * The server owns planning, dialect selection, execution, and evidence.  This
 * client therefore sends the two fields the live route accepts and never tries
 * to execute a generated query directly from the browser. `compile` and
 * `execute` use the same governed request seam with an explicit execution
 * intent, and the returned trace is the authority for what actually happened.
 */
import { atlasPost, type AtlasFetchResult } from '../transport'
import {
  bundleErrorMessage,
  createNaturalLanguageQueryRequest,
  NATURAL_LANGUAGE_QUERY_RESPONSE_SCHEMA,
  NATURAL_LANGUAGE_QUERY_ROUTE,
  type NaturalLanguageQueryBundle,
  type NaturalLanguageQueryRequest,
} from './contract'

/** Whether the caller is asking for a plan or an executed answer. */
export type NaturalLanguageQueryOperation = 'compile' | 'execute'

/** Request/response provenance carried alongside every client result. */
export interface NaturalLanguageQueryProvenance {
  /** The governed route that accepted the request. */
  endpoint: typeof NATURAL_LANGUAGE_QUERY_ROUTE
  /** Exact validated request body sent to the route. */
  request: NaturalLanguageQueryRequest | null
  /** Caller intent; the endpoint remains authoritative for execution semantics. */
  operation: NaturalLanguageQueryOperation
  /** Counts and source authority observed in the returned EvidenceBundle. */
  response: {
    claimCount: number
    evidenceSpanCount: number
    traceStepCount: number
    sourceAuthority: Record<string, unknown> | null
  } | null
}

/** Result of a governed NL request with auditable request/response provenance. */
export interface NaturalLanguageQueryResult extends AtlasFetchResult<NaturalLanguageQueryBundle> {
  provenance: NaturalLanguageQueryProvenance
  /** True when a typed EvidenceBundle carries partial evidence plus an error. */
  partial: boolean
}

function initialProvenance(
  operation: NaturalLanguageQueryOperation,
  request: NaturalLanguageQueryRequest | null,
): NaturalLanguageQueryProvenance {
  return { endpoint: NATURAL_LANGUAGE_QUERY_ROUTE, request, operation, response: null }
}

function failedBundleResult(
  response: AtlasFetchResult<NaturalLanguageQueryBundle>,
  provenance: NaturalLanguageQueryProvenance,
): NaturalLanguageQueryResult {
  const message = response.data ? bundleErrorMessage(response.data) : null
  if (!message) return { ...response, provenance, partial: false }
  return {
    ...response,
    ok: false,
    error: `NL query operation failed: ${message}`,
    provenance,
    partial: true,
  }
}

function provenanceFor(
  operation: NaturalLanguageQueryOperation,
  request: NaturalLanguageQueryRequest,
  data: NaturalLanguageQueryBundle | null,
): NaturalLanguageQueryProvenance {
  return {
    endpoint: NATURAL_LANGUAGE_QUERY_ROUTE,
    request,
    operation,
    response:
      data === null
        ? null
        : {
            claimCount: data.claims.length,
            evidenceSpanCount: data.evidence_spans?.length ?? 0,
            traceStepCount: data.reasoning_trace.length,
            sourceAuthority: data.source_authority ?? null,
          },
  }
}

/**
 * Run one governed NL request.
 *
 * `body` is constructed from the strict request schema and is deliberately
 * passed as `{text, execute}` only. Supplying dialect/limit or legacy
 * `{question,query}` fields would recreate the live route contract defect.
 */
export async function runNaturalLanguageQuery(
  text: string,
  operation: NaturalLanguageQueryOperation = 'execute',
  signal?: AbortSignal,
): Promise<NaturalLanguageQueryResult> {
  let request: NaturalLanguageQueryRequest
  try {
    request = createNaturalLanguageQueryRequest(text, operation === 'execute')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      data: null,
      unavailable: false,
      error: `Invalid natural-language query request: ${detail}`,
      provenance: initialProvenance(operation, null),
      partial: false,
    }
  }

  const response = await atlasPost<NaturalLanguageQueryBundle>(
    NATURAL_LANGUAGE_QUERY_ROUTE,
    request,
    signal ?? new AbortController().signal,
    NATURAL_LANGUAGE_QUERY_RESPONSE_SCHEMA,
  )
  return failedBundleResult(response, provenanceFor(operation, request, response.data))
}

/** Ask the gateway for its generated plan without executing it. */
export function compileNaturalLanguageQuery(text: string, signal?: AbortSignal): Promise<NaturalLanguageQueryResult> {
  return runNaturalLanguageQuery(text, 'compile', signal)
}

/** Ask the gateway for its generated plan and execution evidence. */
export function executeNaturalLanguageQuery(text: string, signal?: AbortSignal): Promise<NaturalLanguageQueryResult> {
  return runNaturalLanguageQuery(text, 'execute', signal)
}

/** Object form for callers that prefer an Atlas client instance over functions. */
export const atlasNaturalLanguageClient = {
  compile: compileNaturalLanguageQuery,
  execute: executeNaturalLanguageQuery,
  run: runNaturalLanguageQuery,
} as const

/** Public aliases matching the contract terminology used by Atlas adapters. */
export const compile = compileNaturalLanguageQuery
export const execute = executeNaturalLanguageQuery
