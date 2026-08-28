/**
 * @file sql-adapter.test.ts
 * @description Tests for `src/lib/atlas/adapters/sql.ts` — the SQL/catalog Atlas
 * modality adapter this lane owns. Colocated under `table-explorer/__tests__/` (this
 * lane's owned directory) rather than `src/lib/atlas/adapters/__tests__/`, since
 * `src/lib/atlas/` beyond the one `adapters/sql.ts` file belongs to sibling lane
 * WD10-A-CORE — see `sql.ts`'s module doc for why this file only type-checks once
 * A-CORE's core Atlas files land on `main`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import sqlAdapter, { compileSql } from '@/lib/atlas/adapters/sql'
import { DEFAULT_ATLAS_CONTEXT, EMPTY_FILTER_SET, type FilterSet } from '@/lib/atlas/types'

const ctx = DEFAULT_ATLAS_CONTEXT
const signal = new AbortController().signal

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

function stubFetch(handler: (url: string) => Response): void {
  global.fetch = vi.fn((input: RequestInfo | URL) => Promise.resolve(handler(String(input)))) as typeof fetch
}

const schemaBody = {
  status: 'success',
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
              columns: [
                { name: 'id', position: 1, data_type: 'text', udt_name: 'text', nullable: false, primary_key: true },
                {
                  name: 'owner_id',
                  position: 2,
                  data_type: 'text',
                  udt_name: 'text',
                  nullable: true,
                  primary_key: null,
                },
                { name: 'title', position: 3, data_type: 'text', udt_name: 'text', nullable: true, primary_key: null },
              ],
            },
          ],
        },
      ],
    },
  ],
  capabilities: { primary_keys: true, nullability: false },
  counts: { catalogs: 1, schemas: 1, tables: 1, columns: 3 },
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('capability declarations are structurally honest', () => {
  it('promises only what it implements', () => {
    const capabilities = sqlAdapter.capabilities()
    expect(capabilities.graphProjection).toBe(sqlAdapter.toGraph !== undefined)
    expect(capabilities.rawQuery).toBe(sqlAdapter.parse !== undefined)
    expect(capabilities.pivots).toBe(sqlAdapter.pivots !== undefined)
    expect(capabilities.live).toBe(sqlAdapter.live !== undefined)
    expect(capabilities.filters.length).toBeGreaterThan(0)
  })
})

describe('compileSql', () => {
  it('builds a catalog-listing SELECT with no filters', () => {
    const query = compileSql({ filters: EMPTY_FILTER_SET, ctx })
    expect(query.text).toContain('FROM information_schema.tables')
    expect(query.text).not.toContain('WHERE')
    expect(query.text).toContain('ORDER BY table_schema, table_name')
  })

  it('pushes an eq clause down into WHERE, safely quoted', () => {
    const filters: FilterSet = {
      ...EMPTY_FILTER_SET,
      clauses: [{ id: 'c1', field: 'table_schema', op: 'eq', value: "o'brien" }],
    }
    const query = compileSql({ filters, ctx })
    expect(query.text).toContain("table_schema = 'o''brien'")
  })

  it('pushes free-text search into an ILIKE fragment across table_name/table_schema', () => {
    const filters: FilterSet = { ...EMPTY_FILTER_SET, search: 'widget' }
    const query = compileSql({ filters, ctx })
    expect(query.text).toContain('table_name ILIKE')
    expect(query.text).toContain("'widget'")
  })

  it('ignores a clause on a field the catalog-listing query does not recognize', () => {
    const filters: FilterSet = {
      ...EMPTY_FILTER_SET,
      clauses: [{ id: 'c1', field: 'col:owner_id', op: 'eq', value: '1' }],
    }
    const query = compileSql({ filters, ctx })
    expect(query.text).not.toContain('owner_id')
  })
})

describe('introspect', () => {
  it('shapes the /graph/sql-schema response into a schema/table/column tree with a seedQuery', () => {
    stubFetch(() => jsonResponse({ status: 'success', result: schemaBody }))
    return sqlAdapter.introspect({ ctx, signal }).then((tree) => {
      expect(tree.unavailable).toBe(false)
      const schema = tree.roots[0]
      expect(schema.label).toBe('public')
      const table = schema.children?.[0]
      expect(table?.label).toBe('public.widgets')
      expect(table?.seedQuery).toBe('SELECT * FROM "public"."widgets" LIMIT 500')
      expect(table?.children?.map((c) => c.label)).toEqual(['id', 'owner_id', 'title'])
    })
  })

  it('degrades to unavailable, not an error, when the route 404s', () => {
    stubFetch(() => jsonResponse({}, 404))
    return sqlAdapter.introspect({ ctx, signal }).then((tree) => {
      expect(tree.unavailable).toBe(true)
      expect(tree.roots).toEqual([])
    })
  })
})

describe('execute', () => {
  it('runs a SELECT through /graph/table {action:query} and shapes rows', () => {
    stubFetch(() => jsonResponse({ status: 'success', result: [{ id: '1', owner_id: '2', title: 'a' }] }))
    return sqlAdapter.execute({ query: { text: 'SELECT * FROM widgets' }, ctx, signal }).then((result) => {
      expect(result.shape).toBe('rows')
      expect(result.payload).toHaveLength(1)
      expect(result.degraded).toBeNull()
    })
  })

  it('refuses a non-read-only statement client-side before ever calling fetch', () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as unknown as typeof fetch
    return sqlAdapter.execute({ query: { text: 'DELETE FROM widgets' }, ctx, signal }).then((result) => {
      expect(result.shape).toBe('empty')
      expect(result.degraded).toMatch(/SELECT/)
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  it('degrades honestly when the query route errors', () => {
    stubFetch(() => jsonResponse({}, 500))
    return sqlAdapter.execute({ query: { text: 'SELECT 1' }, ctx, signal }).then((result) => {
      expect(result.shape).toBe('empty')
      expect(result.degraded).not.toBeNull()
    })
  })
})

describe('toRows / toGraph', () => {
  const rows = [
    { id: '1', owner_id: '9', title: 'a' },
    { id: '2', owner_id: '9', title: 'b' },
    { id: '9', owner_id: null, title: 'owner' },
  ]
  const result = {
    adapterId: 'sql',
    shape: 'rows' as const,
    payload: rows,
    stats: { elapsedMs: 1, rowCount: rows.length, truncated: false },
    degraded: null,
    sources: [],
  }

  it('toRows infers columns from the first row', () => {
    const rowSet = sqlAdapter.toRows(result)
    expect(rowSet.columns.map((c) => c.key)).toEqual(['id', 'owner_id', 'title'])
    expect(rowSet.rows).toHaveLength(3)
  })

  it('toGraph projects rows as nodes and links "*_id" columns to matching row keys', () => {
    const projection = sqlAdapter.toGraph?.(result)
    expect(projection?.nodes).toHaveLength(3)
    expect(projection?.edges.some((e) => e.source === '1' && e.target === '9' && e.type === 'owner_id')).toBe(true)
  })
})

describe('pivots', () => {
  it('offers a same-adapter refinement for a recognized catalog-listing field', () => {
    const offers = sqlAdapter.pivots?.({
      selection: { kind: 'row', id: 'r1', label: 'public', type: 'table_schema', data: { table_schema: 'public' } },
      result: {
        adapterId: 'sql',
        shape: 'rows',
        payload: [],
        stats: { elapsedMs: 1, rowCount: 0, truncated: false },
        degraded: null,
        sources: [],
      },
    })
    expect(offers?.[0]?.targetAdapterId).toBe('sql')
    expect(offers?.[0]?.filters.clauses[0]).toMatchObject({ field: 'table_schema', op: 'eq', value: 'public' })
  })

  it('offers nothing for an unrecognized field', () => {
    const offers = sqlAdapter.pivots?.({
      selection: { kind: 'cell', id: 'c1', label: 'x', type: 'col:owner_id', data: {} },
      result: {
        adapterId: 'sql',
        shape: 'rows',
        payload: [],
        stats: { elapsedMs: 1, rowCount: 0, truncated: false },
        degraded: null,
        sources: [],
      },
    })
    expect(offers).toEqual([])
  })
})
