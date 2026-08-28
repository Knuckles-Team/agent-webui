import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildBm25SearchSql, buildVectorSearchSql, fetchSchemaTree, rrfFuse, runCatalogQuery } from '../catalog-api'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildVectorSearchSql', () => {
  it('builds a cosine-distance ORDER BY using eg_embed over a validated relation/column', () => {
    const sql = buildVectorSearchSql({
      relation: { schema: 'public', table: 'widgets' },
      column: 'title',
      queryText: 'leak',
    })
    expect(sql).toContain('FROM "public"."widgets"')
    expect(sql).toContain('"title" <=> eg_embed(\'leak\')')
    expect(sql).toContain('ORDER BY distance LIMIT 10')
  })

  it('escapes a single quote in the search text so it cannot break out of the literal', () => {
    const sql = buildVectorSearchSql({
      relation: { schema: 'public', table: 'widgets' },
      column: 'title',
      queryText: "o'brien",
    })
    expect(sql).toContain("eg_embed('o''brien')")
  })

  it('bounds the limit to [1, 50]', () => {
    const sql = buildVectorSearchSql({
      relation: { schema: 'public', table: 'widgets' },
      column: 'title',
      queryText: 'x',
      limit: 9999,
    })
    expect(sql).toContain('LIMIT 50')
  })
})

describe('buildBm25SearchSql', () => {
  it('builds the confirmed 2-arg bm25_score(doc, query) form', () => {
    const sql = buildBm25SearchSql({
      relation: { schema: 'public', table: 'widgets' },
      column: 'title',
      queryText: 'leak',
    })
    expect(sql).toContain('bm25_score("title", \'leak\')')
    expect(sql).toContain('ORDER BY score DESC LIMIT 10')
  })
})

describe('rrfFuse', () => {
  it('ranks a row appearing in both legs above one appearing in only one', () => {
    const vectorRows = [{ id: 'a' }, { id: 'b' }]
    const bm25Rows = [{ id: 'b' }, { id: 'c' }]
    const fused = rrfFuse({ vectorRows, bm25Rows, pkColumn: 'id' })
    expect(fused[0].row).toEqual({ id: 'b' })
    expect(fused[0].inVector).toBe(true)
    expect(fused[0].inBm25).toBe(true)
    expect(fused.map((h) => h.row.id)).toEqual(['b', 'a', 'c'])
  })

  it('falls back to a row-shape identity when no PK column is known', () => {
    const vectorRows = [{ title: 'x', distance: 0.1 }]
    const bm25Rows = [{ title: 'x', score: 9 }]
    const fused = rrfFuse({ vectorRows, bm25Rows, pkColumn: null })
    expect(fused).toHaveLength(1)
    expect(fused[0].inVector).toBe(true)
    expect(fused[0].inBm25).toBe(true)
  })
})

describe('fetchSchemaTree', () => {
  it('adapts a successful /graph/sql-schema response into camelCase SchemaTreeData', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          status: 'success',
          result: {
            catalogs: [
              {
                catalog: 'eg',
                schemas: [
                  {
                    schema: 'public',
                    tables: [
                      {
                        catalog: 'eg',
                        schema: 'public',
                        name: 'widgets',
                        kind: 'table',
                        table_type: 'BASE TABLE',
                        columns: [{ name: 'id', position: 1, data_type: 'text', nullable: false, primary_key: true }],
                      },
                    ],
                  },
                ],
              },
            ],
            capabilities: { primary_keys: true, nullability: false },
            counts: { catalogs: 1, schemas: 1, tables: 1, columns: 1 },
          },
        }),
      ),
    ) as unknown as typeof fetch

    const r = await fetchSchemaTree()
    expect(r.ok).toBe(true)
    expect(r.data?.catalogs[0].schemas[0].tables[0].columns[0].primaryKey).toBe(true)
    expect(r.data?.counts.tables).toBe(1)
  })

  it('reports unavailable, not an error, on a 404', async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({}, 404))) as unknown as typeof fetch
    const r = await fetchSchemaTree()
    expect(r.ok).toBe(false)
    expect(r.unavailable).toBe(true)
  })
})

describe('runCatalogQuery', () => {
  it('unwraps the {status, result} envelope into a bare row array', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ status: 'success', result: [{ a: 1 }] })),
    ) as unknown as typeof fetch
    const r = await runCatalogQuery('SELECT 1')
    expect(r.ok).toBe(true)
    expect(r.data).toEqual([{ a: 1 }])
  })
})
