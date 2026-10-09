/**
 * @file MarketsMenu.tsx
 * @description The Menu destination (FUI-01): what Markets is, the notices
 * every page carries, and a link back to the Markets overview.
 */
import { navigateInApp } from '@/lib/apps/location'
import { MarketsGate } from './Availability'
import { MarketsNotices } from './Notices'
import { MarketsShell } from './MarketsShell'

export default function MarketsMenu() {
  return (
    <MarketsGate>
      <MarketsShell>
        <div className="space-y-4">
          <div>
            <h1 className="text-lg font-semibold">Markets</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Markets shows each listing's trend state, bullish or bearish, and when it flipped. A scanner covers every
              listing in one pass.
            </p>
          </div>
          <MarketsNotices />
          <button
            type="button"
            onClick={() => {
              navigateInApp('/apps/markets')
            }}
            className="rounded-md border border-border/60 px-3 py-2 text-sm text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Back to Markets
          </button>
        </div>
      </MarketsShell>
    </MarketsGate>
  )
}
