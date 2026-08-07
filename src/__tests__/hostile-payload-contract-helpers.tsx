import type { ReactElement } from 'react'
import { expect, vi } from 'vitest'
import { waitFor, screen } from '@testing-library/react'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { renderWithProviders } from './fixtures'

/**
 * @file hostile-payload-contract-helpers.tsx
 * @description Shared mounting helper for this lane's (w1-webui-api-contract)
 * own defect-pinning coverage of D-WUI-7..25 / D-WUI-6, split across several
 * `hostile-payload-contract-*.test.tsx` files — one per landed batch — rather
 * than one file importing every fixed view, so each batch's candidate is
 * self-contained and testable against `main` on its own (see the lane report
 * "Land in batches" section). Each split file otherwise documents the same
 * rationale this used to carry as one file; see git history / the lane
 * report for the consolidated narrative if this file is read in isolation.
 */

export function stubFetch(body: unknown, opts: { ok?: boolean; status?: number } = {}) {
  const status = opts.status ?? (opts.ok === false ? 500 : 200)
  const ok = opts.ok ?? status < 300
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
        headers: { get: () => 'application/json' },
      } as unknown as Response),
    ),
  )
}

/** Mount `ui` inside the same ErrorBoundary App.tsx wraps every route in, and assert it never trips. */
export async function expectSurvives(ui: ReactElement) {
  renderWithProviders(<ErrorBoundary>{ui}</ErrorBoundary>)
  // Give every fetch → .then(setState) chain a turn to settle.
  await new Promise((resolve) => setTimeout(resolve, 0))
  await waitFor(() => {
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })
}

export const HOSTILE_FIXTURES: [string, unknown, { ok?: boolean; status?: number }?][] = [
  ['null', null],
  ['empty-object', {}],
  ['empty-array', []],
  ['error envelope', { detail: 'internal error' }, { ok: false, status: 500 }],
  // D-WUI (2026-08-06): the root cause of the "12 broken pages" incident — an
  // OIDC misconfiguration made every authenticated route 401 with exactly
  // this shaped body (`agent/agent_webui/server.py`'s identity gate). Several
  // views stored this object straight into state and a later `.filter()`/
  // `.map()` crashed with "m.filter is not a function" — one auth failure,
  // a dozen broken pages, and this fixture class did not catch it because it
  // had no case using the real `error` key or a 401 status. Covering it here
  // pins that class shut across every view in this file's `cases` list.
  ['401 auth-required envelope', { error: 'Verified Bearer identity required' }, { ok: false, status: 401 }],
]
