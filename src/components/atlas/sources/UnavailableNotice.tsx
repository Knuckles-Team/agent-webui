import { WifiOff } from 'lucide-react'

import { safeSourceDisplayText } from '@/lib/atlas/sources/contracts'

export interface UnavailableNoticeProps {
  capability: string
  reason?: string | null
}

/** Distinguish an unreached capability from a confirmed empty source. */
export function UnavailableNotice({ capability, reason = null }: UnavailableNoticeProps) {
  const safeReason = safeSourceDisplayText(reason)
  return (
    <div
      className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-500"
      data-testid="atlas-unavailable-notice"
      role="status"
      aria-live="polite"
    >
      <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        {capability} is unavailable. This is not a confirmed empty state.
        {safeReason && <span className="text-muted-foreground mt-1 block text-xs">{safeReason}</span>}
      </span>
    </div>
  )
}
