import type { ReactElement } from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { waitFor, screen } from '@testing-library/react'
import KnowledgeBaseView from '@/components/views/KnowledgeBaseView'
import SchedulingView from '@/components/views/SchedulingView'
import ExtractionView from '@/components/views/ExtractionView'
import MemoryView from '@/components/views/MemoryView'
import KnowledgeView from '@/components/views/KnowledgeView'
import PromptsView from '@/components/views/PromptsView'
import SkillsView from '@/components/views/SkillsView'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { renderWithProviders } from './fixtures'
import { stubFetch, expectSurvives, HOSTILE_FIXTURES } from './hostile-payload-contract-helpers'

/**
 * @file hostile-payload-contract-view-fixes.test.tsx
 * @description Defect-pinning coverage for the three D-WUI items closed by an
 * actual VIEW-code change (unlike hostile-payload-contract-chokepoint.test.tsx's
 * batch, which needed nothing but the api.ts validation boundary):
 *
 * - D-WUI-13 KnowledgeBaseView — `/api/enhanced/kb/list` and `/kb/search`
 *   moved off `res.json() as T` onto `fetchValidated()` + zod schemas, so a
 *   non-array response is caught (toast + empty state) instead of crashing
 *   `knowledgeBases.filter(...)`.
 * - D-WUI-15 SchedulingView — same fix shape for `/api/enhanced/cron/{calendar,logs}`.
 * - D-WUI-21 ExtractionView — NOT a payload-shape bug: constructing Sigma
 *   against a 0x0 container (which jsdom always reports, since it has no
 *   real layout engine) threw synchronously. Guarded via a one-shot
 *   ResizeObserver + a `clientWidth/clientHeight > 0` check before
 *   construction — this is exactly the jsdom scenario the register item
 *   flagged as indistinguishable from a real "hidden tab" race.
 *
 * Confirmed live against au.example (real browser, real backend, real auth
 * session — see D-WUI-29/plans/au-eg-program/audits/audit-sl5-ui-validation
 * 2026-08-06 w2-e2e-testuser section) before this fix: all three routes
 * (control-plane.scheduler, knowledge.base, knowledge.extraction) tripped
 * the ErrorBoundary with "Something went wrong" on real API responses, not
 * just synthetic hostile fixtures — these are live, reproducible bugs, not
 * theoretical ones.
 *
 * - D-WUI (2026-08-06, w3-webui-dataplane) MemoryView / KnowledgeView /
 *   PromptsView — the actual root-cause crash sites of the "12 broken pages"
 *   incident: all three called `fetch()` directly, bypassing the
 *   `api.ts`/`api-validation.ts` chokepoint entirely, so a 401 response body
 *   (`{"error": "..."}`) went straight into `setState` and a later
 *   `.filter()` (MemoryView/KnowledgeView render-time, or PromptsView's
 *   `filteredPrompts`) crashed with "m.filter is not a function". Moved onto
 *   `fetchValidated()` + zod schemas so a non-2xx throws `ApiError` before it
 *   can reach state, and a 401 specifically now renders
 *   `SessionExpiredNotice` ("session expired / sign in") instead of a blank
 *   page or a toast the user cannot act on.
 */
describe('hostile-payload contract — view-code fixes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const cases: [string, string, () => ReactElement][] = [
    ['D-WUI-13', 'KnowledgeBaseView', () => <KnowledgeBaseView />],
    ['D-WUI-15', 'SchedulingView', () => <SchedulingView />],
    ['D-WUI', 'MemoryView', () => <MemoryView />],
    ['D-WUI', 'KnowledgeView', () => <KnowledgeView />],
    ['D-WUI', 'PromptsView', () => <PromptsView />],
    ['D-WUI-7', 'SkillsView', () => <SkillsView />],
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

  describe('D-WUI-21 — ExtractionView', () => {
    it('does not throw constructing Sigma against jsdom’s 0x0 container', async () => {
      // jsdom reports every element as 0x0 (no real layout engine) — this is
      // exactly the condition that used to throw "Sigma: Container has no
      // width." synchronously inside the graph-build effect. No hostile
      // fetch payload needed here; the crash trigger is the container size,
      // not the response shape.
      stubFetch({ jobs: [] })
      renderWithProviders(
        <ErrorBoundary>
          <ExtractionView />
        </ErrorBoundary>,
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
      await waitFor(() => {
        expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
      })
    })
  })
})
