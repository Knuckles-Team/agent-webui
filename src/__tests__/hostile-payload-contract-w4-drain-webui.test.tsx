import type { ReactElement } from 'react'
import { describe, it, afterEach, vi } from 'vitest'
import GoalsView from '@/components/views/GoalsView'
import SessionsView from '@/components/views/SessionsView'
import OpsPanelView from '@/components/views/OpsPanelView'
import ConfigurationView from '@/components/views/ConfigurationView'
import DashboardView from '@/components/views/DashboardView'
import EcosystemView from '@/components/views/EcosystemView'
import { stubFetch, expectSurvives, HOSTILE_FIXTURES } from './hostile-payload-contract-helpers'

/**
 * @file hostile-payload-contract-w4-drain-webui.test.tsx
 * @description Defect-pinning coverage for the batch of D-WUI-8/9/12/16/19/20
 * crash-on-hostile-payload items closed by lane w4-drain-webui (2026-08-07),
 * re-verified as genuinely still unfixed on `main` at the time this lane
 * started (the api-validation.ts chokepoint docstring's claim that these
 * routes had already been migrated onto `fetchValidated()` was aspirational,
 * not actual -- confirmed by grepping each view for the raw `res.json() as T`
 * cast it still had):
 *
 * - D-WUI-12 GoalsView — `/api/enhanced/goals` (list) and
 *   `/api/enhanced/goals/{id}/iterations` (detail) moved onto
 *   `fetchValidated()` + zod schemas.
 * - D-WUI-16 SessionsView — same fix shape for `/api/enhanced/sessions`.
 * - D-WUI-19 OpsPanelView — `/api/enhanced/pipeline/status` moved onto
 *   `fetchValidated()` with a schema that coerces a null body to `{}` (a
 *   legitimate "no pipeline run yet" state, matching every field already
 *   being optional) instead of crashing `pipelineStatus.phases`. Also fixed
 *   the sibling `/api/enhanced/maintenance/status` fetch (same file, same
 *   defect shape, discovered while fixing the filed item).
 * - D-WUI-20 ConfigurationView — `/api/enhanced/config` moved onto
 *   `validateShape()` with the same null-coerces-to-`{}` schema, fixing
 *   `Object.keys(config)` crashing on a null body. Also fixed the sibling
 *   `/api/enhanced/config/groups` best-effort fetch (same file, same shape).
 * - D-WUI-8 DashboardView — `/api/dashboard/full` moved onto
 *   `fetchValidated()` with a full schema (rather than threading `?.` through
 *   `dashboardData?.layout.groups`, which ESLint's `no-unnecessary-condition`
 *   correctly rejected once the type stopped lying about being fully present
 *   whenever `dashboardData` itself is truthy).
 * - D-WUI-9 EcosystemView — `/api/enhanced/systems-manager/processes` moved
 *   onto `validateShape()` + `looseArray()`, fixing `processes.filter(...)`.
 *   Also fixed the sibling `/api/enhanced/systems-manager/resources` fetch
 *   (same file, same defect shape: `resources?.memory.percent` only guarded
 *   `resources` itself, not `.memory`), discovered while fixing the filed
 *   item.
 *
 * D-WUI-22 (Chat.tsx `/api/configure`) is fixed the same way (see
 * `getModels()` in `src/Chat.tsx`) but is not covered by this shared-fixture
 * harness: `Chat` fetches several other endpoints unconditionally on mount
 * (conversation history, workspace info, tool config) that `stubFetch`'s
 * single global stub would also intercept, which is not a faithful
 * reproduction of the real failure (only `/api/configure` misbehaving) and
 * risks a false failure unrelated to this fix. Verified instead by `tsc
 * --noEmit` (the `remoteConfigSchema` return type flows through
 * `configQuery.data?.models.find(...)` cleanly) and by reading the fixed
 * source directly.
 */
describe('hostile-payload contract — w4-drain-webui batch (D-WUI-8/9/12/16/19/20)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const cases: [string, string, () => ReactElement][] = [
    ['D-WUI-12', 'GoalsView', () => <GoalsView />],
    ['D-WUI-16', 'SessionsView', () => <SessionsView />],
    ['D-WUI-19', 'OpsPanelView', () => <OpsPanelView />],
    ['D-WUI-20', 'ConfigurationView', () => <ConfigurationView />],
    ['D-WUI-8', 'DashboardView', () => <DashboardView />],
    ['D-WUI-9', 'EcosystemView', () => <EcosystemView />],
  ]

  for (const [registerId, label, make] of cases) {
    describe(`${registerId} — ${label}`, () => {
      for (const [fixtureName, body, opts] of HOSTILE_FIXTURES) {
        it(`does not trip the ErrorBoundary on a ${fixtureName} response`, async () => {
          stubFetch(body, opts)
          await expectSurvives(make())
        })
      }
    })
  }
})
