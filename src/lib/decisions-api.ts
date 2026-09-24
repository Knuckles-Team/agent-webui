/**
 * @file decisions-api.ts
 * @description Typed client for `/api/enhanced/decisions*` — the read-only
 * projection of epistemic-graph's committed `DecisionLog`
 * (`agent/agent_webui/api_extensions.py`'s Decisions section, EH-046/047).
 *
 * Every call goes through `fetchValidated` (`./api-validation.ts`), the
 * repo's one runtime-validation boundary: a shape violation throws loudly
 * instead of handing a caller a value it can misread. Callers use these
 * through React Query (`@tanstack/react-query`, already the server-state
 * convention here — see `agent-webui/AGENTS.md`), not a bespoke fetch/abort
 * hook, so request de-duplication, cancellation-on-unmount and retries stay
 * in one place.
 */
import { z } from 'zod'
import { fetchValidated } from './api-validation'
import {
  decisionAggregateSchema,
  decisionListRowSchema,
  decisionProvenanceSchema,
  decisionRecordSchema,
  type DecisionAggregate,
  type DecisionListRow,
  type DecisionProvenance,
  type DecisionRecord,
} from '@/components/decisions/decision-schemas'

export interface ListDecisionsOptions {
  questionId?: string
  limit?: number
}

function questionIdParam(questionId: string | undefined): string {
  return questionId ? `question_id=${encodeURIComponent(questionId)}&` : ''
}

/** Newest-first page of the caller's visible decision log (EH-046 list). */
export function fetchDecisions(options: ListDecisionsOptions = {}): Promise<DecisionListRow[]> {
  const limit = options.limit ?? 100
  const path = `/api/enhanced/decisions?${questionIdParam(options.questionId)}limit=${limit}`
  return fetchValidated(path, z.array(decisionListRowSchema))
}

/** One committed `DecisionRecord` in full (EH-046 detail). */
export function fetchDecision(recordId: string): Promise<DecisionRecord> {
  return fetchValidated(`/api/enhanced/decisions/${encodeURIComponent(recordId)}`, decisionRecordSchema)
}

/** The evaluations/resolutions logged against one record (EH-046 provenance). */
export function fetchDecisionProvenance(recordId: string): Promise<DecisionProvenance> {
  return fetchValidated(
    `/api/enhanced/decisions/${encodeURIComponent(recordId)}/provenance`,
    decisionProvenanceSchema,
  )
}

export interface DecisionAggregateOptions {
  questionId?: string
  fromMs?: number
  toMs?: number
}

/** The calibration/coverage outcome aggregate (EH-047 dashboard). */
export function fetchDecisionAggregate(options: DecisionAggregateOptions = {}): Promise<DecisionAggregate> {
  const params = new URLSearchParams()
  if (options.questionId) params.set('question_id', options.questionId)
  if (options.fromMs !== undefined) params.set('from_ms', String(options.fromMs))
  if (options.toMs !== undefined) params.set('to_ms', String(options.toMs))
  const query = params.toString()
  return fetchValidated(`/api/enhanced/decisions/aggregate${query ? `?${query}` : ''}`, decisionAggregateSchema)
}
