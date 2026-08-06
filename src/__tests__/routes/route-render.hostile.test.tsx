/**
 * @file route-render.hostile.test.tsx
 * @description D-WUI-2 — the per-route hostile-payload render harness.
 *
 * Enumerates every route in `route-source.ts` (`ROUTES`) and mounts each one
 * against every fixture in the hostile payload matrix (`hostile-fixtures.ts`)
 * — well-formed, `null`, `{}` where a list is expected, `[]`, a 4xx/5xx error
 * body, and a never-resolving request — plus, at a mobile viewport, the two
 * fixtures most likely to trip the `.filter is not a function` class of bug.
 *
 * Because the test *iterates the registry*, a new route with no ROUTES entry
 * fails this suite by construction — coverage cannot silently drop.
 *
 * ── The baseline (why this file does NOT just assert "never trips") ────────
 * agent-webui's `.mergequeue.yaml` `vitest` gate is DIFFERENTIAL: a candidate
 * that introduces any `^FAIL ` line not already on `main` is rejected. This
 * harness's job is to prove existing views are broken, so an unconditional
 * "every mount must pass" suite is *guaranteed* rejection on first landing —
 * that's not a bug in the gate, it's a mismatch between what this suite
 * asserts and what the gate is allowed to let through. `baseline.ts` is the
 * fix: every currently-known-broken (route, fixture, viewport) is looked up
 * there and asserted with `it.fails()` instead of `it()`. `it.fails()` (not
 * `it.skip`/`it.todo`) is load-bearing: vitest reports a test wrapped in
 * `.fails()` as PASSED when the inner assertion throws (expected), and as a
 * genuine `^FAIL ` line — "Error: Expect test to fail" — when the inner
 * assertion unexpectedly succeeds. So when a wave-1 lane fixes, say,
 * `SkillsView`, this suite goes red until they delete that entry from
 * `baseline.ts` — closing the register item and shrinking the baseline are
 * the same edit. A `.skip`/`.todo` would prove nothing here: it would let a
 * fix land silently AND let a regression in an already-broken route land
 * silently too. See `baseline.ts`'s own header for the full rationale and
 * the self-test note below for proof this actually happens.
 *
 * Assertion, for every (route, fixture) pair: the route mounts and the
 * ErrorBoundary does NOT trip (no "Something went wrong" fallback) — unless
 * `baseline.ts` says it's expected to, in which case the inverse.
 *
 * `ROUTES` comes from `route-source.ts`, which re-exports the real
 * `src/lib/nav-registry.ts` (PROGRAM.md R1, landed by sibling lane
 * `w0-webui-registry`, `main` @ `ad1cb76`) — see that file for the one route
 * (`knowledge.object-detail`) whose element needs props the shared zero-prop
 * contract can't carry; `render-route.tsx` special-cases it.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { ROUTES } from './route-source'
import { HOSTILE_FIXTURES, MOBILE_FIXTURE_IDS } from './hostile-fixtures'
import { renderRoute, setViewport, flush, clearLeakedIntervals, DESKTOP_WIDTH, MOBILE_WIDTH } from './render-route'
import { isKnownBroken, type Viewport } from './baseline'

// See render-route.tsx's `clearLeakedIntervals` doc comment: several views
// leak a polling `setInterval`; force-clearing it after every test is what
// makes this suite's outcomes independent of test order.
afterEach(() => {
  clearLeakedIntervals()
})

/**
 * A route's crash is a property of its CODE (an unguarded `.filter` given a
 * particular fixture), so it is deterministic in principle — but whether
 * THIS harness's single mount+flush cycle happens to observe the crash
 * before checking varies with async scheduling this file's `flush()`
 * comment documents at length. Rather than chase a perfect fixed real-time
 * budget further, sample up to 3 independent mount+flush attempts (each
 * fully torn down before the next) and take "tripped on at least one
 * attempt" as the verdict: a genuinely reproducible crash needs one lucky
 * sample to be caught; a genuinely clean route needs to stay clean across
 * all 3. This is the harness accounting for its own measurement noise, not
 * a retry-until-you-like-the-answer pattern — see the lane report for the
 * before/after determinism data.
 */
const MOUNT_ATTEMPTS = 3

async function anyAttemptTripped(mount: () => Promise<boolean>): Promise<boolean> {
  for (let attempt = 0; attempt < MOUNT_ATTEMPTS; attempt += 1) {
    if (attempt > 0) cleanup()
    if (await mount()) return true
  }
  return false
}

function runOne(
  routeId: string,
  fixtureId: Parameters<typeof isKnownBroken>[1],
  viewport: Viewport,
  mount: () => Promise<boolean>,
) {
  const baselineEntry = isKnownBroken(routeId, fixtureId, viewport)
  const label = baselineEntry
    ? `[baseline ${baselineEntry.registerId}] trips the ErrorBoundary on fixture "${fixtureId}"${viewport === 'mobile' ? ' at mobile width' : ''} (known-broken, expected to stay broken until ${baselineEntry.registerId} closes)`
    : `does not trip the ErrorBoundary on fixture "${fixtureId}"${viewport === 'mobile' ? ' at mobile width' : ''}`

  // Same assertion either way — "the route does NOT trip the ErrorBoundary
  // on ANY of up to 3 sampled mounts". For a baseline (known-broken) entry
  // this assertion THROWS (tripped is true), and `it.fails()` reports that
  // internal throw as the outer test PASSING (silently, in vitest's
  // "expected fail" bucket) — that's the correct steady state for a route
  // that's still broken. If the underlying view gets fixed, `tripped` stays
  // false across all 3 attempts, the assertion no longer throws, and
  // `it.fails()` reports the outer test as FAILED — a genuine `^FAIL` line
  // ("Error: Expect test to fail") — which is what forces whoever landed
  // the fix to also delete this entry from `baseline.ts`.
  const assertNotTripped = async () => {
    const tripped = await anyAttemptTripped(mount)
    expect(tripped, `route "${routeId}" tripped the ErrorBoundary under fixture "${fixtureId}"`).toBe(false)
  }

  if (baselineEntry) {
    it.fails(label, assertNotTripped)
  } else {
    it(label, assertNotTripped)
  }
}

describe('route render harness — desktop x hostile payload matrix', () => {
  beforeEach(() => {
    setViewport(DESKTOP_WIDTH)
  })

  for (const route of ROUTES) {
    describe(`route ${route.id} (${route.path})`, () => {
      for (const fixture of HOSTILE_FIXTURES) {
        runOne(route.id, fixture.id, 'desktop', async () => {
          fixture.installFetch()
          const result = renderRoute(route)
          await flush()
          const tripped = result.tripped()
          result.cleanupQueryClient()
          return tripped
        })
      }
    })
  }
})

describe('route render harness — mobile viewport x hostile payload subset', () => {
  beforeEach(() => {
    setViewport(MOBILE_WIDTH)
  })

  for (const route of ROUTES) {
    describe(`route ${route.id} (${route.path}) [mobile:${route.mobile}]`, () => {
      for (const fixtureId of MOBILE_FIXTURE_IDS) {
        const fixture = HOSTILE_FIXTURES.find((f) => f.id === fixtureId)
        if (!fixture) throw new Error(`unknown mobile fixture id "${fixtureId}"`)

        runOne(route.id, fixture.id, 'mobile', async () => {
          fixture.installFetch()
          const result = renderRoute(route)
          await flush()
          const tripped = result.tripped()
          result.cleanupQueryClient()
          return tripped
        })
      }
    })
  }
})

describe('route registry coverage', () => {
  it('every route in ROUTES has a non-empty id, path, and element', () => {
    for (const route of ROUTES) {
      expect(route.id, 'route missing id').toBeTruthy()
      expect(route.path, `route "${route.id}" missing path`).toBeTruthy()
      expect(route.element, `route "${route.id}" missing element`).toBeTruthy()
    }
  })

  it('route ids are unique (no two routes silently collide)', () => {
    const ids = ROUTES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // R3 ("blurb is mandatory on every route... a missing or placeholder blurb
  // fails CI") is already enforced by `src/lib/__tests__/nav-registry.test.ts`
  // (owned by `w0-webui-registry`). Not duplicated here.

  it('every baseline.ts entry references a real route and a real fixture', async () => {
    const { KNOWN_BROKEN_ROUTES } = await import('./baseline')
    const routeIds = new Set(ROUTES.map((r) => r.id))
    const fixtureIds = new Set(HOSTILE_FIXTURES.map((f) => f.id))
    for (const entry of KNOWN_BROKEN_ROUTES) {
      expect(routeIds.has(entry.routeId), `baseline.ts references unknown route "${entry.routeId}"`).toBe(true)
      expect(fixtureIds.has(entry.fixture), `baseline.ts references unknown fixture "${entry.fixture}"`).toBe(true)
      expect(
        entry.registerId,
        `baseline.ts entry for "${entry.routeId}"/"${entry.fixture}" has no register id`,
      ).toMatch(/^D-WUI-\d+$/)
    }
  })
})
