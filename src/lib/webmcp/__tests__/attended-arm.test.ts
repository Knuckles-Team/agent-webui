import { afterEach, describe, expect, it, vi } from 'vitest'
import { installCsrfToken } from '@/lib/csrf'
import { SameOriginAttendedArmClient, type AttendedArmScope } from '../attended-arm'

const SCOPE: AttendedArmScope = {
  route_id: 'graph',
  registration_generation: 7,
  catalog_digest: `sha256:${'a'.repeat(64)}`,
  tool_scope_digest: `sha256:${'b'.repeat(64)}`,
  tools: [{ tool_id: 'agent-webui.read', schema_digest: `sha256:${'c'.repeat(64)}` }],
}

afterEach(() => {
  installCsrfToken(null)
  vi.unstubAllGlobals()
})

describe('same-origin attended-arm authority client', () => {
  it('reads only non-secret readiness and sends the exact scope to step-up', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'recent-auth',
            expires_at: 4_000_000_000,
            route_id: SCOPE.route_id,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authorization_url: 'https://identity.example/authorize',
            expires_at: 4_000_000_000,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'armed',
            expires_at: 4_000_000_000,
            route_id: SCOPE.route_id,
            registration_generation: SCOPE.registration_generation,
            catalog_digest: SCOPE.catalog_digest,
            tool_scope_digest: SCOPE.tool_scope_digest,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new SameOriginAttendedArmClient()

    await expect(client.readiness()).resolves.toMatchObject({ status: 'recent-auth', route_id: 'graph' })
    await expect(client.initiate({ route_id: 'graph', next: '/graph' })).resolves.toMatchObject({
      authorization_url: expect.stringContaining('identity'),
    })
    await expect(client.finalize(SCOPE)).resolves.toMatchObject({ status: 'armed', route_id: 'graph' })
    await expect(client.revoke()).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/browser-control/attended-arm',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/browser-control/attended-arm',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ route_id: 'graph', next: '/graph' }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/browser-control/attended-arm/finalize',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({
          route_id: SCOPE.route_id,
          registration_generation: SCOPE.registration_generation,
          catalog_digest: SCOPE.catalog_digest,
          tools: SCOPE.tools,
        }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/browser-control/attended-arm',
      expect.objectContaining({ method: 'DELETE', credentials: 'same-origin' }),
    )
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/receipt|bearer|token/i)
  })

  it('cancels an authority response stream as soon as it exceeds the byte cap', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4_097))
      },
      cancel,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream, { status: 200 })),
    )

    await expect(new SameOriginAttendedArmClient().readiness()).rejects.toThrow(
      'Attended browser control is unavailable',
    )
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('rejects duplicate decoded keys in authority responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"status":"none","stat\\u0075s":"none"}', { status: 200 })),
    )

    await expect(new SameOriginAttendedArmClient().readiness()).rejects.toThrow('duplicate keys')
  })
})

// spec: OVERSTORY-APPS-R048
it('uses the canonical CSRF owner for arm mutations, rotation and session clearing', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'none' })))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ authorization_url: 'https://identity.example/authorize', expires_at: 4_000_000_000 }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'armed',
          expires_at: 4_000_000_000,
          route_id: SCOPE.route_id,
          registration_generation: SCOPE.registration_generation,
          catalog_digest: SCOPE.catalog_digest,
          tool_scope_digest: SCOPE.tool_scope_digest,
        }),
      ),
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)
  installCsrfToken('first-session-csrf')
  const client = new SameOriginAttendedArmClient()
  await client.readiness()
  await client.initiate({ route_id: SCOPE.route_id })
  installCsrfToken('rotated-session-csrf')
  await client.finalize(SCOPE)
  await client.revoke()
  installCsrfToken(null)
  await client.revoke()

  const tokens = fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get('X-CSRF-Token'))
  expect(tokens).toEqual([null, 'first-session-csrf', 'rotated-session-csrf', 'rotated-session-csrf', null])
  expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'POST', 'POST', 'DELETE', 'DELETE'])
  expect(fetchMock.mock.calls.every(([, init]) => init?.credentials === 'same-origin')).toBe(true)
})
