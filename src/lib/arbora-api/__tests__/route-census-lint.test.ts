// spec: OVERSTORY-API-R003.2
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  extractDomainRoutes,
  lintRouteCensus,
  RouteCensusLintError,
  type RouteCensusEntry,
} from '@/lib/arbora-api/route-census'

const source = readFileSync('agent/agent_webui/api_extensions.py', 'utf8')
const census = JSON.parse(readFileSync('src/lib/arbora-api/route-census.json', 'utf8')) as RouteCensusEntry[]

describe('route census architecture lint', () => {
  it('covers every current enhanced host route with a validated row', () => {
    const routes = extractDomainRoutes(source)
    const entries = lintRouteCensus(source, census)

    expect(routes).toHaveLength(179)
    expect(entries).toHaveLength(routes.length)
  })

  it('rejects a newly introduced domain route until it is inventoried', () => {
    const syntheticSource = `${source}\n@router.get('/new-unclassified-domain-route')\nasync def synthetic_route():\n    return None\n`

    expect(() => lintRouteCensus(syntheticSource, census)).toThrow(RouteCensusLintError)
    expect(() => lintRouteCensus(syntheticSource, census)).toThrow(
      'missing census entry for GET /api/enhanced/new-unclassified-domain-route',
    )
  })

  it('accepts a newly declared route only after an explicit disposition is added', () => {
    const syntheticSource = `${source}\n@router.get('/explicit-ui-local-route')\nasync def synthetic_route():\n    return None\n`
    const declared: RouteCensusEntry = {
      route: 'GET /api/enhanced/explicit-ui-local-route',
      disposition: 'ui-local',
      owning_operation: null,
      caller: 'synthetic fixture',
      scope: 'browser-local fixture route',
      effect_class: 'read',
      migration_state: 'browser-local',
    }

    expect(() => lintRouteCensus(syntheticSource, [...census, declared])).not.toThrow()
  })

  it('rejects a census row that omits migration metadata', () => {
    const incomplete = census.map((entry, index) => {
      if (index !== 0) return entry
      const { effect_class: _effectClass, ...withoutEffect } = entry
      return withoutEffect
    })

    expect(() => lintRouteCensus(source, incomplete)).toThrow('must declare effect_class')
  })

  it('records real protocol and UI-local ownership while domain routes await cutover', () => {
    const entries = lintRouteCensus(source, census)
    const byRoute = new Map(entries.map((entry) => [entry.route, entry]))

    expect(new Set(entries.map((entry) => entry.disposition))).toEqual(
      new Set(['ui-local', 'session-protocol', 'retire']),
    )
    expect(entries.every((entry) => entry.effect_class && entry.migration_state)).toBe(true)
    expect(byRoute.get('GET /api/enhanced/info')).toMatchObject({
      disposition: 'ui-local',
      caller: 'src/components/app-sidebar.tsx',
      migration_state: 'browser-local',
    })
    expect(byRoute.get('GET /api/enhanced/sessions')).toMatchObject({
      disposition: 'session-protocol',
      caller: expect.stringContaining('src/components/views/SessionsView.tsx'),
      scope: expect.stringContaining('preserve'),
    })
    expect(byRoute.get('POST /api/enhanced/mcp/tools/call')).toMatchObject({
      disposition: 'session-protocol',
      caller: expect.stringContaining('src/lib/mcp-client.ts'),
      effect_class: 'write',
    })
    expect(byRoute.get('POST /api/enhanced/mcp/servers')).toMatchObject({
      disposition: 'retire',
      migration_state: 'legacy-host',
    })
  })
})
