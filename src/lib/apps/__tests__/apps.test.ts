import { describe, expect, it } from 'vitest'
import { APP_SURFACES } from '@/apps/surfaces'
import { matchRoute, routesBySection, SECTIONS } from '@/lib/nav-registry'
import { capabilityVisible } from '../catalog'
import { surfaceProblems } from '../contract'
import { pathParam } from '../location'

describe('AppSurface contract', () => {
  it('every hosted app satisfies the contract', () => {
    for (const surface of APP_SURFACES) expect(surfaceProblems(surface), surface.id).toEqual([])
  })

  it('places app routes in the one registry under the Apps section', () => {
    expect(SECTIONS.map((section) => section.id)).toContain('apps')
    expect(routesBySection('apps').map((route) => route.id)).toEqual(['apps.markets'])
    expect(matchRoute('/apps/markets/chart/listing%3Abinance%3ASOLUSDT%3Aspot')?.params).toEqual({
      listing: 'listing:binance:SOLUSDT:spot',
    })
    expect(matchRoute('/apps/markets/share/share-abc')?.route.id).toBe('apps.markets.share')
  })

  it('hides a capability-gated route until the host reports it available', () => {
    const none = { loading: false, available: new Set<string>(), reasons: new Map<string, string>() }
    expect(capabilityVisible('app:markets', none)).toBe(false)
    expect(capabilityVisible(undefined, none)).toBe(true)
    expect(capabilityVisible('app:markets', { ...none, available: new Set(['app:markets']) })).toBe(true)
  })

  it('reads one path param and refuses nested or malformed ones', () => {
    expect(pathParam('/apps/markets/share/share-1', '/apps/markets/share')).toBe('share-1')
    expect(pathParam('/apps/markets/share/a/b', '/apps/markets/share')).toBeNull()
    expect(pathParam('/apps/markets/share/%E0%A4%A', '/apps/markets/share')).toBeNull()
  })
})
