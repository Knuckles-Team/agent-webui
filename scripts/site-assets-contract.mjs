/**
 * Shared policy for generated public site assets.
 *
 * The application route registry remains the authority. This module contains
 * only dependency-free URL/origin validation; route selection is projected
 * directly from that registry by site-route-registry.mjs.
 */

/** Return a reason when a route cannot be emitted into a public sitemap. */
export function routePathIssue(value, protectedPaths = []) {
  if (typeof value !== 'string' || !value.startsWith('/')) return 'must start with /'
  if (
    value.includes('?') ||
    value.includes('#') ||
    value.includes('\\') ||
    value.includes('//') ||
    value.includes('%')
  ) {
    return 'must not contain query, fragment, backslash, percent-encoded, or duplicate-slash segments'
  }
  if (value.includes(':') || value.includes('*') || value.includes('..')) {
    return 'must be a concrete public path, not a dynamic pattern'
  }
  const path = value === '/' ? '/' : `/${value.replace(/^\/+|\/+$/g, '')}`
  const sameOrDescendant = (candidate, base) => candidate === base || candidate.startsWith(`${base}/`)
  for (const protectedPath of protectedPaths) {
    if (typeof protectedPath !== 'string' || protectedPath === '/') continue
    const normalizedProtectedPath = `/${protectedPath.replace(/^\/+|\/+$/g, '')}`
    if (sameOrDescendant(path, normalizedProtectedPath) || sameOrDescendant(normalizedProtectedPath, path)) {
      return `collides with a registered private route: ${path}`
    }
  }
  return null
}

export function normalizePublicRoutePath(value, index) {
  const issue = routePathIssue(value)
  if (issue) throw new Error(`routes[${index}].path ${issue}`)
  return value === '/' ? '/' : `/${value.replace(/^\/+|\/+$/g, '')}`
}

export function canonicalOrigin(value) {
  if (!value) return null
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('SITE_CANONICAL_ORIGIN must be an absolute HTTPS origin')
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      'SITE_CANONICAL_ORIGIN must be an absolute HTTPS origin without credentials, path, query, or fragment',
    )
  }
  return parsed.origin.replace(/\/$/, '')
}

/** Local, versioned raster asset paths are bounded to the checked-in public tree. */
export function isVersionedLocalAssetPath(value) {
  return /^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+-v\d+\.(?:png|webp|avif)$/.test(value)
}
