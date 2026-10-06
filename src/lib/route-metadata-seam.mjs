/**
 * Dependency-free route metadata rules shared by runtime projections and the
 * static robots/sitemap bridge. Route declarations remain in nav-registry.ts;
 * this module only defines how their scalar metadata is projected.
 */

/** @typedef {import('./route-metadata-seam.d.mts').RouteMetadataScalar} RouteMetadataScalar */

/** @type {readonly string[]} */
export const NON_PAGE_PROTECTED_PATHS = Object.freeze(['/api/'])

/**
 * @param {RouteMetadataScalar} route
 * @returns {string | undefined}
 */
export function concreteCanonicalPath(route) {
  return route.canonicalPath ?? (route.path.includes(':') || route.path === '*' ? undefined : route.path)
}

/**
 * @param {RouteMetadataScalar} route
 * @returns {boolean}
 */
export function isPublicIndexableRoute(route) {
  return route.visibility === 'public' && route.indexable === true && concreteCanonicalPath(route) !== undefined
}

/**
 * Convert a dynamic private route declaration into a conservative robots path.
 * @param {RouteMetadataScalar} route
 * @returns {string | undefined}
 */
export function robotsDisallowPath(route) {
  const path = concreteCanonicalPath(route)
  if (path) return path
  if (route.path === '*' || !route.path.startsWith('/')) return undefined
  const dynamicSegment = route.path.search(/[:*]/)
  if (dynamicSegment < 0) return route.path
  const prefix = route.path.slice(0, dynamicSegment).replace(/\/+$/, '')
  return prefix ? `${prefix}/` : '/'
}
