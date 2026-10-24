// spec: WEBUI-APPS-R049.1.4
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FleetCatalogSchema,
  FleetStatusSchema,
  navigateOperate,
  operateApi,
  operateHref,
  parseOperateState,
} from '../operate-workspace'
afterEach(() => vi.unstubAllGlobals())
describe('Operate typed navigation', () => {
  it('rejects malformed unicode without changing history', () => {
    const before = window.location.href
    expect(() => {
      navigateOperate({ server: '\ud800', item: null, q: '' }, 'reader')
    }).toThrow()
    expect(() => {
      navigateOperate({ server: null, item: null, q: '\udfff' }, 'reader')
    }).toThrow()
    expect(window.location.href).toBe(before)
  })
  it('round trips selected children, capabilities and retained filters', () => {
    const state = { server: 'source/a', item: 'tool/a b', q: 'source' }
    expect(parseOperateState(operateHref(state))).toEqual(state)
    navigateOperate(state, 'reader')
    expect(parseOperateState(location.pathname + location.search)).toEqual(state)
  })
  it.each([
    '/workspace/operate?server=a&server=b',
    '/workspace/operate?item=a',
    '/workspace/operate?definition=a',
    '/workspace/operate?connector=a&connector=b',
    '/workspace/operate?connector=a&definition=a&definition=b',
    '/workspace/operate?connector=%00',
    '/workspace/operate?connector=',
    '/workspace/operate?token=x',
    '/workspace/operate#secret',
    'https://evil.invalid/workspace/operate',
  ])('rejects invalid destination %s', (path) => {
    expect(() => parseOperateState(path)).toThrow()
  })
  it('strips unapproved metadata instead of exposing raw fleet payloads', () => {
    expect(
      FleetStatusSchema.parse({
        value: { children: { source: { state: 'running', secret: 'not public' } }, session: { token: 'private' } },
      }),
    ).toEqual({ value: { children: { source: { state: 'running' } } } })
    expect(
      FleetCatalogSchema.parse({
        value: {
          items: [{ id: 'x', name: 'Read', kind: 'tool', input_schema: { secret: 'ignored' } }],
          next_cursor: null,
        },
      }).value.items[0],
    ).not.toHaveProperty('input_schema')
  })
  it('rejects malformed data instead of displaying successful empty fleet', () => {
    expect(() => FleetStatusSchema.parse({ value: {} })).toThrow()
    expect(() => FleetStatusSchema.parse({ value: { children: { a: { state: 'up', mounted_tools: -1 } } } })).toThrow()
  })
  it('uses actual shared gateway envelope and never loads or probes selected servers', async () => {
    const fetcher = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url === '/auth/session'
              ? { authenticated: true, csrf_token: 'test' }
              : {
                  ok: true,
                  result: {
                    value: { items: [{ id: 'a', name: 'Read', server: 's', kind: 'tool' }], next_cursor: 'a' },
                  },
                  meta: { registry_digest: 'test', api_version: 'v1' },
                },
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetcher)
    expect((await operateApi.catalog(null)).value.items[0].id).toBe('a')
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual(['/auth/session', '/api/v1/ops/fleet.catalog.list'])
    const calls = fetcher.mock.calls as unknown as [string, RequestInit][]
    expect(JSON.parse(calls[1][1].body as string)).toEqual({ browse: true, limit: 100, cursor: null })
  })
})

// spec: WEBUI-APPS-R046.2.2
it('round trips catalog identities independently of retained fleet context', () => {
  const state = {
    server: 'fleet',
    item: 'capability',
    q: 'filter',
    connector: 'catalog:records',
    definition: 'tool:one/two',
  }
  expect(parseOperateState(operateHref(state))).toEqual(state)
  navigateOperate(state, 'reader')
  expect(parseOperateState(window.location.pathname + window.location.search)).toEqual(state)
})
