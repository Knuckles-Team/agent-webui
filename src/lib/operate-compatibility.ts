import { operateHref } from '@/lib/operate-workspace'

export function resolveOperateReadinessAlias(location: string): string | null {
  if (location !== '/arbora-readiness') return null
  return operateHref({ server: null, item: null, q: '' })
}

export function replaceWithOperateReadiness(location: string): boolean {
  const destination = resolveOperateReadinessAlias(location)
  if (!destination) return false
  window.history.replaceState({ operateArrival: 'readiness' }, '', destination)
  window.dispatchEvent(new Event('history-state-changed'))
  return true
}

export function focusReadinessOnArrival(element: HTMLHeadingElement | null): void {
  const state: unknown = window.history.state
  if (
    element &&
    state &&
    typeof state === 'object' &&
    'operateArrival' in state &&
    state.operateArrival === 'readiness'
  ) {
    element.focus({ preventScroll: true })
  }
}
