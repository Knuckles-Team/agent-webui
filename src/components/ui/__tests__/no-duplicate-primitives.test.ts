import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const UI_DIR = resolve(import.meta.dirname, '..')
const ROOT = resolve(import.meta.dirname, '../../../..')

/** Primitive component files only; tests and non-component helpers are excluded. */
function primitiveFiles(): string[] {
  return readdirSync(UI_DIR)
    .filter((name) => name.endsWith('.tsx'))
    .sort()
}

/** Capitalized identifiers named by an `export { ... }` block or an inline `export function|const Name`. */
function exportedComponentNames(source: string): string[] {
  const names = new Set<string>()
  const blockMatches = source.matchAll(/export\s*\{([^}]*)\}/g)
  for (const match of blockMatches) {
    for (const rawName of match[1].split(',')) {
      const name = rawName
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim()
      if (name && /^[A-Z]/.test(name)) names.add(name)
    }
  }
  const inlineMatches = source.matchAll(/export\s+(?:function|const)\s+([A-Z][A-Za-z0-9]*)/g)
  for (const match of inlineMatches) names.add(match[1])
  return [...names]
}

describe('design-system primitive inventory (DS-06)', () => {
  it('names every exported primitive exactly once across src/components/ui', () => {
    const owners = new Map<string, string[]>()
    for (const file of primitiveFiles()) {
      const source = readFileSync(resolve(UI_DIR, file), 'utf8')
      for (const name of exportedComponentNames(source)) {
        owners.set(name, [...(owners.get(name) ?? []), file])
      }
    }
    const duplicates = [...owners.entries()].filter(([, files]) => files.length > 1)
    expect(duplicates, `duplicate primitive export(s): ${JSON.stringify(duplicates)}`).toHaveLength(0)
    expect(owners.size).toBeGreaterThan(0)
  })

  it('adds no telemetry, analytics or session-replay dependency', () => {
    const packageJson = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const allDeps = Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies })
    const telemetryPattern =
      /sentry|posthog|mixpanel|segment|amplitude|datadog|logrocket|fullstory|hotjar|^heap$|google-analytics|react-ga|vercel\/analytics|clarity|pendo|hubspot/i
    const matches = allDeps.filter((name) => telemetryPattern.test(name))
    expect(matches, `unsolicited telemetry dependency: ${JSON.stringify(matches)}`).toHaveLength(0)
  })
})
