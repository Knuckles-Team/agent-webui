import { afterEach, describe, expect, it, vi } from 'vitest'

import { failedEnvelope, unwrapEnvelope } from '@/lib/action-envelope'
import { atlasPost } from '@/lib/atlas/transport'
import { gatewayPost } from '@/lib/gateway'

function failedBody(code: string, message = 'The operation is not authorized.'): string {
  return JSON.stringify({
    status: 'failed',
    result: { status: 'failed', operation_id: 'op-1', error: { code, message } },
  })
}

function stubFetch(status: number, body: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status, headers: { 'Content-Type': 'application/json' } })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('failedEnvelope (EH-386)', () => {
  it('names the typed code and message and keeps the HTTP prefix', () => {
    expect(failedEnvelope(403, failedBody('permission_denied'))).toEqual({
      unavailable: false,
      error: 'HTTP 403: permission_denied: The operation is not authorized.',
    })
  })

  it('treats a down dependency as a stated absence', () => {
    expect(failedEnvelope(503, failedBody('dependency_unavailable', 'down'))?.unavailable).toBe(true)
    expect(failedEnvelope(503, failedBody('engine_degraded', 'retry'))?.unavailable).toBe(true)
  })

  it('ignores bodies that are not a typed failed operation', () => {
    expect(failedEnvelope(500, 'not json')).toBeNull()
    expect(failedEnvelope(500, JSON.stringify({ detail: 'boom' }))).toBeNull()
    expect(failedEnvelope(500, JSON.stringify({ status: 'failed', result: 'x' }))).toBeNull()
  })

  it('unwraps the success envelope', () => {
    expect(unwrapEnvelope({ status: 'success', result: [1] })).toEqual([1])
    expect(unwrapEnvelope([1])).toEqual([1])
  })
})

describe('HTTP helpers read the failed envelope', () => {
  it('gatewayPost reports a readable forbidden error', async () => {
    stubFetch(403, failedBody('permission_denied'))
    const result = await gatewayPost('/configure', { action: 'rbac_list' })
    expect(result).toEqual({
      ok: false,
      data: null,
      unavailable: false,
      error: 'HTTP 403: permission_denied: The operation is not authorized.',
    })
  })

  it('atlasPost marks a down engine as unavailable', async () => {
    stubFetch(503, failedBody('dependency_unavailable', 'A required service is unavailable.'))
    const result = await atlasPost('/api/graph/query', {}, new AbortController().signal)
    expect(result.unavailable).toBe(true)
    expect(result.error).toBe('HTTP 503: dependency_unavailable: A required service is unavailable.')
  })

  it('keeps the generic message for an ordinary gateway error', async () => {
    stubFetch(502, 'bad gateway')
    const result = await gatewayPost('/configure', {})
    expect(result.error).toBe('HTTP 502: bad gateway')
    expect(result.unavailable).toBe(false)
  })
})
