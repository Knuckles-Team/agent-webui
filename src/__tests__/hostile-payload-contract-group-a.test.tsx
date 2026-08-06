import type { ReactElement } from 'react'
import { describe, it, afterEach, vi } from 'vitest'
import SkillsView from '@/components/views/SkillsView'
import DashboardView from '@/components/views/DashboardView'
import GoalsView from '@/components/views/GoalsView'
import KnowledgeBaseView from '@/components/views/KnowledgeBaseView'
import PromptsView from '@/components/views/PromptsView'
import { stubFetch, expectSurvives, HOSTILE_FIXTURES } from './hostile-payload-contract-helpers'

/**
 * @file hostile-payload-contract-group-a.test.tsx
 * @description Defect-pinning coverage for D-WUI-7, -8, -12, -13, -14 —
 * views whose `fetch(...).then(r => r.json())` (or react-query `queryFn`)
 * call sites were migrated to `fetchValidated`/a validated zod schema in this
 * batch. See each view's inline `D-WUI-*` comment for the exact crash site
 * this closes.
 */
describe('hostile-payload contract — group A (control plane / observability / knowledge)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const cases: [string, string, () => ReactElement][] = [
    ['D-WUI-7', 'SkillsView', () => <SkillsView />],
    ['D-WUI-8', 'DashboardView', () => <DashboardView />],
    ['D-WUI-12', 'GoalsView', () => <GoalsView />],
    ['D-WUI-13', 'KnowledgeBaseView', () => <KnowledgeBaseView />],
    ['D-WUI-14', 'PromptsView', () => <PromptsView />],
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
