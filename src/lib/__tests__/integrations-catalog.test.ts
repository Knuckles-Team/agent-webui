/**
 * Tests for the GOC-25 integrations catalog client.
 *
 * These prove the composition rules from the module docstring against
 * mocked `fetch`, matching this repo's existing convention for API-client
 * tests (`readiness-api.test.ts`, `McpAppsView.test.tsx`): no live network,
 * every branch driven by a synthetic response.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchIntegrationsCatalog, MAX_CATALOG_ITEMS } from '@/lib/integrations-catalog'

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function mockFetch(handlers: { services?: () => Response; contributions?: () => Response }) {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = urlOf(input)
    if (url.includes('/ecosystem/services')) {
      return Promise.resolve(handlers.services ? handlers.services() : jsonResponse([]))
    }
    if (url.includes('/frontend-contributions')) {
      return Promise.resolve(
        handlers.contributions ? handlers.contributions() : new Response('not found', { status: 404 }),
      )
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  }) as unknown as typeof fetch
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchIntegrationsCatalog', () => {
  it("lists every live package even when the descriptor service is not deployed (today's real state)", async () => {
    mockFetch({
      services: () => jsonResponse(['github-agent', 'zz-catalog-parity-probe-mcp']),
      // No `contributions` handler -> defaults to 404, matching the real
      // backend today (GOC-24's route does not exist yet).
    })

    const catalog = await fetchIntegrationsCatalog()

    expect(catalog.liveCatalogState).toBe('ready')
    expect(catalog.descriptorCatalogState).toBe('unavailable')
    expect(catalog.items.map((i) => i.packageId)).toEqual(['github-agent', 'zz-catalog-parity-probe-mcp'])
    for (const item of catalog.items) {
      // KNOWN-BAD PROOF: with no descriptor authority reachable, NOTHING
      // may render as available -- every item is explicitly not_configured
      // with a stated reason, never silently dropped and never fabricated
      // as available.
      expect(item.status).toBe('not_configured')
      expect(item.reason).toBeTruthy()
      expect(item.descriptor).toBeNull()
    }
  })

  it('marks a package OK, with a valid descriptor, as available', async () => {
    mockFetch({
      services: () => jsonResponse(['gitlab-api']),
      contributions: () =>
        jsonResponse({
          packages: [
            {
              package_id: 'gitlab-api',
              status: 'OK',
              reason: null,
              descriptor: {
                title: 'GitLab',
                package_version: '1.0.0',
                read_models: [{ id: 'merge_requests' }],
                actions: [{ id: 'gitlab.merge_request.review' }],
              },
            },
          ],
        }),
    })

    const catalog = await fetchIntegrationsCatalog()
    expect(catalog.descriptorCatalogState).toBe('ready')
    const item = catalog.items.find((i) => i.packageId === 'gitlab-api')
    expect(item?.status).toBe('available')
    expect(item?.reason).toBeNull()
    expect(item?.descriptor).toEqual({
      title: 'GitLab',
      packageVersion: '1.0.0',
      readModelIds: ['merge_requests'],
      actionIds: ['gitlab.merge_request.review'],
    })
  })

  it('KNOWN-BAD PROOF: a descriptor record missing its required title field is never rendered as available', async () => {
    mockFetch({
      services: () => jsonResponse(['broken-descriptor-pkg']),
      contributions: () =>
        jsonResponse({
          packages: [
            {
              package_id: 'broken-descriptor-pkg',
              status: 'OK',
              reason: null,
              // `title` (required by descriptorRecordSchema) is missing.
              descriptor: { package_version: '2.0.0', read_models: [], actions: [] },
            },
          ],
        }),
    })

    const catalog = await fetchIntegrationsCatalog()
    const item = catalog.items.find((i) => i.packageId === 'broken-descriptor-pkg')
    expect(item).toBeDefined()
    expect(item?.status).not.toBe('available')
    expect(item?.status).toBe('blocked')
    expect(item?.reason).toMatch(/failed validation/i)
    expect(item?.descriptor).toBeNull()
  })

  it("KNOWN-BAD PROOF: one malformed descriptor record does not block a sibling package's valid descriptor", async () => {
    mockFetch({
      services: () => jsonResponse(['broken-pkg', 'healthy-pkg']),
      contributions: () =>
        jsonResponse({
          packages: [
            { package_id: 'broken-pkg', status: 'OK', reason: null, descriptor: { package_version: 'x' } },
            {
              package_id: 'healthy-pkg',
              status: 'OK',
              reason: null,
              descriptor: { title: 'Healthy', package_version: '1.0.0', read_models: [], actions: [] },
            },
          ],
        }),
    })

    const catalog = await fetchIntegrationsCatalog()
    expect(catalog.items.find((i) => i.packageId === 'broken-pkg')?.status).toBe('blocked')
    expect(catalog.items.find((i) => i.packageId === 'healthy-pkg')?.status).toBe('available')
  })

  it('a BLOCKED/MISSING descriptor record renders as blocked with its stated reason, not silently omitted', async () => {
    mockFetch({
      services: () => jsonResponse(['locked-pkg']),
      contributions: () =>
        jsonResponse({
          packages: [
            { package_id: 'locked-pkg', status: 'BLOCKED', reason: 'signature verification failed', descriptor: null },
          ],
        }),
    })

    const catalog = await fetchIntegrationsCatalog()
    const item = catalog.items.find((i) => i.packageId === 'locked-pkg')
    expect(item?.status).toBe('blocked')
    expect(item?.reason).toBe('signature verification failed')
  })

  it('KNOWN-BAD PROOF: a live-catalog backend error renders as an explicit failure, never as an empty-looking success', async () => {
    mockFetch({
      services: () => new Response(JSON.stringify({ detail: 'internal error' }), { status: 500 }),
    })

    const catalog = await fetchIntegrationsCatalog()
    expect(catalog.liveCatalogState).toBe('error')
    expect(catalog.liveCatalogReason).toBeTruthy()
    // Zero items on error must be distinguishable from "confirmed zero
    // packages installed" -- callers gate on `liveCatalogState`, never on
    // `items.length === 0` alone.
    expect(catalog.items).toEqual([])
  })

  it('a network-level failure on the live catalog resolves unavailable, not error, and never throws', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network unreachable'))) as unknown as typeof fetch
    const catalog = await fetchIntegrationsCatalog()
    expect(catalog.liveCatalogState).toBe('unavailable')
    expect(catalog.items).toEqual([])
  })

  it('a malformed live-catalog shape (not an array of strings) is an error, never coerced', async () => {
    mockFetch({
      services: () => jsonResponse({ not: 'an array' }),
    })
    const catalog = await fetchIntegrationsCatalog()
    expect(catalog.liveCatalogState).toBe('error')
    expect(catalog.items).toEqual([])
  })

  it('a malformed descriptor-catalog envelope (packages not an array of objects) is an explicit error, not fabricated success', async () => {
    mockFetch({
      services: () => jsonResponse(['some-pkg']),
      contributions: () => jsonResponse({ packages: 'not-an-array-of-objects' }),
    })
    const catalog = await fetchIntegrationsCatalog()
    expect(catalog.descriptorCatalogState).toBe('error')
    // Base parity list must still be intact even though the descriptor
    // authority failed -- the two authorities fail independently.
    expect(catalog.items.map((i) => i.packageId)).toEqual(['some-pkg'])
    expect(catalog.items[0].status).toBe('not_configured')
  })

  it('caps the catalog at MAX_CATALOG_ITEMS and sorts deterministically', async () => {
    const many = Array.from({ length: MAX_CATALOG_ITEMS + 25 }, (_, i) => `pkg-${String(i).padStart(4, '0')}`)
    mockFetch({ services: () => jsonResponse(many) })
    const catalog = await fetchIntegrationsCatalog()
    expect(catalog.items).toHaveLength(MAX_CATALOG_ITEMS)
    const ids = catalog.items.map((i) => i.packageId)
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
  })

  it('an empty live catalog is a distinct ready-but-empty state, not an error', async () => {
    mockFetch({ services: () => jsonResponse([]) })
    const catalog = await fetchIntegrationsCatalog()
    expect(catalog.liveCatalogState).toBe('empty')
    expect(catalog.items).toEqual([])
  })
})
