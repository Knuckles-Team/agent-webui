/**
 * @file decision-query-scope.ts
 * @description Tenant/purpose cache scoping for decision and evaluation
 * queries (DEC-05). Two concerns, kept separate on purpose:
 *
 * 1. `decisionQueryKey` builds a `@tanstack/react-query` `queryKey` tuple that
 *    includes tenant and purpose. react-query already keys its cache by
 *    `queryKey` and, when a component's `queryKey` changes, treats the old
 *    entry as a different cache slot — it does not merge a late response for
 *    the previous key into the new one. Folding tenant/purpose into the key
 *    is what makes a tenant or purpose change a fresh cache entry instead of
 *    a stale read of the old one.
 * 2. `createSelectionGuard` / `isSelectionCurrent` harden the one place in
 *    this repo that does NOT go through react-query: a manual
 *    `useState`+`useEffect` fetch (the shape `src/components/views/
 *    UsageView.tsx`'s `refresh`/`tenantFilter` effect already uses for a
 *    tenant-scoped fetch). A manual effect has no built-in request
 *    cancellation-by-key, so a response for a tenant/purpose selection that
 *    is no longer current must be detected and discarded explicitly.
 *
 * No fetching, no state, no React import — plain functions so both the key
 * builder and the guard are unit-testable without a component tree, matching
 * the existing `decision-format.ts` convention in this directory.
 */

/** The tenant/purpose pair that scopes a decision or evaluation query. */
export interface DecisionQueryScope {
  tenantId: string
  purpose?: string
}

/**
 * A stable, opaque token identifying one tenant/purpose selection. Two scopes
 * with the same tenant and purpose produce the same token; a change to
 * either produces a different one. Exported so a caller can store one value
 * (e.g. in a ref) rather than re-deriving it from two fields each time.
 */
export function selectionToken(scope: DecisionQueryScope): string {
  return `${scope.tenantId}:${scope.purpose ?? ''}`
}

/**
 * Build a react-query `queryKey` for a decision/evaluation query. `kind`
 * names the query (`'decision'`, `'evaluation-summary'`, …); `scope` carries
 * tenant and purpose; `rest` carries any further key parts (an id, a filter).
 * Including `scope` means react-query gives a tenant or purpose change its
 * own cache entry — it is never a stale read of the previous selection's
 * entry, and react-query's own in-flight-request handling (a changed
 * `queryKey` is a different query) applies without extra code here.
 */
export function decisionQueryKey(
  kind: string,
  scope: DecisionQueryScope,
  ...rest: readonly (string | number | boolean | null | undefined)[]
): readonly unknown[] {
  return ['decisions', kind, scope.tenantId, scope.purpose ?? null, ...rest]
}

/**
 * A guard for a manual (non-react-query) tenant-scoped fetch effect. Capture
 * `startToken` at request-start time from the scope in effect then, and call
 * `isCurrent` at response-arrival time with the scope read live at that
 * moment. A `false` result means the tenant or purpose changed while the
 * request was in flight: the response belongs to a superseded selection and
 * must be discarded, never applied to state.
 */
export interface SelectionGuard {
  /** The token captured when the request was issued. */
  readonly startToken: string
  /** True only if the live selection is still the one the request started under. */
  isCurrent(currentScope: DecisionQueryScope): boolean
}

export function createSelectionGuard(startScope: DecisionQueryScope): SelectionGuard {
  const startToken = selectionToken(startScope)
  return {
    startToken,
    isCurrent(currentScope: DecisionQueryScope): boolean {
      return selectionToken(currentScope) === startToken
    },
  }
}

/**
 * Standalone form of the same check, for a caller that already tracks tokens
 * itself (e.g. a ref holding the latest token) rather than a `SelectionGuard`
 * object per request.
 */
export function isSelectionCurrent(startToken: string, currentScope: DecisionQueryScope): boolean {
  return selectionToken(currentScope) === startToken
}
