/**
 * @file render-route.tsx
 * @description Mounts one route the way `App.tsx` actually mounts it —
 * QueryClientProvider > ThemeProvider > MCPProvider > PageContextProvider >
 * ErrorBoundary > Suspense > the route's lazy element — so the render
 * harness exercises the real provider tree, not a stripped-down stand-in
 * that would hide provider-dependent failures.
 */
import { Suspense, type ComponentType, act } from 'react'
import { vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ThemeProvider } from '@/components/theme-provider'
import { MCPProvider } from '@/lib/mcp-context'
import { PageContextProvider } from '@/lib/page-context'
import type { RouteDef } from './route-source'

/**
 * Routes whose real component signature needs props the registry's shared
 * zero-prop `element: LazyExoticComponent<ComponentType>` contract cannot
 * express. `knowledge.object-detail` (`ObjectView`, needs `objectId`/
 * `onNavigate`) is the one case — the real router special-cases this path
 * instead of mounting through the generic contract; this harness does the
 * same, injecting the same shape of sample data a real `/object/:id`
 * navigation would supply.
 */
const SPECIAL_ROUTE_PROPS: Record<string, Record<string, unknown>> = {
  'knowledge.object-detail': { objectId: 'test-object-1', onNavigate: () => undefined },
}

/**
 * Several view components (`FleetView`, others) start a polling
 * `setInterval` in a `useEffect` with no cleanup function that clears it —
 * a real hygiene defect, independent of this harness's hostile-payload
 * matrix. Left alone, a leaked interval from route A's test keeps firing on
 * real wall-clock time and can mutate state — through whatever
 * `global.fetch` mock happens to be installed AT THAT MOMENT, i.e. route B's
 * — well after route A's test has finished. This was empirically the single
 * biggest source of non-determinism in this harness: giving `flush()` a
 * more generous real-time budget didn't make results more reliable, it made
 * this pollution WORSE (more real time = more chances for a leaked interval
 * to fire mid-flush of an unrelated test). The fix is isolation, not timing:
 * intercept every `setInterval` call for the lifetime of the process and
 * force-clear whatever's still pending after each test, regardless of
 * whether the component that created it ever would have.
 */
const realSetInterval = globalThis.setInterval
const activeIntervalIds = new Set<Parameters<typeof clearInterval>[0]>()
let intervalTrackingInstalled = false

function installIntervalTracking(): void {
  if (intervalTrackingInstalled) return
  intervalTrackingInstalled = true
  globalThis.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const id = realSetInterval(handler as () => void, timeout, ...args) as Parameters<typeof clearInterval>[0]
    activeIntervalIds.add(id)
    return id
  }) as typeof setInterval
}

installIntervalTracking() // installed at module load, before any renderRoute() call

/** Call in `afterEach` so no test's polling interval can outlive it. */
export function clearLeakedIntervals(): void {
  for (const id of activeIntervalIds) {
    clearInterval(id)
  }
  activeIntervalIds.clear()
}

const MOBILE_BREAKPOINT = 768
export const MOBILE_WIDTH = 375
export const DESKTOP_WIDTH = 1280

/** Set jsdom's viewport and the `matchMedia` query `useIsMobile` reads. */
export function setViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width })
  window.matchMedia = ((query: string) => ({
    matches: query.includes('max-width') ? width < MOBILE_BREAKPOINT : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  window.dispatchEvent(new Event('resize'))
}

export interface RenderRouteResult {
  /** True if the ErrorBoundary fallback ("Something went wrong") is showing. */
  tripped: () => boolean
  /** The raw text content of the mounted route's container, for diagnostics. */
  text: () => string
  /**
   * Tear down this render's QueryClient. Every route mount gets its own
   * QueryClient (so query state can't leak into the next route), but
   * `@tanstack/react-query` keeps a query's cache entry — and, critically,
   * any still-pending `queryFn` promise, including the ones the
   * 'never-resolving' fixture deliberately never settles — alive until the
   * client itself is torn down. Unmounting the React tree alone does not do
   * this. Left uncalled, 315 accumulated live QueryClients measurably slowed
   * later tests in the same run enough to make `flush()`'s real-time budget
   * unreliable for them — cleaning up here, not a longer budget, is the fix.
   */
  cleanupQueryClient: () => void
}

/**
 * Mount `route` (from the route registry) with a fresh QueryClient and the
 * same provider stack `App.tsx` uses. Does NOT wait for data to settle —
 * callers decide what to wait for (or not, for the 'never-resolving' fixture).
 */
export function renderRoute(route: RouteDef): RenderRouteResult {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  const Element = route.element as ComponentType<Record<string, unknown>>
  const props = SPECIAL_ROUTE_PROPS[route.id] ?? {}

  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light" storageKey={`route-harness-${route.id}`}>
        <MCPProvider>
          <PageContextProvider route={route.path} view={route.id}>
            <ErrorBoundary>
              <Suspense fallback={<div data-testid="route-suspense-fallback">Loading route…</div>}>
                <Element {...props} />
              </Suspense>
            </ErrorBoundary>
          </PageContextProvider>
        </MCPProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  )

  return {
    tripped: () => screen.queryByText('Something went wrong') !== null,
    text: () => document.body.textContent ?? '',
    cleanupQueryClient: () => {
      queryClient.clear()
      queryClient.unmount()
    },
  }
}

/**
 * Flush a route's `fetch → .json() → setState` chain.
 *
 * Tried `vi.useFakeTimers()` + `advanceTimersByTimeAsync` here first, on the
 * theory that removing real wall-clock time from the equation would be
 * strictly more deterministic. It was not: React's scheduler package
 * resolves its own `setTimeout`/`MessageChannel` reference at MODULE LOAD
 * time (before any per-test `vi.useFakeTimers()` call), so swapping the
 * global timer functions per-test doesn't reliably intercept the scheduler's
 * own low-priority work — some routes that reproduced their crash reliably
 * in isolation stopped reproducing it once embedded in the full 315-test
 * run, i.e. the fake-timer version was non-deterministic in a NEW way. Real
 * timers, given a genuinely generous single real-time budget (below) rather
 * than a handful of zero-delay ticks, measured as reliably deterministic
 * across repeated full-suite runs (see the lane report for the verification
 * transcript) — that's what's used here.
 */
export async function flush(): Promise<void> {
  // Microtask drain first (cheap, resolves same-tick promise chains).
  await act(async () => {
    for (let i = 0; i < 8; i += 1) {
      await Promise.resolve()
    }
  })
  // One real-time window. Long enough that every observed
  // `fetch → .json() → setState` chain in this codebase reliably commits
  // before the assertion runs. `clearLeakedIntervals()` (see above) is what
  // makes it safe for this to be generous without reopening cross-test
  // pollution.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100))
  })
}
