/**
 * @file Availability.tsx
 * @description Page-level states for Markets: the app's capability is absent
 * on this deployment, a request failed, or there is honestly nothing yet. A
 * failure never renders like an empty result.
 */
import { useAppAvailability } from '@/lib/apps/catalog'
import { appCapability } from '@/lib/apps/contract'
import type { ReactNode } from 'react'

export function MarketsGate({ children }: { children: ReactNode }) {
  const availability = useAppAvailability()
  const reason = availability.reasons.get(appCapability('markets'))
  if (reason) {
    return (
      <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <p className="font-semibold">Markets is not available here.</p>
        <p className="text-muted-foreground">{reason}</p>
      </div>
    )
  }
  return children
}

export function RequestFailed({ what, error }: { what: string; error: unknown }) {
  const detail = error instanceof Error ? error.message : 'Unknown error'
  return (
    <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
      {what} could not be loaded. This is not an empty result.{' '}
      <span className="text-muted-foreground">({detail})</span>
    </p>
  )
}

/** A Markets destination whose data source has not shipped yet (FUI-01).
 * States the gap honestly instead of showing an empty page. */
export function FeaturePending({ feature, reason }: { feature: string; reason: string }) {
  return (
    <div role="status" className="rounded-lg border border-dashed border-border/60 p-6 text-sm">
      <p className="font-medium">{feature} is not available yet.</p>
      <p className="mt-1 text-muted-foreground">{reason}</p>
    </div>
  )
}
