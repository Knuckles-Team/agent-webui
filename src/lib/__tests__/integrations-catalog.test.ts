/**
 * Tests for the GOC-25 integrations catalog client.
 *
 * These prove the composition rules from the module docstring against
 * mocked `fetch`, matching this repo's existing convention for API-client
 * tests (`readiness-api.test.ts`, `frontend-contributions.test.ts`): no live
 * network, every branch driven by a synthetic response. Descriptor
 * catalog fixtures follow `frontend-contributions.ts`'s real
 * `FrontendContribution.v1` shape exactly (that module is the schema
 * authority this client consumes -- see integrations-catalog.ts's
 * docstring) rather than a simplified stand-in.
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

const DIGEST_A = `sha256:${'a'.repeat(64)}`
const DIGEST_B = `sha256:${'b'.repeat(64)}`

/** A fully valid `FrontendContribution.v1` descriptor -- every field
 * `frontend-contributions.ts`'s `frontendContributionSchema` (a
 * `.strictObject`, extra=forbid) requires. */
function validDescriptor(packageId: string, title: string): Record<string, unknown> {
  return {
    schema_version: 'frontend-contribution.v1',
    package_id: packageId,
    package_version: '1.0.0',
    descriptor_version: 1,
    descriptor_digest: DIGEST_A,
    title,
    icon: 'plug',
    nav: { section: 'integrations', order: 1 },
    required_scopes: [],
    read_models: [
      { id: 'inventory', schema: 'Asset.v1', capability: `${packageId}.inventory`, renderer: 'data-table' },
    ],
    actions: [],
    panels: [],
    realtime_topics: [],
    empty_state: 'No data reported.',
    docs_ref: `pkg:${packageId}/docs/README.md`,
    provenance: { source: 'package-entry-point', signer_key_id: 'key-1', artifact_digest: DIGEST_B },
    extensions: {},
  }
}

/** A valid record wrapping the descriptor above, for a given status. */
function validRecord(
  packageId: string,
  title: string,
  status: 'OK' | 'DEGRADED' | 'BLOCKED' | 'MISSING',
  reason?: string,
) {
  const carriesDescriptor = status === 'OK' || status === 'DEGRADED'
  return {
    status,
    package_id: packageId,
    provider_name: `${packageId}-provider`,
    reason: status === 'OK' ? null : (reason ?? `${status.toLowerCase()} reason`),
    descriptor: carriesDescriptor ? validDescriptor(packageId, title) : null,
    descriptor_digest: carriesDescriptor ? DIGEST_A : null,
    registration_digest: 'reg-digest',
    source_digest: carriesDescriptor ? 'src-digest' : null,
  }
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
        jsonResponse({ catalog_epoch: DIGEST_A, packages: [validRecord('gitlab-api', 'GitLab', 'OK')] }),
    })

    const catalog = await fetchIntegrationsCatalog()
    expect(catalog.descriptorCatalogState).toBe('ready')
    const item = catalog.items.find((i) => i.packageId === 'gitlab-api')
    expect(item?.status).toBe('available')
    expect(item?.reason).toBeNull()
    expect(item?.descriptor).toEqual({
      title: 'GitLab',
      packageVersion: '1.0.0',
      readModelIds: ['inventory'],
      actionIds: [],
    })
  })

  it('a DEGRADED record renders as degraded, carrying its reason and real descriptor', async () => {
    mockFetch({
      services: () => jsonResponse(['flaky-pkg']),
      contributions: () =>
        jsonResponse({
          catalog_epoch: DIGEST_A,
          packages: [validRecord('flaky-pkg', 'Flaky', 'DEGRADED', 'a referenced capability is unavailable')],
        }),
    })
    const catalog = await fetchIntegrationsCatalog()
    const item = catalog.items.find((i) => i.packageId === 'flaky-pkg')
    expect(item?.status).toBe('degraded')
    expect(item?.reason).toBe('a referenced capability is unavailable')
    expect(item?.descriptor?.title).toBe('Flaky')
  })

  it('a BLOCKED/MISSING descriptor record renders as blocked with its stated reason, not silently omitted', async () => {
    mockFetch({
      services: () => jsonResponse(['locked-pkg']),
      contributions: () =>
        jsonResponse({
          catalog_epoch: DIGEST_A,
          packages: [validRecord('locked-pkg', 'Locked', 'BLOCKED', 'signature verification failed')],
        }),
    })

    const catalog = await fetchIntegrationsCatalog()
    const item = catalog.items.find((i) => i.packageId === 'locked-pkg')
    expect(item?.status).toBe('blocked')
    expect(item?.reason).toBe('signature verification failed')
    expect(item?.descriptor).toBeNull()
  })

  it('KNOWN-BAD PROOF: a descriptor catalog missing a required field (title) never lets ANY item render as available', async () => {
    const brokenDescriptor = validDescriptor('broken-descriptor-pkg', 'Broken')
    delete brokenDescriptor.title // required by frontend-contributions.ts's strict schema

    mockFetch({
      services: () => jsonResponse(['broken-descriptor-pkg', 'sibling-pkg']),
      contributions: () =>
        jsonResponse({
          catalog_epoch: DIGEST_A,
          packages: [
            {
              status: 'OK',
              package_id: 'broken-descriptor-pkg',
              provider_name: 'p',
              reason: null,
              descriptor: brokenDescriptor,
              descriptor_digest: DIGEST_A,
              registration_digest: 'r',
              source_digest: 's',
            },
            validRecord('sibling-pkg', 'Sibling', 'OK'),
          ],
        }),
    })

    const catalog = await fetchIntegrationsCatalog()
    // GOC-24's own schema validates the descriptor catalog atomically (one
    // malformed record fails the whole array) -- this client mirrors that,
    // never inventing a laxer per-record fallback of its own.
    expect(catalog.descriptorCatalogState).toBe('error')
    for (const item of catalog.items) {
      expect(item.status).not.toBe('available')
      expect(item.status).toBe('not_configured')
      expect(item.reason).toBeTruthy()
    }
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

  it('a package with no descriptor record at all (present in live list, absent from descriptor catalog) is not_configured', async () => {
    mockFetch({
      services: () => jsonResponse(['undescribed-pkg']),
      contributions: () => jsonResponse({ catalog_epoch: DIGEST_A, packages: [] }),
    })
    const catalog = await fetchIntegrationsCatalog()
    const item = catalog.items.find((i) => i.packageId === 'undescribed-pkg')
    expect(item?.status).toBe('not_configured')
    expect(item?.reason).toBeTruthy()
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
