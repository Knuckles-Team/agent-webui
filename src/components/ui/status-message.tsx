/**
 * @file status-message.tsx
 * @description The one shared primitive for the seven-state "status
 * language" `docs/design-system.md` documents under "State tokens (status
 * language)" for DS-05: loading, empty, stale, denied, error, success and
 * pending each render distinct TEXT, not color alone. Color reinforces the
 * distinction (via `meta.classes`) but a screen reader, a high-contrast
 * theme, or a colorblind reading of the page still gets a different label
 * per state.
 *
 * This is a different, non-overlapping vocabulary from
 * `@/components/renderers/BlockedState` (whole-panel/integration
 * availability: blocked / degraded / not_configured / unavailable) and from
 * `@/components/ui/unavailable-notice` (the single simplest "could not be
 * fetched" line) -- this primitive is for the outcome of one item, field or
 * operation, matching the exact seven-state table in the design-system doc.
 * Reuse this instead of hand-rolling another loading/empty/error fallback.
 */
import { AlertTriangle, Ban, CheckCircle2, Clock, Hourglass, Inbox, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type StatusKind = 'loading' | 'empty' | 'stale' | 'denied' | 'error' | 'success' | 'pending'

interface StatusMeta {
  /** The always-present, distinct text for this state (DS-05). */
  label: string
  icon: typeof Loader2
  /** `alert` states interrupt (denied/error); the rest are ambient `status`. */
  role: 'status' | 'alert'
  classes: string
  spin?: boolean
}

const STATUS_META: Record<StatusKind, StatusMeta> = {
  loading: { label: 'Loading…', icon: Loader2, role: 'status', classes: 'text-muted-foreground', spin: true },
  empty: { label: 'Nothing here yet.', icon: Inbox, role: 'status', classes: 'text-muted-foreground' },
  stale: { label: 'Stale.', icon: Clock, role: 'status', classes: 'text-amber-600 dark:text-amber-500' },
  denied: { label: 'Denied.', icon: Ban, role: 'alert', classes: 'text-destructive' },
  error: { label: 'Error.', icon: AlertTriangle, role: 'alert', classes: 'text-destructive' },
  success: {
    label: 'Succeeded.',
    icon: CheckCircle2,
    role: 'status',
    classes: 'text-emerald-600 dark:text-emerald-500',
  },
  pending: { label: 'Pending.', icon: Hourglass, role: 'status', classes: 'text-amber-600 dark:text-amber-500' },
}

export interface StatusMessageProps {
  status: StatusKind
  /**
   * Overrides the default per-status label when a caller already has more
   * specific copy (an existing view's "No knowledge bases found" instead of
   * the generic "Nothing here yet."). The icon, role and color still come
   * from `status`, so the state stays visually and semantically consistent
   * even though the exact wording differs per view.
   */
  label?: string
  /** Natural-language detail shown after the label (an error's actual
   * message, a stale timestamp, who denied it, ...). Optional: the label
   * alone already satisfies DS-05 for a state with nothing more to say. */
  detail?: string
  /**
   * Interrupt affordance for a long-running `loading`/`pending` operation.
   * Render this prop only when the caller has confirmed cancellation is
   * actually safe for that operation (DS-05: "a long-running operation can
   * be interrupted where doing so is safe") -- there is no default Cancel,
   * so a caller that never passes it never implies a safe-to-cancel action
   * that isn't.
   */
  onCancel?: () => void
  /** Associates this message as a form field's error via `aria-describedby`. */
  id?: string
  className?: string
}

export function StatusMessage({ status, label, detail, onCancel, id, className }: StatusMessageProps) {
  const meta = STATUS_META[status]
  const Icon = meta.icon
  return (
    <div
      id={id}
      role={meta.role}
      data-testid="status-message"
      data-status={status}
      className={cn('flex items-center gap-2 text-sm', meta.classes, className)}
    >
      <Icon
        className={cn('size-4 shrink-0', meta.spin && 'animate-spin motion-reduce:animate-none')}
        aria-hidden="true"
      />
      <span>
        <strong>{label ?? meta.label}</strong>
        {detail ? ` ${detail}` : null}
      </span>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto text-xs underline underline-offset-2 hover:no-underline"
        >
          Cancel
        </button>
      )}
    </div>
  )
}
