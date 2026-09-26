import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchDecisionAggregate } from '../decisions-api'
import { invoke } from '../graphos-api/invoke'

vi.mock('../graphos-api/invoke', () => ({ invoke: vi.fn() }))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GraphOS DecisionLog caller', () => {
  it('sends the engine aggregate window under the GraphOS operation schema', async () => {
    const aggregate = { schema_version: 1, min_support: 10, rows: [] }
    vi.mocked(invoke).mockResolvedValue(aggregate)

    await expect(fetchDecisionAggregate({ questionId: 'assemble', fromMs: 100, toMs: 200 })).resolves.toBe(aggregate)
    expect(invoke).toHaveBeenCalledWith(
      'decisions.aggregate',
      { question_id: 'assemble', window: { from_ms: 100, to_ms: 200 } },
      expect.anything(),
    )
  })

  it('uses a bounded present-time endpoint for the all-time aggregate', async () => {
    vi.mocked(invoke).mockResolvedValue({ schema_version: 1, min_support: 10, rows: [] })
    vi.spyOn(Date, 'now').mockReturnValue(9876)

    await fetchDecisionAggregate()
    expect(invoke).toHaveBeenCalledWith(
      'decisions.aggregate',
      { question_id: null, window: { from_ms: 0, to_ms: 9876 } },
      expect.anything(),
    )
  })
})
