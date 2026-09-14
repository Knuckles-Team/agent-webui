import {
  getRoutePageMetadata,
  NOT_FOUND_ROUTE,
  ROUTE_REGISTRY,
  type RouteDef,
  type RoutePageMetadata,
} from '@/lib/nav-registry'
import {
  absoluteSiteUrl,
  currentOrigin,
  getSiteConfig,
  isIndexableSiteConfigReady,
  type SiteConfig,
} from '@/lib/site-config'
import {
  NON_PAGE_PROTECTED_PATHS,
  concreteCanonicalPath,
  isPublicIndexableRoute,
  robotsDisallowPath,
} from '@/lib/route-metadata-seam.mjs'

export interface PageHeadProjection {
  title: string
  description: string
  canonicalUrl: string
  robots: string
  indexable: boolean
  openGraphImageUrl: string | null
  openGraphImageAlt: string | null
  webmcpPageId: string
}

function routePath(route: RouteDef, pathname?: string): string {
  if (route.path === '*') return '/404'
  if (pathname?.startsWith('/')) return pathname.split(/[?#]/, 1)[0] || '/'
  return route.path
}

function configuredOrigin(config: SiteConfig): string {
  return config.canonicalOrigin ?? currentOrigin()
}

function projectOpenGraphImage(
  metadata: RoutePageMetadata,
  config: SiteConfig,
  indexable: boolean,
): Pick<PageHeadProjection, 'openGraphImageUrl' | 'openGraphImageAlt'> {
  const imagePath = metadata.visibility === 'public' && indexable ? config.openGraphImagePath : null
  return {
    openGraphImageUrl: imagePath ? absoluteSiteUrl(imagePath, configuredOrigin(config)) : null,
    openGraphImageAlt: imagePath ? `${config.siteName} preview` : null,
  }
}

/** Project one registry entry into document-safe metadata. */
export function projectPageHead(
  route: RouteDef = NOT_FOUND_ROUTE,
  pathname?: string,
  config: SiteConfig = getSiteConfig(),
): PageHeadProjection {
  const metadata = getRoutePageMetadata(route)
  const path = routePath(route, pathname)
  const canonicalPath = metadata.canonicalPath ?? path
  const indexable = metadata.indexable && isIndexableSiteConfigReady(config)
  return {
    title: metadata.title,
    description: metadata.description,
    canonicalUrl: absoluteSiteUrl(canonicalPath, configuredOrigin(config)),
    robots: indexable ? 'index,follow' : 'noindex,nofollow',
    indexable,
    ...projectOpenGraphImage(metadata, config, indexable),
    webmcpPageId: metadata.webmcpPageId,
  }
}

export function publicIndexableRoutes(
  config: SiteConfig = getSiteConfig(),
): readonly { route: RouteDef; metadata: RoutePageMetadata }[] {
  if (!isIndexableSiteConfigReady(config)) return []
  return ROUTE_REGISTRY.filter((route) => {
    const metadata = getRoutePageMetadata(route)
    return isPublicIndexableRoute({ ...metadata, path: route.path })
  }).map((route) => ({ route, metadata: getRoutePageMetadata(route) }))
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (character) => {
    const entities: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }
    return entities[character] ?? character
  })
}

function routeDisallowPaths(): Set<string> {
  const disallowPaths = new Set(NON_PAGE_PROTECTED_PATHS)
  for (const route of ROUTE_REGISTRY) {
    const metadata = getRoutePageMetadata(route)
    if (isPublicIndexableRoute({ ...metadata, path: route.path })) continue
    const path = robotsDisallowPath({ ...metadata, path: route.path })
    if (path && path !== '/') disallowPaths.add(path)
  }
  return disallowPaths
}

function robotsSitemapLine(indexable: boolean, origin: string): string {
  return indexable ? `Sitemap: ${absoluteSiteUrl('/sitemap.xml', origin)}` : ''
}

/** Generate an environment-safe sitemap from the same route registry. */
export function buildSitemapXml(origin = currentOrigin(), config: SiteConfig = getSiteConfig()): string {
  const sitemapOrigin = config.canonicalOrigin ?? origin
  const urls = publicIndexableRoutes(config)
    .map(({ route, metadata }) => {
      const path = concreteCanonicalPath({ ...metadata, path: route.path }) ?? route.path
      return `  <url><loc>${escapeXml(absoluteSiteUrl(path, sitemapOrigin))}</loc></url>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

/** Generate robots policy without ever advertising a non-canonical local host. */
export function buildRobotsTxt(
  options: { indexableEnvironment?: boolean; origin?: string; config?: SiteConfig } = {},
): string {
  const config = options.config ?? getSiteConfig()
  const indexableConfig =
    options.indexableEnvironment === undefined
      ? config
      : { ...config, indexableEnvironment: options.indexableEnvironment }
  const indexable = isIndexableSiteConfigReady(indexableConfig)
  const origin = config.canonicalOrigin ?? options.origin ?? currentOrigin()
  return [
    'User-agent: *',
    ...(indexable ? ['Allow: /'] : []),
    ...[...routeDisallowPaths()].map((path) => `Disallow: ${path}`),
    robotsSitemapLine(indexable, origin),
    '',
  ]
    .filter((line) => line.length > 0)
    .join('\n')
    .concat('\n')
}
