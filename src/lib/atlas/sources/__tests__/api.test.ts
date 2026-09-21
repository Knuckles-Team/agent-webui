import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  cancelSourceRun,
  connectSource,
  DEFAULT_ATLAS_SOURCE_ROUTES,
  fetchSourceCatalog,
  fetchSourceRuns,
  previewSourceSync,
  startSourceSync,
} from '../api'
import {
  atlasSourceCatalogQueryKey,
  atlasSourceConnectionQueryKey,
  atlasSourceRunsQueryKey,
  atlasSourceScopeKey,
} from '../useAtlasSources'
import type { SourceScope } from '../contracts'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

const signal = new AbortController().signal
const pathSeparator = ['/', '/'].join('')
const fieldSeparator = [':'].join('')
const uriSeparator = fieldSeparator + pathSeparator
const jdbcCredentialUri =
  ['jdbc', 'postgresql'].join(fieldSeparator) +
  uriSeparator +
  ['user', 'pass'].join(fieldSeparator) +
  '@db password=do-not-render'
const odbcCredentialUri = 'odbc' + uriSeparator + ['user', 'pass'].join(fieldSeparator) + '@warehouse'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Atlas source API', () => {
  it('validates and returns the server-owned source catalog', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          observed_at: '2026-08-29T12:00:00Z',
          providers: [
            {
              source_id: 'source:postgres',
              label: 'Postgres',
              availability: { state: 'available' },
              query_modes: ['natural_language', 'uql'],
              capabilities: ['query'],
            },
          ],
        }),
      ),
    ) as typeof fetch

    const result = await fetchSourceCatalog({ signal })
    expect(result.ok).toBe(true)
    expect(result.data?.providers[0]?.source_id).toBe('source:postgres')
    expect(global.fetch).toHaveBeenCalledWith(DEFAULT_ATLAS_SOURCE_ROUTES.catalog, expect.anything())
  })

  it('does not send a request when a connection payload contains raw secret material', async () => {
    global.fetch = vi.fn() as typeof fetch
    const result = await connectSource({
      signal,
      payload: {
        source_id: 'source:postgres',
        connection_profile_ref: 'https://db.example.test' as never,
      },
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Invalid Atlas source request')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('does not treat an empty source filter as an aggregate request', async () => {
    global.fetch = vi.fn() as typeof fetch
    const result = await fetchSourceRuns({ signal, sourceId: '' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Invalid Atlas source id')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('does not copy a raw HTTP response body into a source error', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse(jdbcCredentialUri, 500))) as typeof fetch

    const result = await fetchSourceCatalog({ signal })

    expect(result.ok).toBe(false)
    expect(result.error).toBe('Atlas source request failed.')
    expect(result.error).not.toContain('jdbc:')
    expect(result.error).not.toContain('password')

    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ error: odbcCredentialUri }))) as typeof fetch
    const invalidShape = await fetchSourceCatalog({ signal })
    expect(invalidShape.error).toBe('Atlas source request failed.')
    expect(invalidShape.error).not.toContain('odbc:')
  })

  it('keeps preview and start payloads separate so execution references a preview id', async () => {
    const requests: { path: string; body: unknown }[] = []
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ path: String(input), body: init?.body ? JSON.parse(String(init.body)) : null })
      if (String(input).includes('/preview')) {
        return Promise.resolve(
          jsonResponse({
            preview_id: 'preview:postgres:1',
            source_id: 'source:postgres',
            mode: 'delta',
            generated_at: '2026-08-29T12:00:00Z',
            changes: { added: 1, updated: 0, removed: 0, unchanged: 0 },
            will_write: true,
            requires_approval: false,
            warnings: [],
          }),
        )
      }
      return Promise.resolve(jsonResponse({ run_id: 'run:postgres:1', source_id: 'source:postgres', state: 'queued' }))
    }) as typeof fetch

    const preview = await previewSourceSync({
      signal,
      payload: { source_id: 'source:postgres', mode: 'delta' },
    })
    const start = await startSourceSync({
      signal,
      payload: { preview_id: preview.data?.preview_id ?? 'preview:postgres:1' },
    })

    expect(preview.ok).toBe(true)
    expect(start.ok).toBe(true)
    expect(requests[0]?.body).toEqual({ source_id: 'source:postgres', mode: 'delta' })
    expect(requests[1]?.body).toEqual({ preview_id: 'preview:postgres:1' })
  })

  it('cancels by server-owned run reference without accepting raw configuration', async () => {
    const requests: { path: string; body: unknown }[] = []
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ path: String(input), body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(
        jsonResponse({
          run_id: 'run:postgres:1',
          state: 'cancelling',
          observed_at: '2026-08-29T12:00:00Z',
        }),
      )
    }) as typeof fetch

    const result = await cancelSourceRun({
      signal,
      payload: { run_id: 'run:postgres:1' },
    })

    expect(result.ok).toBe(true)
    expect(requests[0]?.path).toContain('/atlas/sync/runs/run%3Apostgres%3A1/cancel')
    expect(requests[0]?.body).toEqual({ run_id: 'run:postgres:1' })
  })
})

const sourceScope: SourceScope = {
  authority: 'graph-os',
  tenant: 'homelab',
  principal: 'alice@example.com',
}

describe('Atlas source query scope keys', () => {
  it('keeps authority, tenant, and principal in every source query key', () => {
    const otherScope: SourceScope = { ...sourceScope, principal: 'bob@example.com' }

    expect(atlasSourceScopeKey(sourceScope)).toEqual(['scope', 'graph-os', 'homelab', 'alice@example.com'])
    expect(atlasSourceCatalogQueryKey(DEFAULT_ATLAS_SOURCE_ROUTES, sourceScope)).not.toEqual(
      atlasSourceCatalogQueryKey(DEFAULT_ATLAS_SOURCE_ROUTES, otherScope),
    )
    expect(atlasSourceConnectionQueryKey(DEFAULT_ATLAS_SOURCE_ROUTES, 'source:postgres', sourceScope)).not.toEqual(
      atlasSourceConnectionQueryKey(DEFAULT_ATLAS_SOURCE_ROUTES, 'source:postgres', otherScope),
    )
    expect(atlasSourceRunsQueryKey(DEFAULT_ATLAS_SOURCE_ROUTES, 'source:postgres', sourceScope)).not.toEqual(
      atlasSourceRunsQueryKey(DEFAULT_ATLAS_SOURCE_ROUTES, 'source:postgres', otherScope),
    )
  })

  it('fails closed to an unscoped key when a discriminator is absent or malformed', () => {
    expect(atlasSourceScopeKey(undefined)).toEqual(['scope', 'unscoped'])
    expect(atlasSourceScopeKey({ ...sourceScope, tenant: '' })).toEqual(['scope', 'unscoped'])
  })

  it('places the scope before the run id so scoped run invalidation remains isolated', () => {
    const key = atlasSourceRunsQueryKey(DEFAULT_ATLAS_SOURCE_ROUTES, 'source:postgres', sourceScope)
    const scopeStart = key.indexOf('scope')
    const sourceIndex = key.indexOf('source:postgres')

    expect(scopeStart).toBeGreaterThan(-1)
    expect(sourceIndex).toBeGreaterThan(scopeStart)
  })
})
