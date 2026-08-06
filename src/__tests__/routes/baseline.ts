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

// Captured 2026-08-06 against agent-webui @ 1f2f402 (main) + this lane's harness.
// One row per (routeId, fixture, viewport) that currently trips the
// ErrorBoundary. Grouped by register id for readability; order is not
// semantically meaningful.
export const KNOWN_BROKEN_ROUTES: readonly BaselineEntry[] = [
  // D-WUI-7 — SkillsView: data.mcp_tools.filter on a non-array response.
  // Also crashes on 'well-formed': src/__tests__/setup.ts's shared shim has
  // no route for /api/enhanced/tools, so it falls through to the catch-all
  // `[]` — `[].mcp_tools` is `undefined`, same crash class (see D-WUI-11 for
  // the same gap on /api/fleet/*).
  { routeId: 'control-plane.skills', fixture: 'well-formed', viewport: 'desktop', registerId: 'D-WUI-7' },
  { routeId: 'control-plane.skills', fixture: 'null', viewport: 'desktop', registerId: 'D-WUI-7' },
  { routeId: 'control-plane.skills', fixture: 'empty-object', viewport: 'desktop', registerId: 'D-WUI-7' },
  { routeId: 'control-plane.skills', fixture: 'empty-array', viewport: 'desktop', registerId: 'D-WUI-7' },
  { routeId: 'control-plane.skills', fixture: 'null', viewport: 'mobile', registerId: 'D-WUI-7' },
  { routeId: 'control-plane.skills', fixture: 'empty-object', viewport: 'mobile', registerId: 'D-WUI-7' },

  // D-WUI-8 — DashboardView: dashboardData?.layout.groups.map, `.layout`
  // unguarded. Also crashes on 'well-formed': setup.ts's shared shim has no
  // route for /api/dashboard/full (a different path prefix entirely, not
  // /api/enhanced/*), so it falls through to the catch-all `[]` — same crash
  // class as D-WUI-7/D-WUI-11/D-WUI-23's shim-coverage gaps.
  { routeId: 'observability.dashboard', fixture: 'well-formed', viewport: 'desktop', registerId: 'D-WUI-8' },
  { routeId: 'observability.dashboard', fixture: 'empty-array', viewport: 'desktop', registerId: 'D-WUI-8' },
  { routeId: 'observability.dashboard', fixture: 'empty-object', viewport: 'desktop', registerId: 'D-WUI-8' },
  { routeId: 'observability.dashboard', fixture: 'empty-object', viewport: 'mobile', registerId: 'D-WUI-8' },

  // D-WUI-9 — EcosystemView: processes.filter on a non-array response.
  // 'null' reproduces intermittently at desktop: EcosystemView fires
  // `resources` and `processes` fetches in parallel (Promise.all) and reads
  // `resources` first with a truthiness guard that can short-circuit before
  // the processes.filter line runs, depending on Promise settle order —
  // both outcomes are real, sampled across repeated mounts (see the test
  // file's `anyAttemptTripped`).
  { routeId: 'integrations.ecosystem', fixture: 'null', viewport: 'desktop', registerId: 'D-WUI-9' },
  { routeId: 'integrations.ecosystem', fixture: 'empty-object', viewport: 'desktop', registerId: 'D-WUI-9' },
  { routeId: 'integrations.ecosystem', fixture: 'null', viewport: 'mobile', registerId: 'D-WUI-9' },
  { routeId: 'integrations.ecosystem', fixture: 'empty-object', viewport: 'mobile', registerId: 'D-WUI-9' },

  // D-WUI-10 — ObjectExplorerView: (registeredActions ?? []).filter, {} is truthy
  { routeId: 'knowledge.object-explorer', fixture: 'empty-object', viewport: 'desktop', registerId: 'D-WUI-10' },
  { routeId: 'knowledge.object-explorer', fixture: 'empty-object', viewport: 'mobile', registerId: 'D-WUI-10' },

  // D-WUI-11 — FleetView: Object.entries(health.domains), `.domains` unguarded
  // (also crashes on the well-formed fixture — see item for the setup.ts shim gap)
  { routeId: 'control-plane.fleet', fixture: 'well-formed', viewport: 'desktop', registerId: 'D-WUI-11' },
  { routeId: 'control-plane.fleet', fixture: 'empty-array', viewport: 'desktop', registerId: 'D-WUI-11' },
  { routeId: 'control-plane.fleet', fixture: 'empty-object', viewport: 'desktop', registerId: 'D-WUI-11' },
  { routeId: 'control-plane.fleet', fixture: 'empty-object', viewport: 'mobile', registerId: 'D-WUI-11' },

  // D-WUI-12 — GoalsView: goals.length / goals.map on a non-array response
  { routeId: 'control-plane.goals', fixture: 'null', viewport: 'desktop', registerId: 'D-WUI-12' },
  { routeId: 'control-plane.goals', fixture: 'empty-object', viewport: 'desktop', registerId: 'D-WUI-12' },
  { routeId: 'control-plane.goals', fixture: 'null', viewport: 'mobile', registerId: 'D-WUI-12' },
  { routeId: 'control-plane.goals', fixture: 'empty-object', viewport: 'mobile', registerId: 'D-WUI-12' },

  // D-WUI-13 — KnowledgeBaseView: knowledgeBases.filter on a non-array response.
  // Also crashes on 'error': the 500 `{detail:...}` body is stored the same
  // way a well-formed body would be (no `res.ok` check before the cast).
  { routeId: 'knowledge.base', fixture: 'null', viewport: 'desktop', registerId: 'D-WUI-13' },
  { routeId: 'knowledge.base', fixture: 'empty-object', viewport: 'desktop', registerId: 'D-WUI-13' },
  { routeId: 'knowledge.base', fixture: 'error', viewport: 'desktop', registerId: 'D-WUI-13' },
  { routeId: 'knowledge.base', fixture: 'null', viewport: 'mobile', registerId: 'D-WUI-13' },
  { routeId: 'knowledge.base', fixture: 'empty-object', viewport: 'mobile', registerId: 'D-WUI-13' },

  // D-WUI-14 — PromptsView: prompts.filter on a non-array response
  { routeId: 'control-plane.prompts', fixture: 'null', viewport: 'desktop', registerId: 'D-WUI-14' },
  { routeId: 'control-plane.prompts', fixture: 'empty-object', viewport: 'desktop', registerId: 'D-WUI-14' },
  { routeId: 'control-plane.prompts', fixture: 'null', viewport: 'mobile', registerId: 'D-WUI-14' },
  { routeId: 'control-plane.prompts', fixture: 'empty-object', viewport: 'mobile', registerId: 'D-WUI-14' },

  // D-WUI-15 — SchedulingView: tasks.length / tasks.map on a non-array response
  { routeId: 'control-plane.scheduler', fixture: 'null', viewport: 'desktop', registerId: 'D-WUI-15' },
  { routeId: 'control-plane.scheduler', fixture: 'empty-object', viewport: 'desktop', registerId: 'D-WUI-15' },
  { routeId: 'control-plane.scheduler', fixture: 'error', viewport: 'desktop', registerId: 'D-WUI-15' },
  { routeId: 'control-plane.scheduler', fixture: 'null', viewport: 'mobile', registerId: 'D-WUI-15' },
  { routeId: 'control-plane.scheduler', fixture: 'empty-object', viewport: 'mobile', registerId: 'D-WUI-15' },

  // D-WUI-16 — SessionsView: sessions.length / sessions.map on a non-array response
  { routeId: 'control-plane.sessions', fixture: 'null', viewport: 'desktop', registerId: 'D-WUI-16' },
  { routeId: 'control-plane.sessions', fixture: 'empty-object', viewport: 'desktop', registerId: 'D-WUI-16' },
  { routeId: 'control-plane.sessions', fixture: 'null', viewport: 'mobile', registerId: 'D-WUI-16' },
  { routeId: 'control-plane.sessions', fixture: 'empty-object', viewport: 'mobile', registerId: 'D-WUI-16' },

  // D-WUI-17 — UsageView: tools.length / tools.map on a non-array response
  { routeId: 'observability.usage', fixture: 'null', viewport: 'desktop', registerId: 'D-WUI-17' },
  { routeId: 'observability.usage', fixture: 'empty-object', viewport: 'desktop', registerId: 'D-WUI-17' },
  { routeId: 'observability.usage', fixture: 'null', viewport: 'mobile', registerId: 'D-WUI-17' },
  { routeId: 'observability.usage', fixture: 'empty-object', viewport: 'mobile', registerId: 'D-WUI-17' },

  // D-WUI-18 — WorkflowEditorView: saved.length / saved.map on a non-array response
  { routeId: 'control-plane.workflows', fixture: 'null', viewport: 'desktop', registerId: 'D-WUI-18' },
  { routeId: 'control-plane.workflows', fixture: 'empty-object', viewport: 'desktop', registerId: 'D-WUI-18' },
  { routeId: 'control-plane.workflows', fixture: 'null', viewport: 'mobile', registerId: 'D-WUI-18' },
  { routeId: 'control-plane.workflows', fixture: 'empty-object', viewport: 'mobile', registerId: 'D-WUI-18' },

  // D-WUI-19 — OpsPanelView: pipelineStatus.phases on a null response (empty-object is guarded)
  { routeId: 'admin.ops', fixture: 'null', viewport: 'desktop', registerId: 'D-WUI-19' },
  { routeId: 'admin.ops', fixture: 'null', viewport: 'mobile', registerId: 'D-WUI-19' },

  // D-WUI-20 — ConfigurationView: Object.keys(config) on a null response
  { routeId: 'admin.configuration', fixture: 'null', viewport: 'desktop', registerId: 'D-WUI-20' },
  { routeId: 'admin.configuration', fixture: 'null', viewport: 'mobile', registerId: 'D-WUI-20' },

  // D-WUI-21 — ExtractionView: Sigma mounts against a zero-width jsdom
  // container (a render-timing bug, not a payload-shape one). Reproduces on
  // every fixture at desktop, confirming it's independent of payload shape.
  { routeId: 'knowledge.extraction', fixture: 'well-formed', viewport: 'desktop', registerId: 'D-WUI-21' },
  { routeId: 'knowledge.extraction', fixture: 'null', viewport: 'desktop', registerId: 'D-WUI-21' },
  { routeId: 'knowledge.extraction', fixture: 'empty-object', viewport: 'desktop', registerId: 'D-WUI-21' },
  { routeId: 'knowledge.extraction', fixture: 'empty-array', viewport: 'desktop', registerId: 'D-WUI-21' },
  { routeId: 'knowledge.extraction', fixture: 'error', viewport: 'desktop', registerId: 'D-WUI-21' },
  { routeId: 'knowledge.extraction', fixture: 'never-resolving', viewport: 'desktop', registerId: 'D-WUI-21' },
  { routeId: 'knowledge.extraction', fixture: 'null', viewport: 'mobile', registerId: 'D-WUI-21' },
  { routeId: 'knowledge.extraction', fixture: 'empty-object', viewport: 'mobile', registerId: 'D-WUI-21' },

  // D-WUI-22 — Chat.tsx: configQuery.data?.models.find, `.models` unguarded.
  // Empirically confirmed at mobile/empty-object only; the desktop variants
  // this comment speculated from static reading alone did not reproduce
  // through this harness (Chat.tsx's model-config query has more mount
  // dependencies than the simple fetch chain assumed) — not claiming those
  // are safe, just not asserting something this harness cannot back up.
  { routeId: 'chat.console', fixture: 'empty-object', viewport: 'mobile', registerId: 'D-WUI-22' },

  // D-WUI-23 — AdminView/TenantsPanel: sources.length, gateway `ok && data`
  // guard gap. Also crashes on 'well-formed': setup.ts's shared shim has no
  // route for /api/enhanced/code/instances, so it falls through to the
  // catch-all `[]` — an array has no `.source_systems` either, same crash
  // class (see D-WUI-11/D-WUI-7 for the same shim-coverage gap elsewhere).
  { routeId: 'admin.console', fixture: 'well-formed', viewport: 'desktop', registerId: 'D-WUI-23' },
  { routeId: 'admin.console', fixture: 'empty-array', viewport: 'desktop', registerId: 'D-WUI-23' },
  { routeId: 'admin.console', fixture: 'empty-object', viewport: 'desktop', registerId: 'D-WUI-23' },
  { routeId: 'admin.console', fixture: 'empty-object', viewport: 'mobile', registerId: 'D-WUI-23' },

  // D-WUI-24 — MemoryView: memories.filter on a non-array response. Also
  // crashes on 'error' (500 body stored the same way a well-formed body
  // would be).
  { routeId: 'knowledge.memories', fixture: 'null', viewport: 'desktop', registerId: 'D-WUI-24' },
  { routeId: 'knowledge.memories', fixture: 'empty-object', viewport: 'desktop', registerId: 'D-WUI-24' },
  { routeId: 'knowledge.memories', fixture: 'error', viewport: 'desktop', registerId: 'D-WUI-24' },
  { routeId: 'knowledge.memories', fixture: 'null', viewport: 'mobile', registerId: 'D-WUI-24' },
  { routeId: 'knowledge.memories', fixture: 'empty-object', viewport: 'mobile', registerId: 'D-WUI-24' },

  // D-WUI-25 — SDDView: specs.map / plans.map on a non-array response
  { routeId: 'control-plane.sdd', fixture: 'null', viewport: 'desktop', registerId: 'D-WUI-25' },
  { routeId: 'control-plane.sdd', fixture: 'empty-object', viewport: 'desktop', registerId: 'D-WUI-25' },
  { routeId: 'control-plane.sdd', fixture: 'null', viewport: 'mobile', registerId: 'D-WUI-25' },
  { routeId: 'control-plane.sdd', fixture: 'empty-object', viewport: 'mobile', registerId: 'D-WUI-25' },

  // D-WUI-6 (update) — GraphView / TemporalGraphView hostile-payload crashes,
  // additional to the pre-existing PageContextProvider defect that item already
  // tracked. See the [UPDATE to D-WUI-6] block for the two distinct crash sites.
  // GraphView also crashes on 'error' (500 body read the same as a good one);
  // TemporalGraphView also crashes on 'well-formed' at desktop (its own
  // GraphCanvas dependency shares GraphView's adjacency-building adapter,
  // src/components/knowledge-graph/GraphAdapter.ts, which is the same
  // unguarded code path).
  { routeId: 'knowledge.graph', fixture: 'null', viewport: 'desktop', registerId: 'D-WUI-6' },
  { routeId: 'knowledge.graph', fixture: 'empty-object', viewport: 'desktop', registerId: 'D-WUI-6' },
  { routeId: 'knowledge.graph', fixture: 'error', viewport: 'desktop', registerId: 'D-WUI-6' },
  { routeId: 'knowledge.graph', fixture: 'null', viewport: 'mobile', registerId: 'D-WUI-6' },
  { routeId: 'knowledge.graph', fixture: 'empty-object', viewport: 'mobile', registerId: 'D-WUI-6' },
  { routeId: 'knowledge.temporal-graph', fixture: 'null', viewport: 'desktop', registerId: 'D-WUI-6' },
  { routeId: 'knowledge.temporal-graph', fixture: 'well-formed', viewport: 'desktop', registerId: 'D-WUI-6' },
  { routeId: 'knowledge.temporal-graph', fixture: 'null', viewport: 'mobile', registerId: 'D-WUI-6' },
]

/** Fast lookup used by the test generator. */
export function isKnownBroken(routeId: string, fixture: FixtureId, viewport: Viewport): BaselineEntry | undefined {
  return KNOWN_BROKEN_ROUTES.find((e) => e.routeId === routeId && e.fixture === fixture && e.viewport === viewport)
}
