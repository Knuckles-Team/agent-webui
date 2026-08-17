/**
 * @file BlockedState.tsx
 * @description GOC-25 generic renderer: the `blocked` entry in the lane
 * design's renderer table ("invalid/denied/unavailable -> reason,
 * retry/docs, never action").
 *
 * This is the ONE place a caller renders "this integration/panel is not
 * available right now" -- so every blocked/degraded/not-configured surface
 * in the app looks and behaves the same way, and so this behavior (no
 * action affordance, no fabricated retry-implies-success framing) is
 * enforced once rather than reinvented per view. Matches the visual/`role`
 * convention `EcosystemView.tsx`'s local `ServiceNotice` already
 * established (this module is the reusable, independently-tested sibling,
 * not a replacement -- `EcosystemView.tsx` keeps its own richer
 * loading/empty variants which this component does not need to cover).
 *
 * Never renders an action button. A blocked/degraded/unavailable state is,
 * by definition, one nothing here can safely act on -- offering a button
 * here would either be a no-op or would need to guess at what "retry"
 * means for an arbitrary integration, which this component cannot know.
 */
import { AlertTriangle, Ban, Clock, WifiOff } from 'lucide-react'
import { safeExternalUrl } from '@/lib/safe-url'

export type BlockedStateStatus = 'blocked' | 'not_configured' | 'degraded' | 'unavailable'

export interface BlockedStateProps {
  status: BlockedStateStatus
  /** Required -- there is no default/generic reason string; a caller with
   * no reason from the backend should not reach this component. */
  reason: string
  /** Optional docs reference. Rendered as a link ONLY when
   * {@link safeExternalUrl} accepts it (http/https, no embedded
   * credentials, no control characters) -- an untrusted descriptor field
   * can never smuggle a `javascript:`/`data:` URI into a clickable link. */
  docsRef?: string | null
  className?: string
}

const STATUS_META: Record<
  BlockedStateStatus,
  { label: string; icon: typeof AlertTriangle; role: 'status' | 'alert'; classes: string }
> = {
  blocked: {
    label: 'Blocked',
    icon: Ban,
    role: 'alert',
    classes: 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300',
  },
  degraded: {
    label: 'Degraded',
    icon: AlertTriangle,
    role: 'status',
    classes: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300',
  },
  not_configured: {
    label: 'Not configured',
    icon: Clock,
    role: 'status',
    classes: 'border-border/60 bg-accent/10 text-muted-foreground',
  },
  unavailable: {
    label: 'Unavailable',
    icon: WifiOff,
    role: 'status',
    classes: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300',
  },
}

export function BlockedState({ status, reason, docsRef, className }: BlockedStateProps) {
  const meta = STATUS_META[status]
  const Icon = meta.icon
  const safeDocsUrl = safeExternalUrl(docsRef)
  return (
    <div
      role={meta.role}
      data-testid="blocked-state"
      data-status={status}
      className={`flex items-start gap-2 rounded-md border p-4 text-sm ${meta.classes} ${className ?? ''}`}
    >
      <Icon className="size-4 mt-0.5 flex-shrink-0" />
      <div className="space-y-1">
        <p>
          <strong>{meta.label}.</strong> {reason}
        </p>
        {safeDocsUrl && (
          <a href={safeDocsUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline">
            View documentation
          </a>
        )}
      </div>
    </div>
  )
}
