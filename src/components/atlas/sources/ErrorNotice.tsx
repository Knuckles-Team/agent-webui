import { CircleAlert } from 'lucide-react'

import { safeSourceDisplayText } from '@/lib/atlas/sources/contracts'

export interface ErrorNoticeProps {
  capability: string
  message: string
}

/** Distinguish a failed source request from an unavailable route or an empty result. */
export function ErrorNotice({ capability, message }: ErrorNoticeProps) {
  const safeMessage = safeSourceDisplayText(message, 'Atlas source request failed.') ?? 'Atlas source request failed.'
  return (
    <div
      className="flex items-start gap-2 text-sm text-destructive"
      data-testid="atlas-source-error-notice"
      role="alert"
      aria-live="assertive"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        {capability} could not be read.
        <span className="text-muted-foreground mt-1 block text-xs">{safeMessage}</span>
      </span>
    </div>
  )
}
