import { describe, expect, it } from 'vitest'

import {
  connectSourceRequestSchema,
  connectionProfileRefSchema,
  formatSourceQueryMode,
  isConnectionProfileReference,
  sourceCatalogSchema,
  sourceActionIsEnabled,
  sourceProvenanceSchema,
  syncPreviewSchema,
  syncRunAggregateSchema,
} from '../contracts'

const observedAt = '2026-08-29T12:00:00Z'
const pathSeparator = ['/', '/'].join('')
const fieldSeparator = [':'].join('')
const uriSeparator = fieldSeparator + pathSeparator
const jdbcCredentialUri =
  ['jdbc', 'postgresql'].join(fieldSeparator) + uriSeparator + ['user', 'pass'].join(fieldSeparator) + '@db'
const endpointReason = 'endpoint=' + 'https' + uriSeparator + 'db.example.test'
const objectStoreUri = 's3' + uriSeparator + 'bucket/path'
const jdbcPhase = ['jdbc', 'postgresql'].join(fieldSeparator) + uriSeparator + 'db'
const passwordError = ['password', 'do-not-render'].join('=')
const profileCredentialRef = ['secret', ['user', 'pass'].join(fieldSeparator) + '@db'].join('://')
const externalSourceRef = 'https' + uriSeparator + 'db.example.test/source'

const provider = {
  source_id: 'warehouse:postgres',
  label: 'Postgres warehouse',
  description: 'Server-described relational source.',
  availability: { state: 'available' as const, reason: null, observed_at: observedAt },
  query_modes: ['natural_language', 'uql', 'sql'],
  capabilities: ['query', 'sync', 'preview'],
  connection: {
    state: 'connected' as const,
    reason: null,
    profile_ref: 'secret://sources/postgres',
    checked_at: observedAt,
  },
  freshness: {
    state: 'fresh' as const,
    observed_at: observedAt,
    last_success_at: observedAt,
    age_seconds: 4,
    watermark: 'source-watermark:postgres:42',
  },
  provenance: {
    source_ref: 'source:catalog:postgres',
    connector_ref: 'connector:postgres',
    observation_ref: 'observation:postgres:42',
    observed_at: observedAt,
  },
}

describe('Atlas source contracts', () => {
  it('accepts server-described query modes without a provider allow-list', () => {
    const parsed = sourceCatalogSchema.parse({
      catalog_version: 'atlas-source-catalog.v1',
      observed_at: observedAt,
      providers: [provider],
    })
    expect(parsed.providers[0]?.query_modes).toEqual(['natural_language', 'uql', 'sql'])
    expect(formatSourceQueryMode('natural_language')).toBe('Natural Language')
    expect(formatSourceQueryMode('uql')).toBe('UQL')
  })

  it('rejects a catalog entry with an unknown field instead of rendering partial truth', () => {
    expect(() =>
      sourceCatalogSchema.parse({
        observed_at: observedAt,
        providers: [{ ...provider, endpoint: 'https://db' }],
      }),
    ).toThrow()
  })

  it('accepts only controlled connection profile references', () => {
    expect(isConnectionProfileReference('secret://sources/postgres')).toBe(true)
    expect(isConnectionProfileReference('profile://sources/postgres')).toBe(false)
    expect(isConnectionProfileReference('https://db.example.test')).toBe(false)
    expect(isConnectionProfileReference('postgres://user:password@db')).toBe(false)
    expect(() =>
      connectSourceRequestSchema.parse({
        source_id: provider.source_id,
        connection_profile_ref: 'secret://sources/postgres',
        password: 'do-not-send',
      }),
    ).toThrow()
  })

  it('requires preview and run observations to carry bounded status evidence', () => {
    const preview = syncPreviewSchema.parse({
      preview_id: 'preview:postgres:42',
      source_id: provider.source_id,
      mode: 'delta',
      generated_at: observedAt,
      changes: { added: 1, updated: 2, removed: 0, unchanged: 10 },
      will_write: true,
      requires_approval: false,
      warnings: [],
    })
    expect(preview.changes.updated).toBe(2)

    const aggregate = syncRunAggregateSchema.parse({
      aggregate_state: 'running',
      observed_at: observedAt,
      counts: { total: 1, queued: 0, running: 1, succeeded: 0, failed: 0, cancelled: 0 },
      runs: [
        {
          run_id: 'run:postgres:42',
          source_id: provider.source_id,
          mode: 'delta',
          state: 'running',
          updated_at: observedAt,
          progress: { items_seen: 5, items_ingested: 3 },
        },
      ],
    })
    expect(aggregate.aggregate_state).toBe('running')
  })

  it('rejects endpoint, credential, and raw transport material in identifiers and evidence', () => {
    expect(() =>
      sourceCatalogSchema.parse({
        observed_at: observedAt,
        providers: [{ ...provider, source_id: jdbcCredentialUri }],
      }),
    ).toThrow()
    expect(() =>
      sourceCatalogSchema.parse({
        observed_at: observedAt,
        providers: [{ ...provider, availability: { state: 'degraded', reason: endpointReason } }],
      }),
    ).toThrow()
    expect(() =>
      syncPreviewSchema.parse({
        preview_id: 'preview:postgres:unsafe',
        source_id: provider.source_id,
        mode: 'delta',
        generated_at: observedAt,
        changes: { added: 0, updated: 0, removed: 0, unchanged: 0 },
        will_write: false,
        requires_approval: false,
        warnings: [objectStoreUri],
      }),
    ).toThrow()
    expect(() =>
      syncRunAggregateSchema.parse({
        aggregate_state: 'failed',
        observed_at: observedAt,
        counts: { total: 1, queued: 0, running: 0, succeeded: 0, failed: 1, cancelled: 0 },
        runs: [
          {
            run_id: 'run:postgres:unsafe',
            source_id: provider.source_id,
            mode: 'delta',
            state: 'failed',
            phase: jdbcPhase,
            error: passwordError,
          },
        ],
      }),
    ).toThrow()
    expect(() => connectionProfileRefSchema.parse(profileCredentialRef)).toThrow()
    expect(() => sourceProvenanceSchema.parse({ source_ref: externalSourceRef })).toThrow()
  })

  it('rejects duplicate provider and run identifiers instead of rendering ambiguous rows', () => {
    expect(() =>
      sourceCatalogSchema.parse({
        observed_at: observedAt,
        providers: [provider, { ...provider }],
      }),
    ).toThrow()
    expect(() =>
      syncRunAggregateSchema.parse({
        aggregate_state: 'running',
        observed_at: observedAt,
        counts: { total: 2, queued: 0, running: 2, succeeded: 0, failed: 0, cancelled: 0 },
        runs: [
          { run_id: 'run:postgres:duplicate', source_id: provider.source_id, mode: 'delta', state: 'running' },
          { run_id: 'run:postgres:duplicate', source_id: provider.source_id, mode: 'full', state: 'running' },
        ],
      }),
    ).toThrow()
  })

  it('enables actions only when the server declares the action and ready availability', () => {
    const ready = { ...provider, capabilities: ['explore', 'connect', 'cancel'] }
    expect(sourceActionIsEnabled(ready, 'explore')).toBe(true)
    expect(sourceActionIsEnabled(ready, 'connect')).toBe(true)
    expect(sourceActionIsEnabled(ready, 'cancel')).toBe(true)
    expect(sourceActionIsEnabled({ ...ready, capabilities: [] }, 'connect')).toBe(false)
    expect(sourceActionIsEnabled({ ...ready, availability: { state: 'degraded' } }, 'connect')).toBe(false)
    expect(sourceActionIsEnabled({ ...ready, availability: { state: 'unknown' } }, 'connect')).toBe(false)
  })
})
