/**
 * @file text.ts
 * @description One display-text coercion, used everywhere Atlas has to show an
 * `unknown` to a person.
 *
 * A bare `String(value)` on an `unknown` renders `[object Object]` — a cell that looks
 * populated and says nothing. This is the single place that decides what a value looks
 * like, so the table, the JSON tree, the inspector, the filter evaluator and the
 * SPARQL literal escaper cannot drift apart on it.
 */

/**
 * The four top-level inputs `JSON.stringify` answers `undefined` for. Screening them
 * here is what lets the callers below treat its result as a string without a fallback
 * branch that a reader (or a linter) would be right to call unreachable.
 */
function isUnserializable(value: unknown): boolean {
  return value === undefined || typeof value === 'function' || typeof value === 'symbol'
}

/** A value as text: strings verbatim, primitives stringified, everything else as JSON. */
export function toDisplayText(value: unknown): string {
  if (value === null || isUnserializable(value)) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    // A circular structure, or a `toJSON` that throws.
    return '[unserializable]'
  }
}

/** Pretty-printed JSON for the raw payload view, or a stated failure. */
export function toPrettyJson(value: unknown): string {
  if (value === null || isUnserializable(value)) return toDisplayText(value)
  try {
    return JSON.stringify(value, null, 2)
  } catch (error) {
    return `Payload could not be serialized: ${toDisplayText(error)}`
  }
}
