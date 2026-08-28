/**
 * @file identifiers.ts
 * @description SQL identifier/literal safety helpers for the table explorer.
 *
 * `catalog-api.ts` builds SQL text client-side for the two panes that have no
 * dedicated introspection route (`ColumnDetailPanel`'s stats pass, `TryItPanel`'s
 * query box) — `POST /graph/table {action:'query'}` takes one opaque `sql` string,
 * with no parameter binding (`agent_utilities/mcp/tools/query_tools.py`'s
 * `_graph_table_query` calls `engine.sql(str(sql))` directly). Every identifier
 * (schema/table/column name) interpolated into that string MUST come from a prior
 * trusted catalog response (`/graph/sql-schema`), never from free-form user input,
 * and MUST pass {@link isSafeIdentifier} first as defence in depth. Free-form user
 * text (the "try it" search box) can only ever enter as a quoted SQL string literal,
 * escaped with {@link escapeSqlLiteral} — never as an identifier position.
 */

const SAFE_IDENTIFIER_RE = /^[A-Za-z0-9_]+$/

/** True for a plain `[A-Za-z0-9_]+` token — the only shape this module will quote. */
export function isSafeIdentifier(value: string): boolean {
  return SAFE_IDENTIFIER_RE.test(value)
}

/** Double-quote a validated identifier for interpolation into SQL text. Throws on
 * anything {@link isSafeIdentifier} rejects — callers must not catch this and fall
 * back to interpolating the raw value. */
export function quoteIdentifier(value: string): string {
  if (!isSafeIdentifier(value)) {
    throw new Error(`refusing to quote unsafe SQL identifier: ${JSON.stringify(value)}`)
  }
  return `"${value}"`
}

/** `schema.table` as a double-quoted, dot-joined SQL relation reference. */
export function quoteRelation(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
}

/** Escape a free-form string for use as a single-quoted SQL literal. Doubles embedded
 * single quotes (the standard SQL escape) and strips NUL bytes, which no SQL text
 * protocol here can carry safely. This is a best-effort mitigation for a backend that
 * has no parameter binding on this path — see the module doc — not a substitute for
 * one; the real fix is a parameterized `graph_table` query action upstream. */
export function escapeSqlLiteral(value: string): string {
  return value.split('\u0000').join('').replace(/'/g, "''")
}

/** `'<escaped>'` — a ready-to-interpolate quoted SQL string literal. */
export function quoteLiteral(value: string): string {
  return `'${escapeSqlLiteral(value)}'`
}
