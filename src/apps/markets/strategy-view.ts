/**
 * @file strategy-view.ts
 * @description Typed strategy/recommendation view contract (FUI-09.1).
 * Every recommendation cites the versioned evidence and scorecard behind
 * it, or carries an explicit abstention reason; the type intentionally has
 * no order-submission field, so no path through this model can place an
 * order. Wiring into a StrategyPanel component is FUI-09.2.
 */

export type AbstainReason = 'thin_history' | 'warmup' | 'drift' | 'missing_scorecard'

export interface EvidenceRef {
  scorecard_version: string
  record_ref: string
}

export interface StrategyRecommendation {
  evidence: readonly EvidenceRef[]
  abstain_reason: AbstainReason | null
}

export type StrategyView =
  { kind: 'proposal'; evidence: readonly EvidenceRef[] } | { kind: 'abstain'; reason: AbstainReason }

/** A proposal requires evidence and no abstain reason; anything else abstains with its reason. */
export function recommendationView(recommendation: StrategyRecommendation): StrategyView {
  if (recommendation.abstain_reason !== null) return { kind: 'abstain', reason: recommendation.abstain_reason }
  if (recommendation.evidence.length === 0) return { kind: 'abstain', reason: 'missing_scorecard' }
  return { kind: 'proposal', evidence: recommendation.evidence }
}

/**
 * This type has no field an order-submission call could read, by
 * construction: it carries only evidence refs and an abstain reason.
 */
export const STRATEGY_VIEW_HAS_NO_ORDER_FIELD = true
