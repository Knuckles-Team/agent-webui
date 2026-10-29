import { afterEach, describe, expect, it, vi } from 'vitest'
import { runPanelQuery } from '../query'

const signal = new AbortController().signal
const panel = { query: { kind: 'uql' as const, text: 'MATCH (:Agent) |> LIMIT 5' } }

// spec: OVERSTORY-DASH-R004
describe('panel queries go through arbora (OVERSTORY-DASH-R004)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('refuses unsafe text before any request', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    const outcome = await runPanelQuery({ query: { kind: 'uql', text: 'MATCH (:Agent)' } }, [], signal)
    expect(outcome.state).toBe('error')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses an unknown parameter before any request', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    const outcome = await runPanelQuery(
      { query: { kind: 'uql', text: 'MATCH (:A) |> WHERE x = {{q}} |> LIMIT 5' } },
      [],
      signal,
    )
    expect(outcome).toMatchObject({ state: 'error', error: expect.stringContaining('unknown parameter') })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts to the governed graph query route and reports failure as an error state', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('boom') } as unknown as Response),
    )
    global.fetch = fetchMock as unknown as typeof fetch
    const outcome = await runPanelQuery(panel, [], signal)
    expect(outcome.state).toBe('error')
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('/api/graph/query')
  })
})
