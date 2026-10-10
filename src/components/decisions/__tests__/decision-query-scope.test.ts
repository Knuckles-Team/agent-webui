/**
 * @file decision-query-scope.test.ts
 * @description Proves DEC-05: a tenant/purpose change (a) produces a
 * different react-query `queryKey` and (b) a stale response from the
 * previous selection is discarded while a fresh response for the new
 * selection is applied, even when the stale response arrives LAST.
 */
import { describe, expect, it } from 'vitest'
import {
  createSelectionGuard,
  decisionQueryKey,
  isSelectionCurrent,
  selectionToken,
  type DecisionQueryScope,
} from '../decision-query-scope'

/** A controllable promise, so a test can resolve tenant A after tenant B. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, resolve: settle }
}

describe('decisionQueryKey', () => {
  // spec: DEC-05
  it('differs when tenant changes', () => {
    const a = decisionQueryKey('decision', { tenantId: 'tenant-a' }, 'dec-1')
    const b = decisionQueryKey('decision', { tenantId: 'tenant-b' }, 'dec-1')
    expect(a).not.toEqual(b)
  })

  // spec: DEC-05
  it('differs when purpose changes for the same tenant', () => {
    const a = decisionQueryKey('decision', { tenantId: 'tenant-a', purpose: 'audit' })
    const b = decisionQueryKey('decision', { tenantId: 'tenant-a', purpose: 'billing' })
    expect(a).not.toEqual(b)
  })

  // spec: DEC-05
  it('is stable for the same tenant and purpose', () => {
    const a = decisionQueryKey('decision', { tenantId: 'tenant-a', purpose: 'audit' }, 'dec-1')
    const b = decisionQueryKey('decision', { tenantId: 'tenant-a', purpose: 'audit' }, 'dec-1')
    expect(a).toEqual(b)
  })
})

describe('selectionToken / isSelectionCurrent', () => {
  it('treats an unset purpose consistently across calls', () => {
    const scope: DecisionQueryScope = { tenantId: 'tenant-a' }
    expect(selectionToken(scope)).toBe(selectionToken({ tenantId: 'tenant-a' }))
  })

  it('reports current when the scope has not changed', () => {
    const scope: DecisionQueryScope = { tenantId: 'tenant-a', purpose: 'audit' }
    expect(isSelectionCurrent(selectionToken(scope), scope)).toBe(true)
  })

  it('reports stale once the tenant changes', () => {
    const start = selectionToken({ tenantId: 'tenant-a' })
    expect(isSelectionCurrent(start, { tenantId: 'tenant-b' })).toBe(false)
  })
})

describe('two-tenant race: stale response discarded, fresh response applied', () => {
  it('discards a late tenant-A response after switching to tenant B, and applies B', async () => {
    // Simulated component state, the thing a manual fetch effect would call
    // setState on. Starts empty.
    let appliedTenant: string | null = null
    let applyCount = 0

    // Request for tenant A starts first.
    const scopeA: DecisionQueryScope = { tenantId: 'tenant-a', purpose: 'audit' }
    const guardA = createSelectionGuard(scopeA)
    const responseA = deferred<string>()

    function startFetch(
      scope: DecisionQueryScope,
      guard: ReturnType<typeof createSelectionGuard>,
      response: Promise<string>,
    ) {
      return response.then((payload) => {
        // Read the CURRENT live selection at response-arrival time, not the
        // one captured at request-start — that is the whole point of the
        // guard: catching a selection that moved on while in flight.
        if (!guard.isCurrent(liveScope)) {
          return // discarded: superseded by a newer selection
        }
        appliedTenant = `${scope.tenantId}:${payload}`
        applyCount += 1
      })
    }

    // Live selection the "component" reads at response time.
    let liveScope: DecisionQueryScope = scopeA

    const pendingA = startFetch(scopeA, guardA, responseA.promise)

    // Before tenant A's response arrives, the user switches to tenant B.
    const scopeB: DecisionQueryScope = { tenantId: 'tenant-b', purpose: 'audit' }
    liveScope = scopeB
    const guardB = createSelectionGuard(scopeB)
    const responseB = deferred<string>()
    const pendingB = startFetch(scopeB, guardB, responseB.promise)

    // Tenant B's own response arrives first...
    responseB.resolve('b-payload')
    await pendingB
    expect(appliedTenant).toBe('tenant-b:b-payload')
    expect(applyCount).toBe(1)

    // ...then tenant A's now-stale response arrives last. It must never
    // overwrite tenant B's already-applied result (DEC-05's exact ordering
    // requirement: "a stale response can never overwrite a result from a
    // newer selection").
    responseA.resolve('a-payload-too-late')
    await pendingA
    expect(appliedTenant).toBe('tenant-b:b-payload')
    expect(applyCount).toBe(1)
  })

  it('still applies tenant A if its response arrives before any switch', async () => {
    let appliedTenant: string | null = null
    const scopeA: DecisionQueryScope = { tenantId: 'tenant-a' }
    const liveScope: DecisionQueryScope = scopeA
    const guardA = createSelectionGuard(scopeA)
    const responseA = deferred<string>()

    const pending = responseA.promise.then((payload) => {
      if (!guardA.isCurrent(liveScope)) return
      appliedTenant = `${scopeA.tenantId}:${payload}`
    })

    responseA.resolve('a-payload')
    await pending
    expect(appliedTenant).toBe('tenant-a:a-payload')
  })
})
