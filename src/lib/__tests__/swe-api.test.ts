import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'

function mockFetch(payload: unknown) {
  const spy = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(''),
  } as unknown as Response)
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SWE runtime api client', () => {
  it('sweEventsUrl builds the SSE path for a session', () => {
    expect(api.sweEventsUrl('abc123')).toBe('/api/runtime/sessions/abc123/events')
  })

  it('createSweSession POSTs to /api/runtime/sessions', async () => {
    const spy = mockFetch({ session_id: 's1', backend: 'local', workdir: '/w' })
    const res = await api.createSweSession({ prefer_docker: false })
    expect(res.session_id).toBe('s1')
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/runtime/sessions')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ prefer_docker: false })
  })

  it('sweAct POSTs the typed action to the session', async () => {
    const spy = mockFetch({ kind: 'cmd_output', exit_code: 0 })
    await api.sweAct('s1', { kind: 'cmd_run', command: 'ls' })
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/runtime/sessions/s1/act')
    expect(JSON.parse(init.body as string)).toEqual({ kind: 'cmd_run', command: 'ls' })
  })

  it('sweProvenance GETs the provenance panel data', async () => {
    const spy = mockFetch({ run_id: 's1', actions: [], mutated: [] })
    const res = await api.sweProvenance('s1')
    expect(res.run_id).toBe('s1')
    expect(spy.mock.calls[0][0]).toBe('/api/runtime/sessions/s1/provenance')
  })

  it('runSweBench POSTs instances to /api/swebench/run', async () => {
    const spy = mockFetch({ run_id: 'r1', report: { total: 0 }, remediation: null })
    await api.runSweBench({ instances: [{ instance_id: 'x' }] })
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/swebench/run')
    expect(JSON.parse(init.body as string).instances).toHaveLength(1)
  })
})
