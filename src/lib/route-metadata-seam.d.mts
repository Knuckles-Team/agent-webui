export interface RouteMetadataScalar {
  path: string
  canonicalPath?: string
  visibility?: 'public' | 'private'
  indexable?: boolean
}

export const NON_PAGE_PROTECTED_PATHS: readonly string[]
export function concreteCanonicalPath(route: RouteMetadataScalar): string | undefined
export function isPublicIndexableRoute(route: RouteMetadataScalar): boolean
export function robotsDisallowPath(route: RouteMetadataScalar): string | undefined
