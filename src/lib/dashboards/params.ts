/**
 * @file params.ts
 * @description Dashboard parameters (OVERSTORY-DASH-R013). A query may contain
 * `{{name}}` placeholders. Each resolves to a validated scalar: numbers print as
 * numbers and text prints as a quoted literal with no quote or control character,
 * so a parameter value can never change the shape of the query.
 */
import type { Param } from './model'

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g
const SAFE_TEXT = /^[\w .:@/-]{0,128}$/

export class ParamError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParamError'
  }
}

function literal(param: Param): string {
  if (param.type === 'number') {
    const value = Number(param.value)
    if (!Number.isFinite(value)) throw new ParamError(`parameter ${param.name} must be a number`)
    return String(value)
  }
  const text = String(param.value)
  if (!SAFE_TEXT.test(text)) throw new ParamError(`parameter ${param.name} holds unsupported characters`)
  return `"${text}"`
}

/** Placeholder names used by a query text. */
export function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))]
}

export function resolveQuery(text: string, params: readonly Param[]): string {
  const byName = new Map(params.map((p) => [p.name, p]))
  return text.replace(PLACEHOLDER, (_whole, name: string) => {
    const param = byName.get(name)
    if (!param) throw new ParamError(`unknown parameter ${name}`)
    return literal(param)
  })
}
