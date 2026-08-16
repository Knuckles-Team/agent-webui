/**
 * @file baseline.ts
 * @description The single declarative list of currently-known-broken
 * (route × fixture × viewport) combinations the D-WUI-2 hostile-payload
 * harness (`route-render.hostile.test.tsx`) exercises against.
 *
 * WHY THIS FILE EXISTS: the merge queue's `vitest` gate (agent-webui's
 * `.mergequeue.yaml`) is DIFFERENTIAL — it fails a candidate that introduces
 * any `^FAIL ` line not already present on `main`. This harness's entire
 * purpose is to expose bugs that already exist in `main`'s view components
 * (see the 19 register items D-WUI-7..25 this inventory produced), so an
 * unmodified "every mount must pass" suite will *always* be rejected: it
 * legitimately adds new failing signals on its first landing. The fix is not
 * a weaker gate — it's this file. Every entry here is a KNOWN, ALREADY-FILED
 * defect; the harness asserts it stays exactly that (`it.fails`, not
 * `it.skip`/`it.todo` — see the test file for why that distinction is
 * load-bearing).
 *
 * DISCIPLINE:
 *   - Every entry MUST cite the register id (`plans/au-eg-program/deferred/
 *     lane-webui-unification.md`) that owns the fix. An entry with no
 *     register id is not a baseline, it's an unowned exception.
 *   - When a wave-1 lane fixes the underlying view, the corresponding
 *     `it.fails()` in the generated suite starts unexpectedly PASSING, which
 *     `it.fails()` reports as a hard FAILURE (`Error: Expect test to fail`)
 *     — the suite goes red until the fixer removes that entry from this
 *     list, which forces the register item to be closed in the SAME change
 *     that lands the fix. This is deliberate: a baseline that can silently
 *     rot into a permanent excuse list is worse than no baseline. See
 *     `route-render.hostile.test.tsx`'s self-test for proof this actually
 *     happens.
 *   - This is the ONLY place a route/fixture is marked known-broken. No
 *     per-file `.skip`/annotations elsewhere — the whole point is that
 *     reading this one array tells you exactly how many known-broken routes
 *     remain and shrinks visibly as items close.
 */
import type { FixtureId } from './hostile-fixtures'

export type Viewport = 'desktop' | 'mobile'

export interface BaselineEntry {
  /** Matches `RouteDef.id` from `route-source.ts`. */
  routeId: string
  fixture: FixtureId
  viewport: Viewport
  /** The register item (lane-webui-unification.md) that owns fixing this. */
  registerId: string
}

// Captured 2026-08-06, re-verified against agent-webui @ 98e6886 (main, after
// w1-webui-api-contract's first two fix batches) + this lane's harness.
//
// STALE_BASELINE_CLOSED — BUG-011 (GOC-28), 2026-08-16, `fix/L1-webui-surfaces`
// @ local `main` 468f5ad: all 58 rows previously listed here (D-WUI-6, 7, 8,
// 9, 12, 13, 14, 15, 16, 19, 20, 21, 22, 24) were re-run against this exact
// base SHA and NONE reproduce any more — every `it.fails()` case in this
// harness now fails with vitest's own "Error: Expect test to fail" (the
// documented signal in route-render.hostile.test.tsx's header that the
// underlying view no longer trips the ErrorBoundary). Evidence:
//   - Two full-file runs, `pnpm vitest run
//     src/__tests__/routes/route-render.hostile.test.tsx`: 58/58 baseline
//     rows unexpectedly PASSING both times, with the exact same per-register
//     counts as this file previously declared (D-WUI-6:1, 7:6, 8:4, 9:4,
//     12:4, 13:5, 14:4, 15:5, 16:4, 19:2, 20:2, 21:8, 22:4, 24:5 = 58).
//   - The two registers this file itself flagged as flaky/intermittent
//     (D-WUI-9, D-WUI-22) were additionally re-run 3 more times filtered to
//     just those routes (`-t "integrations.ecosystem|chat.console"`) for 5
//     total samples; all 8 of their rows stayed non-tripping every time —
//     satisfying BUG-011-CASE-OWNERS.md's "at least five fresh process
//     samples for cases documented as intermittent" bar.
//   - Source-read confirmation for two registers: SkillsView.tsx
//     (D-WUI-7) now validates `mcp_tools` through `looseArray(mcpToolSchema)`
//     inside a try/catch that defaults to `mcp_tools: []` — the old
//     `data.mcp_tools.filter` crash on a non-array/absent response can no
//     longer happen. DashboardView.tsx (D-WUI-8) carries its own inline note
//     ("`dashboardData?.layout.groups` was always safe...") confirming the
//     `.layout` access this baseline row was filed against is already
//     guarded.
//   - No code in this repo was changed to produce this result — this is a
//     pure STALE_BASELINE_CLOSED per BUG-011-CASE-OWNERS.md step 3
//     ("If it is already green on the claimed base, prove the landed
//     fix/ancestor and remove only the corresponding baseline.ts rows... do
//     not manufacture a new code change"). The landing fix is almost
//     certainly the BUG-008/BUG-009 "honest unavailable state" sweep
//     (commits `d897317`/`8d6e0d4`, GOC-28 W06) which gave exactly this set
//     of views typed loading/empty/error/unavailable classifiers backed by
//     `ApiShapeError`/`api-validation.ts`, landed after this baseline's rows
//     were last confirmed broken.
//
// KNOWN_BROKEN_ROUTES is intentionally empty. A register id with no entries
// means its view was fixed (or its baseline row was proven stale) and this
// comment records why — do not delete the register-id history above when
// re-adding a row; file a fresh dated entry instead so the audit trail for
// why an id disappeared, and why it may have reappeared, both survive.
export const KNOWN_BROKEN_ROUTES: readonly BaselineEntry[] = []

/** Fast lookup used by the test generator. */
export function isKnownBroken(routeId: string, fixture: FixtureId, viewport: Viewport): BaselineEntry | undefined {
  return KNOWN_BROKEN_ROUTES.find((e) => e.routeId === routeId && e.fixture === fixture && e.viewport === viewport)
}
