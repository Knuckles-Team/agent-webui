/**
 * @file hostile-fixtures.ts
 * @description The hostile payload matrix for the per-route render harness (D-WUI-2).
 *
 * `au.example/graph` and siblings fail with "Something went wrong / e.filter is
 * not a function" — a component assumes the API returned an ARRAY when it
 * actually returned an object, `null`, or an error body. A render test with
 * well-formed mocks passes and catches nothing. Each fixture below replaces
 * `global.fetch` for the duration of one test with a response shaped to
 * trigger exactly one class of that bug, for every request the mounted route
 * issues (view components call several different `/api/enhanced/*` endpoints
 * per mount, so the matrix is applied uniformly rather than per-endpoint).
 *
 * `src/__tests__/setup.ts` already installs a route-aware, well-formed
 * `global.fetch` shim before every test — the 'well-formed' fixture is a
 * no-op that leaves it in place. Every other fixture overrides it.
 */
import { vi } from 'vitest'

export type FixtureId = 'well-formed' | 'null' | 'empty-object' | 'empty-array' | 'error' | 'never-resolving'

export interface HostileFixture {
  id: FixtureId
  /** What real-world API misbehavior this fixture stands in for. */
  description: string
  /** What class of bug a failure under this fixture indicates. */
  catches: string
  /** Installs (or deliberately leaves alone) `global.fetch` for one test. */
  installFetch: () => void
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  const status = init.status ?? 200
  const ok = init.ok ?? (status >= 200 && status < 300)
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

/** Replace `global.fetch` with one that returns `body` for every request. */
function installUniformFetch(body: unknown, init?: { ok?: boolean; status?: number }): void {
  global.fetch = vi.fn(() => Promise.resolve(jsonResponse(body, init)))
}

export const HOSTILE_FIXTURES: readonly HostileFixture[] = [
  {
    id: 'well-formed',
    description: 'the well-formed, route-aware default shim from src/__tests__/setup.ts',
    catches: 'ordinary regression',
    installFetch: () => {
      // Intentional no-op: setup.ts's `beforeEach` already installed the
      // well-formed default shim. Redeclaring it here would just be a
      // second source of truth for the same fixtures.
    },
  },
  {
    id: 'null',
    description: 'every endpoint resolves 200 OK with a JSON `null` body',
    catches: 'unguarded property/index access on a response the view assumed was present',
    installFetch: () => {
      installUniformFetch(null)
    },
  },
  {
    id: 'empty-object',
    description: 'every endpoint resolves 200 OK with `{}` where a list was expected',
    catches: 'the `.filter is not a function` class — array methods called on an object',
    installFetch: () => {
      installUniformFetch({})
    },
  },
  {
    id: 'empty-array',
    description: 'every endpoint resolves 200 OK with `[]`',
    catches: 'missing/incorrect empty-state handling',
    installFetch: () => {
      installUniformFetch([])
    },
  },
  {
    id: 'error',
    description: 'every endpoint resolves 500 with a FastAPI-shaped `{ detail: "..." }` error body',
    catches: 'error-shape-as-data — the view treats the error envelope as if it were the payload',
    installFetch: () => {
      installUniformFetch({ detail: 'Internal Server Error (hostile-fixture)' }, { ok: false, status: 500 })
    },
  },
  {
    id: 'never-resolving',
    description: 'every endpoint returns a Promise that never settles',
    catches: 'missing loading state — the view must render something other than a crash while pending',
    installFetch: () => {
      global.fetch = vi.fn(() => new Promise<Response>(() => undefined))
    },
  },
]

/** The fixtures cheap enough, and targeted enough, to double-run at the mobile viewport. */
export const MOBILE_FIXTURE_IDS: readonly FixtureId[] = ['null', 'empty-object']
