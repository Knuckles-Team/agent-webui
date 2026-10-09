import { z } from 'zod'
import { invoke } from '@/lib/graphos-api/invoke'
import {
  decisionAggregateSchema,
  decisionEvalReceiptPageSchema,
  decisionEvalTimelinePageSchema,
  decisionListRowSchema,
  decisionProvenanceSchema,
  decisionRecordSchema,
} from './decision-schemas'
import type { DecisionAggregateOptions, DecisionsTransport, ListDecisionsOptions } from './decisions-transport'

/**
 * @file graphos-decisions-transport.ts
 * @description The real `DecisionsTransport` (requirement WEBUI-API-R001:
 * agent-webui "migrates decisions ... pages to call" the shared `invoke`
 * adapter): every method below is `invoke()` against the same
 * `src/lib/graphos-api/invoke.ts` transport `identity.ts` already uses — no
 * second HTTP/CSRF path, no browser-held service bearer.
 *
 * The operation ids are this repository's best-effort naming, mirroring
 * `identity.ts`'s hand-authored `identity.*` ids; `decisions-transport.ts`'s
 * file doc still governs: a generated client supersedes these ids once the
 * Graph OS operation registry is pinned here, without changing this file's
 * shape or its callers.
 */

const listPageSchema = z.object({ items: z.array(decisionListRowSchema) })

export const graphosDecisionsTransport: DecisionsTransport = {
  listDecisions(options?: ListDecisionsOptions, signal?: AbortSignal) {
    return invoke('decide.records.list', { question_id: options?.questionId, limit: options?.limit }, listPageSchema, {
      signal,
    }).then((page) => page.items)
  },
  getDecision(recordId: string, signal?: AbortSignal) {
    return invoke('decide.records.get', { record_id: recordId }, decisionRecordSchema, { signal })
  },
  getDecisionProvenance(recordId: string, signal?: AbortSignal) {
    return invoke('decide.records.provenance', { record_id: recordId }, decisionProvenanceSchema, { signal })
  },
  getDecisionAggregate(options?: DecisionAggregateOptions, signal?: AbortSignal) {
    return invoke(
      'decide.outcomes.aggregate',
      { question_id: options?.questionId, from_ms: options?.fromMs, to_ms: options?.toMs },
      decisionAggregateSchema,
      { signal },
    )
  },
  getDecisionEvalReceipts(after?: string, signal?: AbortSignal) {
    return invoke('decide.receipts.list', { after }, decisionEvalReceiptPageSchema, { signal })
  },
  getDecisionEvalTimeline(after?: string, signal?: AbortSignal) {
    return invoke('decide.receipts.timeline', { after }, decisionEvalTimelinePageSchema, { signal })
  },
}
