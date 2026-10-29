// spec: OVERSTORY-APPS-R049.1.16
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
afterEach(() => vi.unstubAllGlobals())
describe('Existing analytics API validation', () => {
  it('retains the existing explicit tenant and filter binding without tenant-total substitution', async () => {
    const fetcher = vi.fn(async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)
    await expect(
      api.getUsageByModel({ tenant_id: 'tenant/a', model: 'model one', from: '2026-10-01' }),
    ).resolves.toEqual([])
    expect(fetcher).toHaveBeenCalledWith(
      '/api/observability/by-model?tenant_id=tenant%2Fa&model=model%20one&from=2026-10-01',
    )
  })
  it.each([null, {}, 'wrong-shape'])(
    'does not turn absent or malformed lists into measured empty data: %j',
    async (payload) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } })),
      )
      await expect(api.getUsageByModel()).rejects.toThrow('shape violation')
      await expect(api.getUsageSearch('needle')).rejects.toThrow('shape violation')
    },
  )
  it('validates session message and usage events before exposing a detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              session: {
                id: 'selected',
                project: 'project',
                agent: 'agent',
                message_count: 1,
                total_output_tokens: 1,
                cost_usd: 0,
                outcome: 'complete',
                origin: 'runtime',
              },
              messages: null,
              tool_calls: [],
              usage_events: [],
            }),
            { headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    )
    await expect(api.getUsageSessionDetail('selected')).rejects.toThrow('shape violation')
  })
})
