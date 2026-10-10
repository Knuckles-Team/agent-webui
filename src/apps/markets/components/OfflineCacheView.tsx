/**
 * @file OfflineCacheView.tsx
 * @description Live offline PWA shell wiring (FUI-12.2): renders the
 * offline cache staleness contract (FUI-12.1, {@link viewCachedFact}) so
 * the installed PWA shell keeps showing a previously cached financial fact
 * while offline, marked stale, with any current-market/account/order action
 * disabled rather than hidden — the viewer sees why the action is unusable.
 */
import type { ReactNode } from 'react'
import { viewCachedFact } from '../offline-cache'
import type { CachedFact } from '../offline-cache'

export function OfflineCacheView<T>({
  cached,
  isOnline,
  now,
  maxAgeMs,
  children,
  disabledFallback,
}: {
  cached: CachedFact<T>
  isOnline: boolean
  now: number
  maxAgeMs: number
  children: (data: T) => ReactNode
  /** What to render in place of a current-state action, e.g. a disabled button label. */
  disabledFallback: (actionId: string) => ReactNode
}) {
  const view = viewCachedFact(cached, isOnline, now, maxAgeMs)

  return (
    <div data-testid="offline-cache-view" data-stale={view.stale}>
      {view.stale && <p data-testid="offline-cache-stale-badge">Stale — showing last known data</p>}
      <div data-testid="offline-cache-data">{children(view.data)}</div>
      {view.disabledActions.map((actionId) => (
        <div key={actionId} data-testid="offline-cache-disabled-action" data-action={actionId}>
          {disabledFallback(actionId)}
        </div>
      ))}
    </div>
  )
}
