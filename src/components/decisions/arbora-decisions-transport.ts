import { fetchAuthSession } from '@/lib/auth'
import { ArboraApiError, invoke } from '@/lib/arbora-api/invoke'
import {
  decisionAggregateSchema,
  decisionEvalReceiptPageSchema,
  decisionEvalTimelinePageSchema,
  decisionLogEntrySchema,
} from './decision-schemas'
import type { DecisionAggregateOptions, DecisionsTransport, ListDecisionsOptions } from './decisions-transport'

/**
 * @file arbora-decisions-transport.ts
 * @description The real `DecisionsTransport` (requirement WEBUI-API-R001),
 * calling the five real Arbora decision operations through the shared
 * `invoke()` adapter — no second HTTP/CSRF path, no browser-held service
 * bearer. These were confirmed against the epistemic-graph source of truth
 * (not guessed): `eg.coordination.DecisionLog` and `eg.coordination.DecisionEval`
 * each multiplex several named actions through an `op` discriminator field;
 * `eg.query.Decide` and `eg.storage.DecisionCommit` are single-shot. See
 * `specs/arbora-api-consumer/tasks.md` for the full action inventory.
 *
 * Two `DecisionsTransport` methods have **no corresponding Arbora
 * operation** today and must not fabricate one:
 * - `listDecisions`: no bulk decision-record enumeration exists anywhere in
 *   the `DecisionLog`/`Decide` surface (only single-record `get` and grouped
 *   `aggregate`). Refuses with `DECISION_LIST_UNAVAILABLE` until one ships.
 * - `getDecisionProvenance`: no dedicated provenance action exists either.
 *   A record's provenance (premises, inputs) is already embedded in the
 *   `DecisionLog.get` response; evaluations/resolutions are a different,
 *   not-yet-exposed read. Refuses with `DECISION_PROVENANCE_UNAVAILABLE`.
 * `getWhyNotOnDemand` (WEBUI-DECIDE-R004) likewise has no production operation pinned
 * yet, so it resolves `{ kind: 'refused' }` rather than guessing an op id.
 *
 * `eg.*` operations carry a placeholder `{"type":"object"}` schema in the
 * pinned OpenAPI document until arbora and epistemic-graph are built from
 * a digest-matched pair (see `src/lib/arbora-api/generated/README.md`), so
 * `invoke()` here validates responses against this repo's own zod schemas
 * (`decision-schemas.ts`), authored directly from the epistemic-graph Rust
 * types, not against the generated client's placeholder shape.
 */

/** The caller's tenant, read from the same `/auth/session` the identity
 * broker already answers (see `src/lib/auth.ts`) — no second auth path. */
async function currentTenantId(): Promise<string> {
  const { session } = await fetchAuthSession()
  if (!session?.tenant) throw new ArboraApiError('TENANT_UNKNOWN', 401, false, {})
  return session.tenant
}

function unavailableError(code: string, operation: string): ArboraApiError {
  return new ArboraApiError(code, 501, false, {
    operation,
    detail: 'No corresponding Arbora operation exists yet.',
  })
}

const DEFAULT_PAGE_LIMIT = 50

export const arboraDecisionsTransport: DecisionsTransport = {
  listDecisions(_options?: ListDecisionsOptions, _signal?: AbortSignal) {
    return Promise.reject(unavailableError('DECISION_LIST_UNAVAILABLE', 'listDecisions'))
  },
  async getDecision(recordId: string, signal?: AbortSignal) {
    const tenantId = await currentTenantId()
    const entry = await invoke(
      'eg.coordination.DecisionLog',
      { op: 'get', tenant_id: tenantId, record_id: recordId },
      decisionLogEntrySchema.nullable(),
      { signal },
    )
    if (!entry) throw new ArboraApiError('DECISION_RECORD_NOT_FOUND', 404, false, { record_id: recordId })
    return entry.record
  },
  getDecisionProvenance(_recordId: string, _signal?: AbortSignal) {
    return Promise.reject(unavailableError('DECISION_PROVENANCE_UNAVAILABLE', 'getDecisionProvenance'))
  },
  async getDecisionAggregate(options?: DecisionAggregateOptions, signal?: AbortSignal) {
    const tenantId = await currentTenantId()
    return invoke(
      'eg.coordination.DecisionLog',
      {
        op: 'aggregate',
        request: {
          tenant_id: tenantId,
          question_id: options?.questionId,
          window: { from_ms: options?.fromMs, to_ms: options?.toMs },
        },
      },
      decisionAggregateSchema,
      { signal },
    )
  },
  async getDecisionEvalReceipts(after?: string, signal?: AbortSignal) {
    const tenantId = await currentTenantId()
    return invoke(
      'eg.coordination.DecisionEval',
      { op: 'receipts', request: { tenant_id: tenantId, after, limit: DEFAULT_PAGE_LIMIT } },
      decisionEvalReceiptPageSchema,
      { signal },
    )
  },
  async getDecisionEvalTimeline(after?: string, signal?: AbortSignal) {
    const tenantId = await currentTenantId()
    return invoke(
      'eg.coordination.DecisionEval',
      { op: 'timeline', request: { tenant_id: tenantId, after, limit: DEFAULT_PAGE_LIMIT } },
      decisionEvalTimelinePageSchema,
      { signal },
    )
  },
  getWhyNotOnDemand(_recordId, _request, _signal?: AbortSignal) {
    return Promise.resolve({
      kind: 'refused',
      reason: 'Arbora does not yet expose a why-not-on-demand operation.',
    })
  },
}
