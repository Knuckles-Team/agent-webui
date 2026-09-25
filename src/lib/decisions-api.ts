/**
 * @file decisions-api.ts
 * @description Typed client for GraphOS decision operations.
 *
 * Every call goes through `invoke` (`./graphos-api/invoke.ts`), the
 * repo's one runtime-validation boundary: a shape violation throws loudly
 * instead of handing a caller a value it can misread. Callers use these
 * through React Query (`@tanstack/react-query`, already the server-state
 * convention here — see `agent-webui/AGENTS.md`), not a bespoke fetch/abort
 * hook, so request de-duplication, cancellation-on-unmount and retries stay
 * in one place.
 */
import { z } from 'zod'
import { invoke } from './graphos-api/invoke'
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

/** Newest-first page of the caller's visible decision log (EH-046 list). */
export function fetchDecisions(options: ListDecisionsOptions = {}): Promise<DecisionListRow[]> {
  return invoke(
    'decisions.list',
    { question_id: options.questionId ?? null, limit: options.limit ?? 100 },
    z.array(decisionListRowSchema),
  )
}

/** One committed `DecisionRecord` in full (EH-046 detail). */
export function fetchDecision(recordId: string): Promise<DecisionRecord> {
  return invoke('decisions.get', { record_id: recordId }, decisionRecordSchema)
}

/** The evaluations/resolutions logged against one record (EH-046 provenance). */
export function fetchDecisionProvenance(recordId: string): Promise<DecisionProvenance> {
  return invoke('decisions.provenance', { record_id: recordId }, decisionProvenanceSchema)
}

export interface DecisionAggregateOptions {
  questionId?: string
  fromMs?: number
  toMs?: number
}

/** The calibration/coverage outcome aggregate (EH-047 dashboard). */
export function fetchDecisionAggregate(options: DecisionAggregateOptions = {}): Promise<DecisionAggregate> {
  return invoke(
    'decisions.aggregate',
    {
      question_id: options.questionId ?? null,
      from_ms: options.fromMs ?? null,
      to_ms: options.toMs ?? null,
    },
    decisionAggregateSchema,
  )
}
