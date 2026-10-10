/**
 * @file PerformanceCardView.tsx
 * @description Live performance/benchmark card wiring (FUI-08.2): renders
 * the verbatim-value contract (FUI-08.1, {@link renderPerformanceCard}) as a
 * component, reproducing the owning service's decimal string unchanged
 * alongside the return method, currency, source, as-of time, and session —
 * never parsing the value back to a number and recomputing it here.
 */
import type { PerformanceCard } from '../performance-card'
import { renderPerformanceCard } from '../performance-card'

const RETURN_METHOD_LABEL: Record<PerformanceCard['return_method'], string> = {
  twr: 'Time-weighted return',
  mwr: 'Money-weighted return',
  simple: 'Simple return',
}

const SESSION_LABEL: Record<PerformanceCard['session'], string> = {
  regular: 'Regular session',
  pre_market: 'Pre-market',
  post_market: 'Post-market',
  closed: 'Closed',
}

export function PerformanceCardView({ card }: { card: PerformanceCard }) {
  const view = renderPerformanceCard(card)

  if (view.state === 'unavailable') {
    return (
      <div data-testid="performance-card" data-state="unavailable">
        <p>Performance unavailable</p>
      </div>
    )
  }

  return (
    <div data-testid="performance-card" data-state={view.state}>
      {view.state === 'stale' && <p data-testid="performance-card-stale-badge">Stale</p>}
      {/* The owner's decimal string, rendered unchanged: never Number()'d or toFixed()'d. */}
      <p data-testid="performance-card-value">{view.displayValue}</p>
      <dl>
        <dt>Method</dt>
        <dd data-testid="performance-card-return-method">{RETURN_METHOD_LABEL[card.return_method]}</dd>
        <dt>Currency</dt>
        <dd data-testid="performance-card-currency">{card.currency}</dd>
        <dt>Source</dt>
        <dd data-testid="performance-card-source">{card.source}</dd>
        <dt>As of</dt>
        <dd data-testid="performance-card-as-of">{card.as_of}</dd>
        <dt>Session</dt>
        <dd data-testid="performance-card-session">{SESSION_LABEL[card.session]}</dd>
      </dl>
    </div>
  )
}
