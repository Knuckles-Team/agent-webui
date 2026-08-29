import { describe, expect, it, vi } from 'vitest'

import {
  compileNaturalLanguageQuery,
  createNaturalLanguageQueryRequest,
  executeNaturalLanguageQuery,
  NATURAL_LANGUAGE_QUERY_REQUEST_SCHEMA,
} from '../index'

const evidenceBundle = {
  answer_candidate: 'One result.',
  claims: [{ id: 'claim:1', text: 'One result.' }],
  evidence_spans: [{ ref: 'claim:1' }],
  source_authority: { graph: '__commons__' },
  contradictions: [],
  confidence: null,
  freshness: {},
  policy_exclusions: [],
  reasoning_trace: [
    {
      step: 'nl_query',
      generated_query: 'MATCH (:Thing) |> LIMIT 1',
      plan: { dialect: 'uql', query: 'MATCH (:Thing) |> LIMIT 1', bounded: true },
      attempts: [],
    },
  ],
  next_actions: [],
  error: null,
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

describe('Atlas natural-language client', () => {
  it('normalizes text and rejects request fields outside the live contract', () => {
    expect(createNaturalLanguageQueryRequest('  find things  ')).toEqual({ text: 'find things', execute: true })
    expect(() => NATURAL_LANGUAGE_QUERY_REQUEST_SCHEMA.parse({ text: 'find things' })).toThrow()
    expect(() =>
      NATURAL_LANGUAGE_QUERY_REQUEST_SCHEMA.parse({ text: 'find things', dialect: 'uql', execute: true }),
    ).toThrow()
    expect(() => createNaturalLanguageQueryRequest('   ')).toThrow()
  })

  it('executes through the governed route and returns response provenance', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/api/graph/nl-query')
      expect(JSON.parse(String(init?.body))).toEqual({ text: 'find things', execute: true })
      return Promise.resolve(jsonResponse({ status: 'success', result: evidenceBundle }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeNaturalLanguageQuery('find things')
    expect(result.ok).toBe(true)
    expect(result.data?.claims).toHaveLength(1)
    expect(result.provenance.endpoint).toBe('/api/graph/nl-query')
    expect(result.provenance.request).toEqual({ text: 'find things', execute: true })
    expect(result.provenance.response).toEqual({
      claimCount: 1,
      evidenceSpanCount: 1,
      traceStepCount: 1,
      sourceAuthority: { graph: '__commons__' },
    })
  })

  it('uses an explicit compile preview request and records the caller operation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toEqual({ text: 'compile this', execute: false })
        return Promise.resolve(jsonResponse({ status: 'success', result: evidenceBundle }))
      }),
    )

    const result = await compileNaturalLanguageQuery('compile this')
    expect(result.ok).toBe(true)
    expect(result.provenance.operation).toBe('compile')
    expect(result.provenance.request).toEqual({ text: 'compile this', execute: false })
  })

  it('marks typed bundle errors as failed while preserving partial evidence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            status: 'success',
            result: { ...evidenceBundle, error: { code: 'query_failed', message: 'execution failed' } },
          }),
        ),
      ),
    )

    const result = await executeNaturalLanguageQuery('find things')
    expect(result.ok).toBe(false)
    expect(result.partial).toBe(true)
    expect(result.data?.claims).toHaveLength(1)
    expect(result.error).toContain('execution failed')
  })

  it('returns a shape error instead of treating a flat result as empty evidence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            status: 'success',
            result: { answer_candidate: 'stale', claims: [], reasoning_trace: [], results: [] },
          }),
        ),
      ),
    )

    const result = await executeNaturalLanguageQuery('find things')
    expect(result.ok).toBe(false)
    expect(result.data).toBeNull()
    expect(result.error).toMatch(/API shape violation/)
  })
})
