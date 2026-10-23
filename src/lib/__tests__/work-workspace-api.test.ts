// spec: WEBUI-APPS-R049.1.3
import { afterEach, describe, expect, it, vi } from 'vitest'
import { workApi } from '../work-workspace'
afterEach(() => vi.unstubAllGlobals())
describe('Work existing contract adapters', () => {
  it('accepts minimal served task rows and nested status without inventing a legacy session shape', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json([{ id: 'task-a' }]))
      .mockResolvedValueOnce(Response.json({ id: 'task-a', status: { state: 'working' } }))
    vi.stubGlobal('fetch', fetch)
    expect(await workApi.listTasks()).toEqual([{ id: 'task-a' }])
    expect(await workApi.getTask('task-a')).toMatchObject({ id: 'task-a', status: { state: 'working' } })
    expect(fetch.mock.calls[0][0]).toBe('/api/enhanced/sessions?limit=50')
    expect(fetch.mock.calls[1][0]).toBe('/api/enhanced/sessions/task-a')
  })
  it('rejects malformed task data rather than treating it as an empty collection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ sessions: [] })),
    )
    await expect(workApi.listTasks()).rejects.toThrow()
  })
  it('decodes the existing graph trace envelope and does not create missing latency', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          status: 'success',
          result: {
            surface: 'traces',
            action: 'waterfall',
            result: { trace: { id: 'trace-a' }, nodes: [{ id: 'node-a', parentId: null, kind: 'span' }] },
          },
        }),
      ),
    )
    const result = await workApi.getRun('trace-a')
    expect(result.ok).toBe(true)
    expect(result.data?.result.nodes[0].latencyMs).toBeUndefined()
  })
  it('distinguishes unavailable trace capability from malformed successful data', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 501 }))
      .mockResolvedValueOnce(Response.json({ result: null }))
    vi.stubGlobal('fetch', fetch)
    expect(await workApi.listRuns()).toMatchObject({ ok: false, unavailable: true })
    expect(await workApi.listRuns()).toMatchObject({ ok: false, unavailable: false })
  })
})
