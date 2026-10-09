import type {
  DecisionAggregate,
  DecisionEvalReceiptPage,
  DecisionEvalTimelinePage,
  DecisionListRow,
  DecisionProvenance,
  DecisionRecord,
  WhyNot,
} from './decision-schemas'

/**
 * @file decisions-transport.ts
 * @description The one data-access seam the decision-evidence views depend
 * on, following the same split `src/lib/kg-lod/contract.ts`'s `LodTransport`
 * establishes: a typed interface the view layer is written against, kept
 * separate from any one implementation. No production implementation is
 * wired up in this repository yet — the authenticated Graph OS read client
 * these views need is not available here. `DecisionsView` and its tabs
 * therefore take a `DecisionsTransport` as a required prop with no default;
 * tests inject an explicit fixture transport (see
 * `__tests__/decisions-fixtures.ts`), and wiring a real implementation is
 * left for future work once that client lands.
 */

export interface ListDecisionsOptions {
  questionId?: string
  limit?: number
}

export interface DecisionAggregateOptions {
  questionId?: string
  fromMs?: number
  toMs?: number
}

/** One eliminated candidate to explain, with a caller-chosen solve budget (DEC-02). */
export interface WhyNotOnDemandRequest {
  componentId: string
  slot: string
  budgetMs: number
}

/**
 * The on-demand why-not outcome (DEC-02): a freshly computed explanation, a
 * budget timeout, or a server refusal. Never the original decision record —
 * callers render this beside the record, never into it.
 */
export type WhyNotOutcome =
  { kind: 'explained'; whyNot: WhyNot } | { kind: 'timeout' } | { kind: 'refused'; reason: string }

export interface DecisionsTransport {
  /** Newest-first page of the caller's visible decision log. */
  listDecisions(options?: ListDecisionsOptions, signal?: AbortSignal): Promise<DecisionListRow[]>
  /** One committed decision record in full. */
  getDecision(recordId: string, signal?: AbortSignal): Promise<DecisionRecord>
  /** The evaluations/resolutions logged against one record. */
  getDecisionProvenance(recordId: string, signal?: AbortSignal): Promise<DecisionProvenance>
  /** The observed per-option outcome aggregate (never a calibrated claim on its own). */
  getDecisionAggregate(options?: DecisionAggregateOptions, signal?: AbortSignal): Promise<DecisionAggregate>
  /** Independently labeled full-label evaluation receipts, digest ordered. */
  getDecisionEvalReceipts(after?: string, signal?: AbortSignal): Promise<DecisionEvalReceiptPage>
  /** The same receipts, server-submission-time ordered, with threshold status. */
  getDecisionEvalTimeline(after?: string, signal?: AbortSignal): Promise<DecisionEvalTimelinePage>
  /** Compute one why-not explanation on demand, within the caller's solve budget (DEC-02). */
  getWhyNotOnDemand(recordId: string, request: WhyNotOnDemandRequest, signal?: AbortSignal): Promise<WhyNotOutcome>
}
