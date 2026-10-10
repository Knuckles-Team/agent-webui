/**
 * @file ChartA11ySummary.tsx
 * @description Live chart/control accessibility wiring (FUI-13.2): renders
 * the text-summary contract (FUI-13.1, {@link chartSummaryText}) as a
 * screen-reader-accessible, keyboard-focusable region so a chart's state is
 * announceable without seeing it. Direction is conveyed by a non-color word
 * ({@link directionWord}), never color alone, and motion is gated by the
 * viewer's reduced-motion preference ({@link allowsAnimation}) so the
 * summary never animates when the viewer asked it not to.
 */
import { allowsAnimation, chartSummaryText, directionWord } from '../chart-a11y'
import type { MotionPreference } from '../chart-a11y'
import type { Direction, OhlcBar } from '../schemas'

export function ChartA11ySummary({
  bars,
  trendDirection,
  motionPreference,
}: {
  bars: readonly OhlcBar[]
  trendDirection: Direction | null
  motionPreference: MotionPreference
}) {
  const summary = chartSummaryText(bars, trendDirection)
  const word = directionWord(trendDirection)
  const animate = allowsAnimation(motionPreference)

  return (
    <div
      data-testid="chart-a11y-summary"
      role="group"
      tabIndex={0}
      aria-label={summary.label}
      data-motion={motionPreference}
      className={animate ? 'transition-colors duration-300' : 'motion-reduce:transition-none'}
    >
      {/* Screen-reader text summary, independent of the visual chart rendering. */}
      <p data-testid="chart-a11y-text" className="sr-only">
        {summary.label}
      </p>
      {/* Non-color direction indicator: a word, never color alone. */}
      <span data-testid="chart-a11y-direction" data-direction={word} aria-hidden="true">
        {word}
      </span>
    </div>
  )
}
