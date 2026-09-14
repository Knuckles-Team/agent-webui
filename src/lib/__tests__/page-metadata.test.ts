import { describe, expect, it } from 'vitest'
import { matchRoute, NOT_FOUND_ROUTE, ROUTES, getRoutePageMetadata, routeById } from '@/lib/nav-registry'
import { buildRobotsTxt, buildSitemapXml, projectPageHead, publicIndexableRoutes } from '@/lib/page-metadata'
import { isIndexableSiteConfigReady, validateSiteConfig, type SiteConfig } from '@/lib/site-config'

const COMPLETE_CONFIG: SiteConfig = {
  siteName: 'Configured Agent WebUI',
  canonicalOrigin: 'https://agents.example.invalid',
  indexableEnvironment: true,
  openGraphImagePath: '/og/agent-webui-v1.png',
  legalOwner: 'Configured Owner',
  contactAddress: '1 Reviewed Way\nExample City',
  contactEmail: 'owner@example.invalid',
  legalEffectiveDate: '2026-09-14',
  legalRevision: 'privacy-terms-1',
  privacyPolicyText: 'Reviewed privacy policy.',
  termsText: 'Reviewed terms.',
  analytics: null,
}

describe('page metadata authority', () => {
  it('matches public pages through the same registry used by WebMCP navigation', () => {
    expect(matchRoute('/privacy')?.route.id).toBe('public.privacy')
    expect(routeById('public.contact')?.path).toBe('/contact')
    expect(ROUTES.some((route) => route.path === '/privacy')).toBe(false)
  })

  it('defaults application routes to private noindex metadata', () => {
    const route = ROUTES.find((candidate) => candidate.id === 'knowledge.graph')
    expect(route).toBeDefined()
    expect(getRoutePageMetadata(route!).visibility).toBe('private')
    expect(getRoutePageMetadata(route!).indexable).toBe(false)
    expect(projectPageHead(route!).robots).toBe('noindex,nofollow')
  })

  it('projects unknown routes to a deterministic custom 404 without indexability', () => {
    const projection = projectPageHead(NOT_FOUND_ROUTE, '/missing')
    expect(projection.title).toContain('Page not found')
    expect(projection.canonicalUrl).toContain('/404')
    expect(projection.robots).toBe('noindex,nofollow')
    expect(projection.openGraphImageUrl).toBeNull()
  })

  it('builds sitemap and robots output from public canonical descriptors only', () => {
    const sitemap = buildSitemapXml('https://agents.example.invalid', COMPLETE_CONFIG)
    expect(sitemap).toContain('https://agents.example.invalid/privacy')
    expect(sitemap).toContain('https://agents.example.invalid/terms')
    expect(sitemap).toContain('https://agents.example.invalid/contact')
    expect(sitemap).not.toContain('/thank-you')
    expect(sitemap).not.toContain('/graph')

    const robots = buildRobotsTxt({
      indexableEnvironment: true,
      origin: 'https://agents.example.invalid',
      config: COMPLETE_CONFIG,
    })
    expect(robots).toContain('Disallow: /api/')
    expect(robots).toContain('Sitemap: https://agents.example.invalid/sitemap.xml')
  })

  it('keeps public pages noindex unless the deployment explicitly opts in with HTTPS', () => {
    const route = routeById('public.privacy')
    expect(route).toBeDefined()
    expect(projectPageHead(route!, '/privacy', { ...COMPLETE_CONFIG, indexableEnvironment: false }).robots).toBe(
      'noindex,nofollow',
    )
    expect(
      projectPageHead(route!, '/privacy', { ...COMPLETE_CONFIG, canonicalOrigin: 'http://agents.example.invalid' })
        .robots,
    ).toBe('noindex,nofollow')
    expect(projectPageHead(route!, '/privacy', COMPLETE_CONFIG).robots).toBe('index,follow')
  })

  it('fails release validation when legal identity is absent and accepts reviewed configuration', () => {
    const incomplete = validateSiteConfig({ ...COMPLETE_CONFIG, legalOwner: null, contactAddress: null })
    expect(incomplete.valid).toBe(false)
    expect(incomplete.errors.join('\n')).toContain('VITE_LEGAL_OWNER')
    expect(validateSiteConfig(COMPLETE_CONFIG).valid).toBe(true)
  })

  it('keeps runtime indexability disabled until legal release configuration is complete', () => {
    const incomplete = {
      ...COMPLETE_CONFIG,
      legalOwner: null,
      contactAddress: null,
      privacyPolicyText: null,
      termsText: null,
    }
    expect(isIndexableSiteConfigReady(incomplete)).toBe(false)
    const route = routeById('public.privacy')
    expect(route).toBeDefined()
    expect(projectPageHead(route!, '/privacy', incomplete).robots).toBe('noindex,nofollow')
    expect(publicIndexableRoutes(incomplete)).toHaveLength(0)
    const robots = buildRobotsTxt({
      indexableEnvironment: true,
      origin: COMPLETE_CONFIG.canonicalOrigin!,
      config: incomplete,
    })
    expect(robots).not.toContain('Sitemap:')
  })
})
