/**
 * @file query.ts
 * @description Runs one panel query (WEBUI-DASH-R004). The query goes through the
 * Atlas UQL adapter, which posts to the governed graph query route served by arbora.
 * The browser never contacts a source. Unsafe text is refused before sending.
 */
import uqlAdapter, { parseUql } from '@/lib/atlas/adapters/uql'
import { DEFAULT_ATLAS_CONTEXT } from '@/lib/atlas/types'
import type { Param, Panel } from './model'
import { atlasGet } from '@/lib/atlas/transport'
import { resolveQuery } from './params'

export type Cell = string | number | boolean | null

export interface RowSet {
  columns: string[]
  rows: Record<string, Cell>[]
}

export type QueryOutcome =
  { state: 'ok'; data: RowSet } | { state: 'empty'; note: string } | { state: 'error'; error: string }

export const PANEL_ROW_LIMIT = 500

function cell(value: unknown): Cell {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return JSON.stringify(value).slice(0, 200)
}

export async function runPanelQuery(
  panel: Pick<Panel, 'query'>,
  params: readonly Param[],
  signal: AbortSignal,
): Promise<QueryOutcome> {
  try {
    const text = resolveQuery(panel.query.text, params)
    const ctx = { ...DEFAULT_ATLAS_CONTEXT, limit: PANEL_ROW_LIMIT }
    const query = parseUql({ text, ctx })
    const result = await uqlAdapter.execute({ query, ctx, signal })
    if (result.degraded !== null && result.payload.rows.length === 0) {
      return { state: 'error', error: result.degraded }
    }
    const rows = result.payload.rows.map((row) =>
      Object.fromEntries(Object.entries(row).map(([key, value]) => [key, cell(value)])),
    )
    if (rows.length === 0) return { state: 'empty', note: 'The query returned no rows.' }
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
    return { state: 'ok', data: { columns, rows } }
  } catch (error) {
    return { state: 'error', error: error instanceof Error ? error.message : 'The query failed.' }
  }
}

const NODE_TYPES_ROUTE = '/api/enhanced/graph/node-types'

/** The graph node types a panel query can read, most common first. Reads through arbora. */
export async function listNodeTypes(signal: AbortSignal): Promise<{ name: string; count: number }[]> {
  const response = await atlasGet<{ by_type?: Record<string, number> }>(NODE_TYPES_ROUTE, signal)
  const byType = response.ok ? response.data?.by_type : undefined
  if (!byType) throw new Error('node types unavailable')
  return Object.entries(byType)
    .filter(([, count]) => Number.isFinite(count))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }))
}
