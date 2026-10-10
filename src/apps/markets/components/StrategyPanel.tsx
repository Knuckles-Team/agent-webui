/**
 * @file StrategyPanel.tsx
 * @description Live strategy/recommendation view wiring (FUI-09.2): renders
 * the evidence/abstain contract (FUI-09.1, {@link recommendationView}) as a
 * component. It reads only `evidence` and `abstain_reason`/`reason` off the
 * typed view, which by construction (FUI-09.1) has no order-submission
 * field, so no handler in this component can originate an order request.
 */
import { recommendationView } from '../strategy-view'
import type { StrategyRecommendation, AbstainReason } from '../strategy-view'

const ABSTAIN_LABEL: Record<AbstainReason, string> = {
  thin_history: 'Not enough price history to recommend yet',
  warmup: 'Strategy is still warming up',
  drift: 'Strategy has drifted outside its calibrated range',
  missing_scorecard: 'No scorecard is available for this strategy',
}

export function StrategyPanel({ recommendation }: { recommendation: StrategyRecommendation }) {
  const view = recommendationView(recommendation)

  if (view.kind === 'abstain') {
    return (
      <div data-testid="strategy-panel" data-state="abstain">
        <p data-testid="strategy-panel-abstain-reason">{ABSTAIN_LABEL[view.reason]}</p>
      </div>
    )
  }

  return (
    <div data-testid="strategy-panel" data-state="proposal">
      <ul data-testid="strategy-panel-evidence">
        {view.evidence.map((ref) => (
          <li key={ref.record_ref}>
            scorecard v{ref.scorecard_version} — {ref.record_ref}
          </li>
        ))}
      </ul>
    </div>
  )
}
