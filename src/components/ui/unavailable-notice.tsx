import { WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Honest "we couldn't confirm this" notice (BUG-008 dashboard-wide follow-on,
 * GOC-28-W06). A failed/errored fetch must never render identically to a
 * genuine empty/zero result on an operational surface -- an operator reading
 * "No X reported." needs to know whether that means "confirmed zero" or "we
 * don't actually know," especially on surfaces that gate destructive/
 * high-risk actions (fleet containment, approval queues) or security-
 * relevant inventories (RBAC, tenants, shards).
 *
 * Shared leaf for the simple case: a list/count-driven panel that just needs
 * a single distinct "unavailable" line. `EcosystemView.tsx`'s local
 * `EcoStatus`/`ServiceNotice` remains the richer sibling pattern
 * (loading/empty/unavailable/error, with a `reason` string from the
 * backend's own envelope) for surfaces that already carry that much detail;
 * this component is for the many simpler panels that only need "loading" vs
 * "ready" vs "unavailable" and don't have a structured backend reason to
 * show.
 */
export function UnavailableNotice({ what, className }: { what: string; className?: string }) {
  return (
    <p className={cn('text-sm text-amber-600 dark:text-amber-500 flex items-center gap-2', className)}>
      <WifiOff className="h-4 w-4 shrink-0" /> {what} could not be fetched. This is not a confirmed empty state.
    </p>
  )
}
