import type { ReactElement } from 'react'
import { describe, it, afterEach, vi } from 'vitest'
import FleetView from '@/components/views/FleetView'
import WorkflowEditorView from '@/components/views/WorkflowEditorView'
import UsageView from '@/components/views/UsageView'
import SDDView from '@/components/views/SDDView'
import ObjectExplorerView from '@/components/views/ObjectExplorerView'
import TenantsPanel from '@/components/views/admin/TenantsPanel'
import { stubFetch, expectSurvives, HOSTILE_FIXTURES } from './hostile-payload-contract-helpers'

/**
 * @file hostile-payload-contract-chokepoint.test.tsx
 * @description Defect-pinning coverage for the six D-WUI items closed by the
 * `api.ts` chokepoint validation ALONE — FleetView, WorkflowEditorView,
 * UsageView, SDDView, ObjectExplorerView, and AdminView's TenantsPanel needed
 * NO view-code change: each already had a `try/catch` (or a `?? []`) at the
 * call site that only needed the underlying `api.ts` method to actually
 * THROW on a bad shape instead of silently resolving with one. See
 * `src/lib/api.ts`'s `getValidated`/`getFleetHealth`/`listWorkflows`/
 * `getUsageSummary`/`listSpecs`/`listPlans`/`listOntologyActions` and
 * `src/lib/admin-api.ts`'s `fetchCodeInstances` for the validated call sites.
 *
 * Landed as its own batch (queue candidate) because it depends on nothing but
 * `src/lib/{api,api-validation,gateway,admin-api}.ts` —
 * smallest, most self-contained candidate of this lane's changes.
 */
describe('hostile-payload contract — chokepoint-only fixes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const cases: [string, string, () => ReactElement][] = [
    ['D-WUI-11', 'FleetView', () => <FleetView />],
    ['D-WUI-18', 'WorkflowEditorView', () => <WorkflowEditorView />],
    ['D-WUI-17', 'UsageView', () => <UsageView />],
    ['D-WUI-25', 'SDDView', () => <SDDView />],
    ['D-WUI-10', 'ObjectExplorerView', () => <ObjectExplorerView />],
    ['D-WUI-23', 'TenantsPanel (AdminView)', () => <TenantsPanel />],
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
